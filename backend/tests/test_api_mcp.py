"""Authenticated API, API keys and the MCP server, against the test database (see test_integration.py)."""

import json
import time
import uuid

import httpx
import jwt
import pytest

from tests.test_integration import DSN, _user, env  # noqa: F401  (fixture re-export)

pytestmark = pytest.mark.skipif(not DSN, reason="TEST_DATABASE_URL not set")
SECRET = "test-jwt-secret-with-at-least-32-characters"


def _token(user_id: str) -> str:
    now = int(time.time())
    return jwt.encode({"sub": user_id, "aud": "authenticated", "role": "authenticated", "iat": now, "exp": now + 600},
                      SECRET, algorithm="HS256")


def _mcp_payload(resp: httpx.Response) -> dict:
    assert resp.status_code == 200, resp.text
    if resp.headers.get("content-type", "").startswith("text/event-stream"):
        data = [line[5:].strip() for line in resp.text.splitlines() if line.startswith("data:")]
        return json.loads(data[-1])
    return resp.json()


async def test_keys_and_mcp(env, monkeypatch):  # noqa: F811
    from app import db
    from app.config import get_settings
    from app.main import app

    s = get_settings()
    monkeypatch.setattr(s, "supabase_jwt_secret", SECRET)
    monkeypatch.setattr(s, "worker_enabled", False)
    user, org = await _user(f"k-{uuid.uuid4().hex[:6]}@example.com")
    async with db.as_user(user) as conn:
        await conn.execute("insert into public.farms (org_id, name, crop) values (%s, 'Mango Orchard', 'Mango')", (org,))
    auth = {"Authorization": f"Bearer {_token(user)}"}

    await db.close_pool()  # the app lifespan opens its own pool
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            health = (await client.get("/healthz")).json()
            assert health["ok"] is True and health["database"] is True

            bad = jwt.encode({"sub": user, "aud": "authenticated", "exp": int(time.time()) + 60}, "x" * 40, algorithm="HS256")
            assert (await client.post("/v1/api-keys", json={"name": "x"}, headers={"Authorization": f"Bearer {bad}"})).status_code == 401

            r = await client.post("/v1/api-keys", json={"name": "Claude", "scopes": ["events:read"]}, headers=auth)
            assert r.status_code == 201, r.text
            key = r.json()["key"]
            mcp_headers = {"Authorization": f"Bearer {key}", "Accept": "application/json, text/event-stream",
                           "Content-Type": "application/json", "MCP-Protocol-Version": "2025-06-18"}

            assert (await client.post("/mcp", json={"jsonrpc": "2.0", "id": 0, "method": "tools/list"})).status_code == 401

            init = _mcp_payload(await client.post("/mcp", headers=mcp_headers, json={
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "pytest", "version": "1"}}}))
            assert init["result"]["serverInfo"]["name"]

            tools = _mcp_payload(await client.post("/mcp", headers=mcp_headers,
                                                   json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}))
            names = {t["name"] for t in tools["result"]["tools"]}
            assert {"list_farms", "search_events", "get_field_risk", "build_evidence_pack"} <= names

            call = _mcp_payload(await client.post("/mcp", headers=mcp_headers, json={
                "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "list_farms", "arguments": {}}}))
            assert "Mango Orchard" in json.dumps(call["result"])

            # An events:read key cannot build evidence packs.
            denied = _mcp_payload(await client.post("/mcp", headers=mcp_headers, json={
                "jsonrpc": "2.0", "id": 4, "method": "tools/call",
                "params": {"name": "build_evidence_pack", "arguments": {"claim_id": str(uuid.uuid4()), "confirm": True}}}))
            assert denied["result"]["isError"] or "scope" in json.dumps(denied).lower()

            # Agent chat streams a graceful answer even without an LLM key.
            async with client.stream("POST", "/v1/agent/chat", json={"message": "How many events this week?"}, headers=auth) as resp:
                assert resp.status_code == 200
                body = (await resp.aread()).decode()
            types = [json.loads(line[5:])["type"] for line in body.splitlines() if line.startswith("data:")]
            assert types[-1] == "done" and ("answer" in types or "error" in types)

            key_id = r.json()["id"]
            assert (await client.delete(f"/v1/api-keys/{key_id}", headers=auth)).status_code == 204
            assert (await client.post("/mcp", headers=mcp_headers,
                                      json={"jsonrpc": "2.0", "id": 5, "method": "tools/list"})).status_code == 401
    await db.open_pool()
