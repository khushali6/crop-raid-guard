"""Public HTTP API (v1)."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
from datetime import date
from typing import Any, Literal

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field

from app import db, evidence, messaging, reports
from app.agents import tools as T
from app.agents.service import run_agent
from app.auth import ALL_SCOPES, Principal, get_principal, new_api_key, require_admin_token, require_scope
from app.config import get_settings
from app.rag.ingest import SourceDoc, ingest, load_url
from app.vision.species import catalog_options

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1")


def _ctx(p: Principal, **kw) -> T.ToolContext:
    return T.ToolContext(user_id=p.user_id, org_id=p.org_id, language=p.language, scopes=p.scopes,
                         actor_kind="user" if p.kind == "user" else "mcp", **kw)


# ------------------------------------------------------------------ videos
@router.post("/videos/{video_id}/analyze")
async def reanalyze(video_id: str, p: Principal = Depends(require_scope("claims:draft"))) -> dict:
    async with db.as_user(p.user_id, read_only=True) as conn:
        v = await db.fetch_one(conn, "select id, org_id, status from public.videos where id::text = %s", (video_id,))
    if not v:
        raise HTTPException(404, "Video not found.")
    if v["status"] in ("queued", "processing"):
        return {"status": v["status"], "message": "This video is already being analysed."}
    async with db.service() as conn:
        in_claim = await db.fetch_one(
            conn,
            """select 1 from public.claims c where c.org_id = %s and exists (
                 select 1 from public.events e where e.video_id = %s and e.id = any(c.event_ids)) limit 1""",
            (v["org_id"], v["id"]),
        )
        if in_claim:
            raise HTTPException(409, "This video's events are part of a claim, so it cannot be re-analysed.")
        n = await db.fetch_one(conn, "select count(*) as n from public.jobs where video_id = %s", (v["id"],))
        await conn.execute(
            "insert into public.jobs (kind, org_id, video_id, idempotency_key) values ('analyze_video', %s, %s, %s)",
            (v["org_id"], v["id"], f"analyze:{v['id']}:{n['n'] + 1}"),
        )
        await conn.execute(
            "update public.videos set status = 'queued', progress = 0, stage = 'Waiting for an analysis worker', error = null where id = %s",
            (v["id"],),
        )
        await db.audit(conn, org_id=p.org_id, actor_id=p.user_id, actor_kind="user", action="video.reanalyze",
                       entity="video", entity_id=video_id)
    return {"status": "queued"}


# ------------------------------------------------------------------ agent
class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    thread_id: str | None = None
    video_id: str | None = None
    language: Literal["en", "hi", "gu"] | None = None


@router.post("/agent/chat")
async def agent_chat(body: ChatIn, p: Principal = Depends(require_scope("events:read"))) -> StreamingResponse:
    """Server-sent events: thread, route, tool_call, tool_result, answer, done."""
    queue: asyncio.Queue[dict | None] = asyncio.Queue()

    async def emit(event: dict) -> None:
        await queue.put(event)

    async def runner() -> None:
        try:
            result = await run_agent(user_id=p.user_id, org_id=p.org_id, message=body.message, thread_id=body.thread_id,
                                     language=body.language or p.language, scopes=p.scopes, video_id=body.video_id, emit=emit)
            await queue.put({"type": "answer", **result})
        except Exception as exc:
            log.exception("chat failed")
            message = str(exc) if isinstance(exc, HTTPException | PermissionError) else \
                "The assistant could not answer right now. Please try again."
            await queue.put({"type": "error", "message": getattr(exc, "detail", None) or message})
        finally:
            await queue.put(None)

    task = asyncio.create_task(runner())

    async def stream():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if event is None:
                    yield 'event: done\ndata: {"type": "done"}\n\n'
                    break
                yield f"event: {event['type']}\ndata: {json.dumps(event, default=str, ensure_ascii=False)}\n\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ------------------------------------------------------------------ claims & evidence
@router.post("/claims/{claim_id}/evidence-pack")
async def claim_evidence(claim_id: str, p: Principal = Depends(require_scope("claims:draft"))) -> dict:
    try:
        return await evidence.build_pack(user_id=p.user_id, org_id=p.org_id, claim_id=claim_id)
    except evidence.EvidenceError as exc:
        raise HTTPException(400, str(exc)) from exc


class DraftIn(BaseModel):
    language: Literal["en", "hi", "gu"] | None = None


@router.post("/claims/{claim_id}/draft")
async def claim_draft(claim_id: str, body: DraftIn, p: Principal = Depends(require_scope("claims:draft"))) -> dict:
    result = await T.call_tool(_ctx(p), "draft_claim_text", {"claim_id": claim_id, "language": body.language or p.language})
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.get("/evidence/{pack_id}/download")
async def evidence_download(pack_id: str, p: Principal = Depends(get_principal)) -> dict:
    async with db.as_user(p.user_id, read_only=True) as conn:
        row = await db.fetch_one(conn, "select storage_path from public.evidence_packs where id::text = %s", (pack_id,))
    if not row:
        raise HTTPException(404, "Evidence pack not found.")
    from app import storage

    return {"url": await storage.sign("evidence", row["storage_path"], 3600, f"evidence-{pack_id[:8]}.zip")}


@router.get("/evidence/public-key")
async def evidence_public_key() -> dict:
    try:
        return {"alg": "Ed25519", "key_id": get_settings().evidence_key_id, "public_key": evidence.public_key_b64()}
    except evidence.EvidenceError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.post("/evidence/verify")
async def evidence_verify(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    if len(data) > 60 * 1024 * 1024:
        raise HTTPException(413, "Evidence packs are limited to 60 MB.")
    try:
        return evidence.verify_zip(data)
    except (KeyError, ValueError) as exc:
        return {"valid": False, "reason": f"Not a Crop Raid Guard evidence pack: {exc}"}


# ------------------------------------------------------------------ reports & search
class ReportIn(BaseModel):
    kind: Literal["weekly", "farm", "custom"] = "weekly"
    farm_id: str | None = None
    start: date | None = None
    end: date | None = None
    language: Literal["en", "hi", "gu"] | None = None
    title: str | None = Field(default=None, max_length=120)


@router.post("/reports")
async def create_report(body: ReportIn, p: Principal = Depends(require_scope("claims:draft"))) -> dict:
    if body.start and body.end and body.start > body.end:
        raise HTTPException(400, "The start date must be before the end date.")
    return await reports.generate_report(user_id=p.user_id, org_id=p.org_id, kind=body.kind, start=body.start, end=body.end,
                                         farm_id=body.farm_id, language=body.language or p.language, title=body.title)


class SearchIn(BaseModel):
    query: str = Field(min_length=2, max_length=300)
    limit: int = Field(default=8, ge=1, le=15)


@router.post("/search/events")
async def search_events(body: SearchIn, p: Principal = Depends(require_scope("events:read"))) -> dict:
    if not get_settings().llm_enabled:
        raise HTTPException(503, "Semantic search needs GEMINI_API_KEY on the server.")
    return await T.call_tool(_ctx(p), "semantic_search_events", {"query": body.query, "limit": body.limit})


@router.get("/species")
async def species() -> list[dict]:
    return catalog_options()


# ------------------------------------------------------------------ API keys
class KeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    scopes: list[Literal["events:read", "claims:draft", "claims:write"]] = ["events:read"]


@router.post("/api-keys", status_code=201)
async def create_key(body: KeyIn, p: Principal = Depends(get_principal)) -> dict:
    if p.kind != "user":
        raise HTTPException(403, "API keys can only be created from a signed-in session.")
    raw, prefix, digest = new_api_key()
    scopes = sorted(set(body.scopes) & set(ALL_SCOPES)) or ["events:read"]
    async with db.service() as conn:
        row = await db.fetch_one(
            conn,
            "insert into public.api_keys (org_id, user_id, name, prefix, key_hash, scopes) values (%s,%s,%s,%s,%s,%s) returning id, created_at",
            (p.org_id, p.user_id, body.name, prefix, digest, scopes),
        )
        await db.audit(conn, org_id=p.org_id, actor_id=p.user_id, actor_kind="user", action="api_key.create",
                       entity="api_key", entity_id=str(row["id"]), payload={"scopes": scopes})
    return {"id": str(row["id"]), "key": raw, "prefix": prefix, "scopes": scopes, "name": body.name}


@router.delete("/api-keys/{key_id}", status_code=204)
async def revoke_key(key_id: str, p: Principal = Depends(get_principal)) -> None:
    async with db.service() as conn:
        row = await db.fetch_one(
            conn, "update public.api_keys set revoked_at = now() where id::text = %s and user_id = %s and revoked_at is null returning id",
            (key_id, p.user_id),
        )
        if not row:
            raise HTTPException(404, "API key not found.")
        await db.audit(conn, org_id=p.org_id, actor_id=p.user_id, actor_kind="user", action="api_key.revoke",
                       entity="api_key", entity_id=key_id)


# ------------------------------------------------------------------ messaging
@router.post("/integrations/link-code")
async def link_code(p: Principal = Depends(get_principal)) -> dict:
    s = get_settings()
    code = await messaging.create_link_code(p.user_id)
    return {
        "code": code,
        "expires_in_minutes": 30,
        "telegram_url": f"https://t.me/{s.telegram_bot_username}?start={code}" if s.telegram_bot_username else None,
        "whatsapp_text": f"LINK {code}" if s.whatsapp_phone_number_id else None,
        "telegram_enabled": bool(s.telegram_bot_token),
        "whatsapp_enabled": bool(s.whatsapp_token),
    }


@router.delete("/integrations/messaging", status_code=204)
async def unlink(channel: Literal["telegram", "whatsapp"] = Query(...), p: Principal = Depends(get_principal)) -> None:
    column = "telegram_chat_id" if channel == "telegram" else "whatsapp_phone"
    async with db.service() as conn:
        await conn.execute(f"update public.profiles set {column} = null where id = %s", (p.user_id,))


@router.post("/integrations/telegram/webhook")
async def telegram_webhook(request: Request, background: BackgroundTasks,
                           x_telegram_bot_api_secret_token: str | None = Header(default=None)) -> dict:
    secret = get_settings().telegram_webhook_secret
    if not secret or not x_telegram_bot_api_secret_token or not hmac.compare_digest(secret, x_telegram_bot_api_secret_token):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "bad secret")
    background.add_task(messaging.handle_telegram, await request.json())
    return {"ok": True}


@router.get("/integrations/whatsapp/webhook", response_class=PlainTextResponse)
async def whatsapp_verify(mode: str = Query(alias="hub.mode"), token: str = Query(alias="hub.verify_token"),
                          challenge: str = Query(alias="hub.challenge")) -> str:
    expected = get_settings().whatsapp_verify_token
    if mode == "subscribe" and expected and hmac.compare_digest(token, expected):
        return challenge
    raise HTTPException(403, "verification failed")


@router.post("/integrations/whatsapp/webhook")
async def whatsapp_webhook(request: Request, background: BackgroundTasks,
                           x_hub_signature_256: str | None = Header(default=None)) -> dict:
    body = await request.body()
    secret = get_settings().whatsapp_app_secret
    if secret:
        expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        if not x_hub_signature_256 or not hmac.compare_digest(expected, x_hub_signature_256):
            raise HTTPException(403, "bad signature")
    background.add_task(messaging.handle_whatsapp, json.loads(body or b"{}"))
    return {"ok": True}


# ------------------------------------------------------------------ knowledge base (admin)
class IngestIn(BaseModel):
    url: str | None = None
    text: str | None = None
    title: str | None = None
    source_url: str | None = None
    publisher: str | None = None
    state: str | None = None
    scheme: str | None = None
    language: str = "en"
    effective_from: date | None = None


@router.post("/kb/ingest", dependencies=[Depends(require_admin_token)])
async def kb_ingest(body: IngestIn) -> dict[str, Any]:
    meta = {"publisher": body.publisher, "state": body.state, "scheme": body.scheme, "language": body.language,
            "effective_from": body.effective_from.isoformat() if body.effective_from else None}
    if body.url:
        doc = await load_url(body.url, title=body.title, **meta)
    elif body.text and body.title:
        doc = SourceDoc(title=body.title, text=body.text, source_url=body.source_url, **meta)
    else:
        raise HTTPException(400, "Provide a url, or title and text.")
    return await ingest(doc)
