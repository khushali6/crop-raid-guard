# Crop Raid Guard

Night camera footage in, signed crop-loss evidence out. Farmers upload field-camera video; SpeciesNet finds the animals, a risk engine explains how serious each visit was, and a claims checklist turns a raid into a signed evidence pack and a PMFBY loss intimation within the 72-hour window.

| Folder | What it is | Free host |
| --- | --- | --- |
| `crop-raid-guard-ui/` | TanStack Start web app | Vercel (Hobby) |
| `backend/` | FastAPI API, vision worker, agents, MCP server | Oracle Cloud Always Free VM (Docker + Caddy) |
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

### 2. API on an Oracle Cloud Always Free VM

SpeciesNet needs about 2 GB of RAM and the worker must stay on, which rules out most free container hosts. Oracle's Always Free Ampere A1 shape (up to 4 cores, 24 GB) fits comfortably.

1. Create an Ubuntu 24.04 instance (shape `VM.Standard.A1.Flex`) and add your SSH public key.
2. In the instance's VCN security list, allow ingress TCP 80 and 443 from `0.0.0.0/0`.
3. Copy the repository to the VM and write `/opt/crg/api.env` (see `backend/.env.example`):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (session pooler, port 5432)
   - `SUPABASE_JWT_SECRET` only if your project still signs with HS256
   - `EVIDENCE_SIGNING_KEY` from `python -m app.evidence keygen`
   - `GEMINI_API_KEY` (optional)
   - `PUBLIC_API_URL=https://A-B-C-D.sslip.io` (your IP with dashes), and `FRONTEND_URL` / `CORS_ORIGINS` set to your Vercel URL
4. Start it:

```bash
sudo bash deploy/oracle/setup.sh
cd deploy/oracle && API_DOMAIN=A-B-C-D.sslip.io docker compose up -d --build
```

Caddy obtains a Let's Encrypt certificate for the `sslip.io` hostname automatically. The SpeciesNet weights are baked into the image at build time.

### 3. Web app on Vercel

Import the repository, set the root directory to `crop-raid-guard-ui`, and add:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_API_URL` (the API URL, e.g. `https://A-B-C-D.sslip.io`)

`vercel.json` already sets the build command (`NITRO_PRESET=vercel bun run build`).

### 4. Keep the free tiers awake

Supabase pauses free projects after a week of inactivity. In the GitHub repository, set the variable `API_URL` (**Settings → Secrets and variables → Actions → Variables**) to the API URL. `.github/workflows/keepalive.yml` then pings `/healthz` every two days, which touches the database.

## Develop locally

```bash
npx supabase start -x studio,edge-runtime,logflare,vector,imgproxy,supavisor,postgres-meta
cd backend && uvicorn app.main:app --port 8000           # see backend/README.md
cd crop-raid-guard-ui && bun install && bun run dev       # http://localhost:8080
```

CI (`.github/workflows/ci.yml`) runs the migrations, RLS tests and backend tests against Postgres, then builds, type-checks, tests and lints the UI.
