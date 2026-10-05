# Crop Raid Guard

Night camera footage in, signed crop-loss evidence out. Farmers upload field-camera video; SpeciesNet finds the animals, a risk engine explains how serious each visit was, and a claims checklist turns a raid into a signed evidence pack and a PMFBY loss intimation within the 72-hour window.

| Folder | What it is | Free host |
| --- | --- | --- |
| `crop-raid-guard-ui/` | TanStack Start web app | Vercel (Hobby) |
| `backend/` | FastAPI API, vision worker, agents, MCP server | Hugging Face Spaces (Docker, CPU basic) |
| `supabase/` | Postgres schema, RLS, RPCs, storage buckets | Supabase (Free) |

Gemini (free tier from Google AI Studio) powers chat, semantic search and translated claim drafts. It is optional.

## Deploy for free

### 1. Supabase

```bash
npx supabase login
npx supabase link --project-ref YOUR_REF
npx supabase db push            # applies supabase/migrations
```

In the dashboard, under **Authentication → URL configuration**, set the site URL to your Vercel URL and add `https://YOUR-APP.vercel.app/**` to the redirect URLs.

Note these values from **Project settings**: the project URL, the publishable key, the service-role key, the JWT secret (or leave it empty to use JWKS), and the session-pooler connection string (port 5432).

### 2. API on Hugging Face Spaces

Create a Space with the **Docker** SDK and push the contents of `backend/` to it. The README front matter already sets `app_port: 7860`.

```bash
cd backend && python -m app.evidence keygen   # prints EVIDENCE_SIGNING_KEY=...
```

Add these as Space **secrets**:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`
- `EVIDENCE_SIGNING_KEY`
- `GEMINI_API_KEY` (optional)
- `PUBLIC_API_URL=https://USER-SPACE.hf.space`
- `FRONTEND_URL` and `CORS_ORIGINS`, both set to your Vercel URL

The SpeciesNet weights are baked into the image, so cold starts don't download anything. A free Space sleeps after about 48 hours without traffic; the UI shows "Analysis service waking up" until it is back.

### 3. Web app on Vercel

Import the repository, set the root directory to `crop-raid-guard-ui`, and add:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_API_URL` (the Space URL)

`vercel.json` already sets the build command (`NITRO_PRESET=vercel bun run build`).

### 4. Keep the free tiers awake

Supabase pauses free projects after a week of inactivity. In the GitHub repository, set the variable `API_URL` (**Settings → Secrets and variables → Actions → Variables**) to the Space URL. `.github/workflows/keepalive.yml` then pings `/healthz` every two days, which touches the database.

## Develop locally

```bash
npx supabase start -x studio,edge-runtime,logflare,vector,imgproxy,supavisor,postgres-meta
cd backend && uvicorn app.main:app --port 8000           # see backend/README.md
cd crop-raid-guard-ui && bun install && bun run dev       # http://localhost:8080
```

CI (`.github/workflows/ci.yml`) runs the migrations, RLS tests and backend tests against Postgres, then builds, type-checks, tests and lints the UI.
