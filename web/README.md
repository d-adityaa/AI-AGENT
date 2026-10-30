# AI Study Planner Web

Deployable Next.js 16 version of the AI Personal Study Planner.

- Browser-local tasks, history, and model preference
- Gemini native function calling through a server-side route
- Strict tool validation and approval-gated changes
- Deterministic offline fallback with honest labelling
- Vitest tests and a production-ready build

## Run locally

```powershell
cd "D:\AI AGENT\ai-study-planner-agent\web"
npm install
Copy-Item .env.example .env.local
notepad .env.local
npm run dev
```

Open <http://localhost:3000>. The app works without an API key by using the local fallback.

Set `GEMINI_API_KEY` in `.env.local` for live Gemini responses. Never use a `NEXT_PUBLIC_` prefix.

## Verify

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

## Deploy

Use Vercel with Root Directory `web`, build command `npm run build`, and `GEMINI_API_KEY` configured as a server environment variable. No external database is required.

See the repository root [README](../README.md) for the full architecture, security notes, storage details, and troubleshooting.
