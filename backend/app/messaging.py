"""Two-way chat over Telegram and WhatsApp: account linking, text/voice questions and alert quick replies."""

from __future__ import annotations

import logging
import re
import secrets
from datetime import UTC, datetime, timedelta

import httpx

from app import db, llm, notify
from app.agents import tools as T
from app.agents.service import run_agent
from app.config import get_settings

log = logging.getLogger(__name__)

WELCOME = {
    "en": "Linked! You will get wildlife alerts here. Ask me anything about your fields, e.g. 'What visited North Field last night?'",
    "hi": "जुड़ गया! आपको यहाँ वन्यजीव अलर्ट मिलेंगे। अपने खेतों के बारे में कुछ भी पूछें।",
    "gu": "જોડાઈ ગયું! તમને અહીં વન્યજીવ ચેતવણીઓ મળશે. તમારા ખેતર વિશે કંઈ પણ પૂછો.",
}
NOT_LINKED = ("This chat is not linked to a Crop Raid Guard account yet. Open Settings > Notifications in the web app, "
              "tap 'Connect Telegram' (or WhatsApp) and follow the link.")


async def create_link_code(user_id: str) -> str:
    code = secrets.token_hex(4).upper()
    async with db.service() as conn:
        await conn.execute(
            "update public.profiles set link_code = %s, link_code_expires_at = now() + interval '30 minutes' where id = %s",
            (code, user_id),
        )
    return code


async def _consume_code(code: str, *, telegram_chat_id: int | None = None, whatsapp_phone: str | None = None) -> dict | None:
    async with db.service() as conn:
        row = await db.fetch_one(
            conn,
            """update public.profiles set link_code = null, link_code_expires_at = null,
                 telegram_chat_id = coalesce(%s, telegram_chat_id), whatsapp_phone = coalesce(%s, whatsapp_phone)
               where link_code = %s and link_code_expires_at > now() returning id, language, default_org_id""",
            (telegram_chat_id, whatsapp_phone, code.strip().upper()),
        )
        if row:
            await db.audit(conn, org_id=str(row["default_org_id"]), actor_id=str(row["id"]), actor_kind="user",
                           action="messaging.link", entity="profile", entity_id=str(row["id"]),
                           payload={"channel": "telegram" if telegram_chat_id else "whatsapp"})
    return row


async def _profile_by(column: str, value) -> dict | None:
    async with db.service() as conn:
        return await db.fetch_one(conn, f"select id, language, default_org_id from public.profiles where {column} = %s", (value,))


def _absolute_links(text: str) -> str:
    base = get_settings().frontend_url.rstrip("/")
    text = re.sub(r"\]\((/[^)]*)\)", lambda m: f"]({base}{m.group(1)})", text)
    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1: \2", text)


async def _ask(profile: dict, text: str, channel: str) -> str:
    result = await run_agent(user_id=str(profile["id"]), org_id=str(profile["default_org_id"]), message=text,
                             language=profile["language"], channel=channel)
    return _absolute_links(result["answer"])


# ------------------------------------------------------------------ Telegram
async def handle_telegram(update: dict) -> None:
    if cb := update.get("callback_query"):
        await _telegram_callback(cb)
        return
    msg = update.get("message") or {}
    chat_id = (msg.get("chat") or {}).get("id")
    if not chat_id:
        return
    text = (msg.get("text") or "").strip()
    if text.startswith("/start"):
        parts = text.split(maxsplit=1)
        if len(parts) == 2:
            prof = await _consume_code(parts[1], telegram_chat_id=chat_id)
            await notify.telegram_send(chat_id, WELCOME.get(prof["language"], WELCOME["en"]) if prof else
                                       "That link has expired. Please create a new one in Settings.")
        else:
            await notify.telegram_send(chat_id, NOT_LINKED)
        return

    profile = await _profile_by("telegram_chat_id", chat_id)
    if not profile:
        await notify.telegram_send(chat_id, NOT_LINKED)
        return
    if voice := (msg.get("voice") or msg.get("audio")):
        text = await _telegram_transcribe(voice)
        if not text:
            await notify.telegram_send(chat_id, "Sorry, I could not understand that voice note.")
            return
        await notify.telegram_send(chat_id, f"🎙 {text}")
    if not text:
        return
    await notify.telegram_call("sendChatAction", {"chat_id": chat_id, "action": "typing"})
    await notify.telegram_send(chat_id, await _ask(profile, text, "telegram"))


async def _telegram_transcribe(voice: dict) -> str | None:
    info = await notify.telegram_call("getFile", {"file_id": voice["file_id"]})
    path = (info.get("result") or {}).get("file_path")
    if not path:
        return None
    async with httpx.AsyncClient(timeout=60) as http:
        resp = await http.get(f"https://api.telegram.org/file/bot{get_settings().telegram_bot_token}/{path}")
    if resp.status_code != 200 or len(resp.content) > 15 * 1024 * 1024:
        return None
    return await llm.transcribe_audio(resp.content, voice.get("mime_type") or "audio/ogg")


async def _telegram_callback(cb: dict) -> None:
    chat_id = ((cb.get("message") or {}).get("chat") or {}).get("id")
    data = cb.get("data") or ""
    await notify.telegram_call("answerCallbackQuery", {"callback_query_id": cb.get("id")})
    profile = await _profile_by("telegram_chat_id", chat_id) if chat_id else None
    if not profile:
        return
    action, _, event_id = data.partition(":")
    ctx = T.ToolContext(user_id=str(profile["id"]), org_id=str(profile["default_org_id"]), language=profile["language"],
                        actor_kind="user")
    if action == "claim":
        res = await T.call_tool(ctx, "create_claim_draft", {"event_ids": [event_id]})
        reply = res.get("error") or (f"Draft claim created. Report deadline: {res['deadline_local']} IST.\n"
                                     f"{get_settings().frontend_url.rstrip('/')}{res['link']}")
    elif action == "reject":
        async with db.as_user(ctx.user_id) as conn:
            await conn.execute("select public.review_event(%s, 'reject')", (event_id,))
        reply = "Thanks. The detection was marked as not an animal and will help improve the model."
    else:
        return
    await notify.telegram_send(chat_id, reply)


# ------------------------------------------------------------------ WhatsApp Cloud API
async def handle_whatsapp(payload: dict) -> None:
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            for msg in (change.get("value") or {}).get("messages", []) or []:
                sender = msg.get("from")
                text = ((msg.get("text") or {}).get("body") or "").strip()
                if not sender or not text:
                    continue
                m = re.match(r"^link\s+([A-F0-9]{8})$", text, re.IGNORECASE)
                if m:
                    prof = await _consume_code(m.group(1), whatsapp_phone=sender)
                    await notify.whatsapp_send_text(sender, WELCOME.get(prof["language"], WELCOME["en"]) if prof else
                                                    "That code has expired. Please create a new one in Settings.")
                    continue
                profile = await _profile_by("whatsapp_phone", sender)
                if not profile:
                    await notify.whatsapp_send_text(sender, NOT_LINKED)
                    continue
                await notify.whatsapp_send_text(sender, await _ask(profile, text, "whatsapp"))


def link_expiry() -> datetime:
    return datetime.now(UTC) + timedelta(minutes=30)
