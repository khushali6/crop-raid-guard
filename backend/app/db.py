"""Postgres access.

Two modes:
- `service()` runs as the connection's own role (bypasses RLS). Only the worker and audited
  system paths use it.
- `as_user(user_id)` switches to the `authenticated` role with the caller's JWT claims for the
  duration of one transaction, so every query is filtered by the same RLS policies the browser uses.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.config import get_settings

_pool: AsyncConnectionPool | None = None


async def open_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        settings = get_settings()
        if not settings.database_url:
            raise RuntimeError("DATABASE_URL is not configured")
        _pool = AsyncConnectionPool(
            settings.database_url,
            min_size=1,
            max_size=settings.db_pool_max,
            kwargs={"row_factory": dict_row, "prepare_threshold": None, "autocommit": False},
            open=False,
        )
        await _pool.open(wait=True, timeout=30)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> AsyncConnectionPool:
    if _pool is None:
        raise RuntimeError("database pool is not open")
    return _pool


@asynccontextmanager
async def service() -> AsyncIterator[AsyncConnection]:
    async with pool().connection() as conn:
        async with conn.transaction():
            yield conn


@asynccontextmanager
async def as_user(user_id: str, *, read_only: bool = False, timeout_ms: int = 8000) -> AsyncIterator[AsyncConnection]:
    claims = json.dumps({"sub": user_id, "role": "authenticated"})
    async with pool().connection() as conn:
        async with conn.transaction():
            if read_only:
                await conn.execute("set transaction read only")
            await conn.execute(
                "select set_config('request.jwt.claims', %s, true), set_config('request.jwt.claim.sub', %s, true),"
                " set_config('statement_timeout', %s, true)",
                (claims, user_id, str(timeout_ms)),
            )
            await conn.execute("set local role authenticated")
            yield conn


async def fetch_all(conn: AsyncConnection, sql: str, params: Any = None) -> list[dict[str, Any]]:
    cur = await conn.execute(sql, params)
    return list(await cur.fetchall())


async def fetch_one(conn: AsyncConnection, sql: str, params: Any = None) -> dict[str, Any] | None:
    cur = await conn.execute(sql, params)
    return await cur.fetchone()


async def audit(
    conn: AsyncConnection,
    *,
    org_id: str | None,
    actor_id: str | None,
    actor_kind: str,
    action: str,
    entity: str,
    entity_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    await conn.execute(
        "insert into public.audit_log (org_id, actor_id, actor_kind, action, entity, entity_id, payload)"
        " values (%s, %s, %s, %s, %s, %s, %s)",
        (org_id, actor_id, actor_kind, action, entity, entity_id, json.dumps(payload or {}, default=str)),
    )


def vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{v:.7f}" for v in values) + "]"
