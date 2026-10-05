"""Runs the agent graph for a thread: persistence, budget guard, usage accounting and streaming events."""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from app import db, llm
from app.agents.graph import run_graph
from app.agents.tools import ToolContext
from app.config import get_settings

log = logging.getLogger(__name__)
Emit = Callable[[dict], Awaitable[None]]


async def ensure_thread(user_id: str, org_id: str, thread_id: str | None, first_message: str, context: dict | None = None) -> str:
    async with db.as_user(user_id) as conn:
        if thread_id:
            row = await db.fetch_one(conn, "select id from public.agent_threads where id::text = %s", (thread_id,))
            if row:
                return str(row["id"])
        row = await db.fetch_one(
            conn,
            "insert into public.agent_threads (org_id, user_id, title, context) values (%s, %s, %s, %s) returning id",
            (org_id, user_id, first_message.strip()[:80] or "New conversation", json.dumps(context or {})),
        )
    return str(row["id"])


async def _history(thread_id: str) -> list[dict]:
    async with db.service() as conn:
        rows = await db.fetch_all(
            conn, "select role, content from public.agent_messages where thread_id = %s order by id desc limit 8", (thread_id,)
        )
    return list(reversed(rows))


async def _runs_today(user_id: str) -> int:
    async with db.service() as conn:
        row = await db.fetch_one(
            conn, "select count(*) as n from public.agent_runs where user_id = %s and created_at > now() - interval '24 hours'", (user_id,)
        )
    return int(row["n"])


async def run_agent(
    *,
    user_id: str,
    org_id: str,
    message: str,
    thread_id: str | None = None,
    language: str = "en",
    scopes: list[str] | None = None,
    video_id: str | None = None,
    channel: str = "web",
    emit: Emit | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    thread_id = await ensure_thread(user_id, org_id, thread_id, message, {"video_id": video_id} if video_id else None)
    if emit:
        await emit({"type": "thread", "thread_id": thread_id})

    if not settings.llm_enabled:
        answer = "The AI assistant is not configured on this server yet (missing GEMINI_API_KEY)."
        return {"thread_id": thread_id, "answer": answer, "route": None, "citations": [], "trace": [], "status": "blocked"}

    if await _runs_today(user_id) >= settings.agent_daily_run_limit:
        answer = "You have reached today's assistant limit. Please try again tomorrow."
        return {"thread_id": thread_id, "answer": answer, "route": None, "citations": [], "trace": [], "status": "blocked"}

    history = await _history(thread_id)
    async with db.service() as conn:
        run = await db.fetch_one(
            conn,
            "insert into public.agent_runs (thread_id, org_id, user_id, channel) values (%s,%s,%s,%s) returning id",
            (thread_id, org_id, user_id, channel),
        )
        await conn.execute(
            "insert into public.agent_messages (thread_id, org_id, role, content) values (%s,%s,'user',%s)",
            (thread_id, org_id, message),
        )
        await conn.execute("update public.agent_threads set updated_at = now() where id = %s", (thread_id,))
    run_id = str(run["id"])

    ctx = ToolContext(user_id=user_id, org_id=org_id, language=language, video_id=video_id, emit=emit,
                      scopes=scopes or ["events:read", "claims:draft", "claims:write"])
    usage = llm.start_usage()
    started = time.perf_counter()
    status, error, result = "succeeded", None, {}
    try:
        result = await run_graph(ctx, message, history)
        answer = result.get("refusal") or result.get("answer") or ""
        if result.get("refusal"):
            status = "blocked"
    except llm.LLMUnavailable as exc:
        status, error, answer = "failed", str(exc), "The AI assistant is not configured on this server yet."
    except Exception as exc:
        log.exception("agent run failed")
        status, error = "failed", str(exc)[:500]
        answer = "Something went wrong while answering. Your question was saved; please try again in a minute."

    latency = int((time.perf_counter() - started) * 1000)
    tool_calls = sum(1 for t in ctx.trace if t.get("type") == "tool")
    async with db.service() as conn:
        await conn.execute(
            "insert into public.agent_messages (thread_id, org_id, role, content, route, citations, trace) values (%s,%s,'assistant',%s,%s,%s,%s)",
            (thread_id, org_id, answer, result.get("route"), json.dumps(ctx.citations, default=str),
             json.dumps(ctx.trace, default=str)),
        )
        await conn.execute(
            """update public.agent_runs set status = %s, route = %s, steps = %s, tool_calls = %s, input_tokens = %s,
                 output_tokens = %s, cost_usd = %s, latency_ms = %s, error = %s where id = %s""",
            (status, result.get("route"), usage.calls, tool_calls, usage.input_tokens, usage.output_tokens, usage.cost_usd,
             latency, error, run_id),
        )
    return {
        "thread_id": thread_id, "run_id": run_id, "answer": answer, "route": result.get("route"),
        "citations": ctx.citations, "trace": ctx.trace, "status": status,
        "usage": {"input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens, "llm_calls": usage.calls,
                  "cost_usd": usage.cost_usd, "latency_ms": latency},
    }
