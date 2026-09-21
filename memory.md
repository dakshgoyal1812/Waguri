# Project Memory

## Overview
Waguri — Neuro-sama-inspired AI VTuber companion ("soul container"): VRM 1.0 avatar + voice chat (EN/Hinglish/Hindi) + games + RAG memory. Stack: Vite/React frontend (Vercel), Express backend (Render), Supabase Postgres+pgvector, OpenRouter multi-key LLM pool, Edge/Azure TTS pool. Entries: `frontend/src/App.jsx`, `backend/src/server.js`, `room-stage.html` (standalone 3D scene).

## Architecture
- `backend/src/server.js` — all routes: /api/chat, /api/idle-comment, /api/game/*, /api/stt, /api/tts, /api/persona, /api/moods, /api/character/update, /api/keypool/status, /api/reset-quotas (admin-gated via `x-admin-token`)
- `backend/src/keys/keyPool.js` — multi-key rotation: least-used-first, 429→60s/min or midnight-UTC/daily cooldown, 401/402→exhausted; memory cache + debounced Supabase flush
- `backend/src/llm/{caller,openaiCompat}.js` — tier failover (openrouter→groq→nvidia), models = env config; temperature from `personas.base_temperature`
- `backend/src/orchestrator/chat.js` — chat pipeline: RAG retrieve → persona prompt → LLM → emotion tag → mood engine → TTS w/ prosody → async memory store; also `idleComment` (autonomous lines)
- `backend/src/mood/engine.js` — feeling layer: user-sentiment empathy mirror (EN+Hinglish keywords) → persona.active_mood_id lock → reply [tag] → reply keywords → neutral; 30s palette cache
- `backend/src/games/index.js` — tictactoe/rps/twentyq; rules server-authoritative, LLM narrates + picks among legal moves, fallback random on parse fail
- `backend/src/tts/*` — pool edge→azure→google; Devanagari text auto-switches to `TTS_VOICE_HINDI`; prosody (rate/pitch) from mood
- `backend/src/db/{memory,supabase}.js` — twin storage adapters (memory = dev/tests, supabase = prod)
- `frontend/src/components/AvatarCanvas.jsx` — three-vrm render: vowel-competition lip-sync, emotion BLENDS, saccades, blink, rest pose, eyes-only cursor tracking, entrance bow
- `frontend/src/useVoiceInput.js` — Web Speech API hands-free (lang switchable en-IN/hi-IN), barge-in, auto-send
- `frontend/src/components/{ChatPanel,GamePanel,PersonaModal,KeyPoolModal,BackgroundPicker,WaveBackground}.jsx` — AIRI-style UI
- `tools/optimize-vrm.mjs` + `tools/verify-vrm.mjs` — VRM optimizer (16.8→1.8MB) with VRM-metadata remap/re-inject + semantic verifier
- `deploy/schema.sql` (moods/views/unique idx), `deploy/render.yaml`

## Decisions Log
- 2026-09-15: Mood = DB rows not code — persona/mood editable in Supabase without redeploy (explicit user requirement).
- 2026-09-15: Game rules server-authoritative, LLM only narrates/chooses legal moves — hallucinated moves corrupt games; random fallback if LLM fails.
- 2026-09-15: STT primary = Web Speech API (free, streaming, barge-in); Groq Whisper /api/stt only as fallback — zero key exposure.
- 2026-09-15: gltf-transform optimize corrupts VRMs by default (flatten/join/palette/prune/simplify + drops VRMC_vrm) → all flags off + metadata snapshot/remap/re-inject post-process.
- 2026-09-15: three-vrm cleanup utils (removeUnnecessaryVertices/Joints) wrapped in try/catch — meshopt always emits interleaved buffers which they reject; skipping costs only memory.
- 2026-09-15: Lip-sync = wLipSync-style vowel competition (F1×F2 formant products, hysteresis) over band-blending — crisper mouth (airi parity).
- 2026-09-15: Emotions = multi-expression blends with capped weights (happy=.7happy+.2aa, airi #590 fix); decay to neutral after 7.5s — moods are reactions not masks.
- 2026-09-15: Eyes-only cursor tracking (head ~12% follow) + verbatim airi saccade intervals — head-follow read as "staring".
- 2026-09-15: Chat card / theme / background persisted in localStorage; stale conversation_id self-heals on 404 (backend restart wipes memory storage).
- 2026-09-15: Secrets only in backend env; frontend talks only to own /api/*; keypool/status + moods + character/update admin-token gated.
- 2026-09-21: AIRI-style floating transparent chat UI implemented: opaque white card removed; messages float over avatar with top fade mask; frosted white user pills, translucent ice-cyan AI pills with #0284c7 text; floating capsule input bar with paperclip icon; natural mobile portrait camera framing; auth gate and loading screens preserved intact.
- 2026-09-21: Avatar picker button (.vrm-fab) removed from main stage; integrated into BackgroundPicker modal under tabs [🖼️ Background] and [👤 Avatar] for a clean, unobstructed screen.

## Current State
- All PRD milestone suites (M1-M6) pass: `backend` → `node test/run-all.js` (M1 needs port 9090 free — stop any manual mock first); games unit tests pass; bilingual (EN/Hinglish/Hindi TTS voice switch) verified with real Edge TTS.
- AIRI-style UI live: dark/light themes, floating chat card, FAB row, wave/transparent/custom backgrounds, contextual thinking lines — verified vs reference screenshots.
- 2026-09-16 fixes: (a) root `.env` now single config source (backend/src/config.js loads `../.env` then `backend/.env` with override); (b) boot never crashes on missing config — placeholder/empty DATABASE_URL falls back to memory storage, missing APP_ENCRYPTION_KEY or all-empty key pools are handled, template-shaped keys (`xxxx`, `<...>`) are never seeded; (c) **CORS bug fixed**: `cors({origin:['*']})` matches literally → no ACAO header → `<audio crossOrigin="anonymous">` got MediaError 4 "no supported source" → NO sound and NO lip-sync (this was the user's core complaint); now `origin: true` reflects request origin when `*` configured; (d) lip-sync analyser init is persistent (re-arms on every `play`, resumes suspended AudioContext, guards createMediaElementSource by element identity); (e) whole-body speech motion: voice-energy envelope drives chest/spine/head nod + arm micro-sway (airi-style full-body aliveness) on top of breathing/sway/idle gestures; (f) `POST /api/tts/url` re-synthesizes a message's voice → fresh audio_url; App.jsx self-heals dead audio by calling it with the message text (Play Voice on any message, even after restarts); (g) UI: PersonaModal + KeyPoolModal deleted (no roleplay/persona editing, no API-key UI); persona & history fetched from backend (Supabase in prod), chat history no longer stored in localStorage; (h) keyless LLM mode: provider tier with models but zero pool keys gets one direct keyless attempt (mock/self-hosted dev works zero-config); (i) **Microphone & Speech Recognition overhaul**: fixed Web Speech API `InvalidStateError` stalls on restart by recreating fresh instances; added silence debounce timer (1.3s) and transcript buffer to prevent interim speech loss; tied barge-in to acoustic speech detection; integrated Web Audio API Analyser for real-time mic volume bars and speaking indicator; repaired backend `/api/stt` with raw buffer stream handling and Groq Whisper transcription fallback.
- Voice chat hands-free + barge-in works in Chromium; games playable via panel, she narrates via TTS.
- E2E verified in browser: chat → edge TTS → audio plays → viseme probe `window.__waguriAvatar.visemes()` shows oh=0.90/ou=0.64 & energy=0.99 during speech; microphone voice input tested and verified in live browser.
- Local dev stack currently RUNNING: backend :8080 (memory storage, mock LLM via LLM_BASE_URL_OPENROUTER), mock-openrouter needs restart on :9090 (stopped for M1 test), frontend `npm run dev` :5173.
- Real OpenRouter/Supabase keys not yet filled in root `.env` (APP_ENCRYPTION_KEY generated; OPENROUTER/GROQ keys empty; DATABASE_URL placeholder → memory storage).

## Next Steps / TODO
- Deploy: run deploy/schema.sql in Supabase, Render blueprint (deploy/render.yaml), Vercel frontend; set real keys (OPENROUTER_API_KEYS, GROQ_API_KEYS, EMBEDDINGS_API_KEY, ADMIN_TOKEN, APP_ENCRYPTION_KEY 64-hex).
- Add cron-job.org: 10-min /api/health keepalive + 00:00 UTC /api/reset-quotas (x-admin-token header).
- Test failover with real OpenRouter keys (mock 429s already covered by M6).
- Streaming LLM/TTS for lower voice latency; persistent game sessions in Supabase; KTX2 textures for VRAM; external game world (Minecraft) if desired.

## Gotchas
- msedge-tts must be ≥2.0 (1.x fails Sec-MS-GEC DRM → "Connect Error [object Object]"); `close()` is sync void — never `.catch()` it (throws TypeError).
- Meshopt VRMs = interleaved buffers → three-vrm `removeUnnecessaryVertices` throws; always try/catch. gltf-transform flag set in tools/optimize-vrm.mjs is load-bearing.
- GLB JSON chunk starts at byte 20; naive `slice(20,...)` JSON.parse needs exact length.
- Windows/Git Bash: `execFileSync('npx')` needs `npx.cmd` + `shell:true` (Node≥20 EINVAL); background `&` commands die with their shell — use run_in_background tasks; zombie node procs hold ports → kill via netstat PID lookup.
- Express 404 catch-all must be registered AFTER all routes.
- Express.json + supabase adapter: clearing persona fields needs explicit null (route uses `'field' in body`; SQL coalesce keeps old values otherwise).
- Emotion props into AvatarCanvas must go through refs (rAF loop in mount-only effect — stale closures froze emotions/lip-sync once).
- persona.active_mood_id = manual mood lock (beats everything) — user tests may leave it set; clear via POST /api/character/update {"active_mood_id":null}.
