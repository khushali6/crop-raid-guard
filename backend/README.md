---
title: Crop Raid Guard API
emoji: 🌾
colorFrom: green
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
---

# Crop Raid Guard backend

FastAPI service that runs the whole backend in one container:

- **Vision pipeline**: motion-aware frame sampling, then SpeciesNet (MegaDetector, species classifier and India geofence), then tracking, event grouping, the explainable risk engine, clips and keyframes (people blurred), and alerts.
- **Durable job queue** on Postgres (`FOR UPDATE SKIP LOCKED`), with retries, dead-lettering, retention cleanup and a weekly digest.
- **Agents**: a LangGraph supervisor routes to Analyst, Advisor (hybrid RAG with citations), Claims or Report. Gemini handles function calling. Guardrails cover prompt-injection fencing, a SQL allow-list and number verification.
- **Evidence packs**: a zip of clips, keyframes and an HTML report, with a SHA-256 manifest and an Ed25519 signature. A public verify endpoint checks packs.
- **MCP server** at `/mcp` (Streamable HTTP, bearer tokens or API keys with scopes), for Claude, Cursor and other agents.
- **Telegram and WhatsApp** alerts in English, Hindi and Gujarati, plus chat with the assistant.

## Run locally

```bash
uv venv --python 3.12 && uv pip install -e ".[vision,dev]"
cp .env.example .env            # fill in Supabase + Gemini
python -m app.evidence keygen   # paste into EVIDENCE_SIGNING_KEY
uvicorn app.main:app --reload
```

With `GEMINI_API_KEY` set, the documents in `kb/` are embedded at startup (unchanged files are skipped). Without it, everything except chat, semantic search and translated drafts still works.

## Tests

```bash
pytest tests/test_core.py tests/test_media.py           # pure logic, ffmpeg
CONTAINER_NAME=crg-pg ../supabase/tests/run_local.sh     # migrations + RLS tests in Docker
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:54329/postgres pytest   # full suite
```
