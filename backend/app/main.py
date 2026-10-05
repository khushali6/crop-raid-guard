"""FastAPI entrypoint: REST API, MCP server at /mcp and the in-process job worker."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import db, storage, worker
from app.api import router
from app.config import get_settings
from app.mcp_server import build_mcp
from app.rag.ingest import ingest_dir

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("crop-raid-guard")
VERSION = "1.0.0"

settings = get_settings()
mcp = build_mcp()
mcp_app = mcp.streamable_http_app(streamable_http_path="/mcp", stateless_http=True, json_response=True, host="0.0.0.0")
state: dict = {"db": False, "worker": False}
KB_DIR = Path(__file__).resolve().parent.parent / "kb"


async def autoload_kb() -> None:
    try:
        results = await ingest_dir(KB_DIR)
        changed = sum(1 for r in results if r["status"] != "unchanged")
        log.info("knowledge base ready: %d documents, %d new or updated", len(results), changed)
    except Exception as exc:
        log.warning("knowledge base autoload failed: %s", exc)


@asynccontextmanager
async def lifespan(_: FastAPI):
    stop = asyncio.Event()
    worker_task = None
    try:
        await db.open_pool()
        state["db"] = True
    except Exception as exc:
        log.error("database unavailable: %s", exc)
    if state["db"] and settings.worker_enabled:
        worker_task = asyncio.create_task(worker.run_forever(stop))
        state["worker"] = True
    kb_task = None
    if state["db"] and settings.llm_enabled and settings.kb_autoload and KB_DIR.is_dir():
        kb_task = asyncio.create_task(autoload_kb())
    async with mcp.session_manager.run():
        yield
    stop.set()
    if kb_task and not kb_task.done():
        kb_task.cancel()
    if worker_task:
        try:
            await asyncio.wait_for(worker_task, timeout=20)
        except TimeoutError:
            worker_task.cancel()
    await storage.close()
    await db.close_pool()


app = FastAPI(
    title="Crop Raid Guard API",
    version=VERSION,
    description="Evidence-and-response platform for farm-wildlife conflict. Auth: Supabase access token or `crg_` API key.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Mcp-Session-Id", "WWW-Authenticate"],
)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(x) for x in first.get("loc", [])[1:]) or "request"
    return JSONResponse(status_code=422, content={"detail": f"Please check {field}: {first.get('msg', 'invalid value')}."})


@app.get("/", include_in_schema=False)
async def root() -> dict:
    return {"name": "Crop Raid Guard API", "version": VERSION, "docs": "/docs", "mcp": "/mcp"}


@app.get("/healthz")
async def healthz() -> dict:
    db_ok = False
    if state["db"]:
        try:
            async with db.service() as conn:
                await conn.execute("select 1")
            db_ok = True
        except Exception:
            db_ok = False
    queue = None
    if db_ok:
        async with db.service() as conn:
            queue = await db.fetch_one(conn, "select count(*) filter (where status='queued') as queued,"
                                             " count(*) filter (where status='running') as running from public.jobs")
    return {"ok": db_ok, "version": VERSION, "database": db_ok, "worker": state["worker"], "llm": settings.llm_enabled,
            "vision_backend": settings.vision_backend, "evidence_signing": bool(settings.evidence_signing_key),
            "telegram": bool(settings.telegram_bot_token), "queue": queue}


app.include_router(router)
app.mount("/", mcp_app)
