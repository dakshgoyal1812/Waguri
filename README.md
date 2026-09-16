# Waguri — AI Persona-Twin

Persistent, RAG-backed AI persona chatbot (PRD: "AI Persona-Twin"). The persona
(Waguri, PRD section 15) plugs in as **data**, never hardcoded logic — swap the
persona bible and everything else applies as-is.

- **Real-time voice chat** — hands-free mic via the Web Speech API (Chrome/Edge): continuous listening, live captions, auto-send on each finished utterance, and **barge-in** (she ducks her audio the moment you start talking). Browsers without the API fall back to `POST /api/stt` (Groq Whisper, server-side key).
- **She plays games with you** — server-authoritative tic-tac-toe (she picks legal squares through her LLM brain), scored rock-paper-scissors (she reads your patterns), and 20 questions. Every move/result is narrated through her mood + voice pipeline, so she talks and emotes while playing. `POST /api/game/start|move|state`.
- **RAG long-term memory** — pgvector (cosine) on Supabase, top-6 chunks + last 10 raw messages injected per turn; new exchanges embedded asynchronously.
- **Multi-key failover with fast rotation** — OpenRouter primary pool + Groq/NVIDIA second tier; 429 → 60s cooldown (per-minute) or midnight-UTC cooldown (daily); switches are invisible to the user (only total pool exhaustion surfaces, as 503).
- **TTS pool with mood prosody** — Edge TTS (keyless primary) → Azure Speech (regional key pool) → Google TTS; keyed providers rotate through the same Key Pool Manager; the active mood's `voice_rate`/`voice_pitch` ride into SSML.
- **Feeling layer (moods)** — the `moods` table maps mood name → VRM expression + voice tone + trigger keywords; the engine picks a mood per reply (LLM `[emotion]` tag first, then keyword match by priority, else neutral). Rows are editable via Supabase or `POST /api/moods` — no redeploy. Idle autonomy: `POST /api/idle-comment` produces an unprompted in-character line after silence.
- **3D VRM avatar** — VRM 1.0, optimized 16.8 MB → 1.8 MB (WebP + meshopt, metadata-verified; see `tools/optimize-vrm.mjs`). Browser-side: mood expressions, Web-Audio viseme lip-sync (aa/ih/ou/ee/oh), natural blinking (2–6 s, double-blinks, slower while speaking), entrance greeting bow, idle micro-gestures, and cursor eye-tracking on desktop only (`pointer: fine`).

## Layout

```
backend/    Node + Express (Render). Chat orchestrator, Key Pool Manager,
            RAG retriever, TTS pool. Test suites in test/.
frontend/   Vite + React SPA (Vercel). three-vrm avatar, chat UI,
            persona config UI, key-pool debug modal.
deploy/     schema.sql (Supabase), render.yaml (Render blueprint).
waguri.vrm  VRM 1.0 avatar (served from frontend/public).
```

## API surface (PRD section 10)

| Endpoint | Purpose |
|---|---|
| `POST /api/chat` | message → `{ reply_text, emotion, audio_url, meta }` |
| `GET /api/conversations/:id/history` | paginated history (`?page=&limit=`) |
| `POST /api/tts/url` | re-synthesize a message's voice → fresh `audio_url` (self-heal playback) |
| `POST /api/persona` | persona config (server/Supabase side — no longer in the UI) |
| `POST /api/reset-quotas` | cron-triggered midnight-UTC daily reset (needs `x-admin-token`) |
| `GET /api/keypool/status` | key health debug view (needs `x-admin-token`, never public) |
| `GET /api/health` | keepalive ping target |
| `GET /api/audio/:id` | TTS audio bytes |

## Run locally

All keys and service config live in the **repo-root `.env`** (never in the UI or git). The backend boots fine even before you fill it in: placeholder/empty Supabase URL → in-memory storage, no LLM keys → keyless mode against `LLM_BASE_URL_*` (mock/self-hosted), Edge TTS → keyless primary voice.

```bash
# 1) edit .env at the repo root (Supabase URL, OpenRouter/Groq keys, ...)
cd backend
npm install
node src/server.js               # reads ../.env automatically

# 2) frontend
cd frontend
npm install
npm run dev                      # http://localhost:5173, /api proxied to :8080

# 3) local mock LLM (no real keys needed for dev)
MOCK_PORT=9090 node test/mock-openrouter.js &
LLM_BASE_URL_OPENROUTER=http://127.0.0.1:9090/v1 node src/server.js
```

Seed the persona (PRD section 15 bible) once:
```bash
cd backend && npm run seed:persona
```

Tests (each PRD milestone incl. simulated-429 failover, PRD milestone 6):
```bash
cd backend && node test/run-all.js
```

## Deploy (PRD section 11)

1. **Supabase** — create a free project, enable pgvector, run `deploy/schema.sql` in the SQL editor. Copy the pooler connection string → `DATABASE_URL`.
2. **Render** — New → Blueprint → point at the repo (uses `deploy/render.yaml`, root dir `backend`). Fill the `sync: false` env vars in the dashboard (keys, `APP_ENCRYPTION_KEY` 64-hex, `ADMIN_TOKEN`, `CORS_ORIGINS`, `PUBLIC_BASE_URL`). Keys seeded from env on first boot, then encrypted at rest in `api_keys`.
3. **Vercel** — import `frontend/`, set `NEXT_PUBLIC_API_URL` (or `VITE_API_URL`) to the Render URL.
4. **Keepalive (cron-job.org)** — two free cron jobs:
   - every **10 min** → `GET https://<render-app>.onrender.com/api/health` (mitigates Render free-tier spin-down, PRD section 13).
   - daily **00:00 UTC** → `POST https://<render-app>.onrender.com/api/reset-quotas` with header `x-admin-token: <ADMIN_TOKEN>` (PRD section 9.3 daily counter reset).
   - Supabase free tier pauses after ~1 week idle — the same health ping can be pointed at a trivial Supabase query via a cron, or bump traffic by chatting (PRD section 13).

> Keys never go in git — env vars on Render only. `GET /api/keypool/status` is token-gated and must stay private (PRD section 10).
