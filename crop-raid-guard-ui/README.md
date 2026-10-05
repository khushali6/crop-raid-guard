# Crop Raid Guard UI

The web app for Crop Raid Guard. It is built with React 19, TypeScript, TanStack Start and Tailwind CSS, and talks to Supabase (auth, database, storage, realtime) and the Crop Raid Guard API (video analysis, assistant, evidence packs).

## Run locally

Install Node.js 22+ and Bun, copy `.env.example` to `.env` and fill in the three values, then:

```sh
bun install
bun run dev
```

For a local backend, see `../README.md` (local Supabase via the CLI plus the FastAPI service).

## Screens

Overview, assistant (`/ask`), video library, video detail with real playback and detection overlay, processing status, fields, wildlife species, review queue, claims board and claim checklist (evidence pack, claim text, approval, filing, outcome), alerts, reports, upload, settings (profile, notifications, Telegram/WhatsApp linking, retention, API keys) and API documentation with an evidence-pack verifier. Login, sign-up, password reset and onboarding use Supabase Auth.

## Deploy (Vercel, free)

Import this folder as a Vercel project. `vercel.json` sets the build to `NITRO_PRESET=vercel bun run build`. Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_API_URL` as environment variables.

## Checks

```sh
bun run build   # also regenerates src/routeTree.gen.ts
bun run test
bun run lint
```

## Design

Warm off-white, forest green, muted sage, charcoal, amber warnings and red high-risk signals. Cormorant Garamond display typography with DM Sans body text.

Detections come from SpeciesNet and can be wrong; risk scores describe activity patterns and do not establish crop damage.
