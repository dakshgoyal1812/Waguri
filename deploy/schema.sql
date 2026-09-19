-- Waguri persona-twin — Supabase / Postgres schema (PRD section 7).
-- Run in Supabase SQL editor. pgvector must be enabled (free tier supports it).

create extension if not exists vector;

-- Embedding dimension must match EMBEDDINGS_DIM in the backend env.
-- jina-embeddings-v3 = 1024. If you switch providers, adjust both.

-- ===== moods (feeling layer: expression + voice tone, all data-driven) =====
-- (created before personas, which references it)
create table if not exists moods (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                 -- 'happy', 'curious', 'excited', ...
  vrm_expression text not null default 'neutral', -- expressionManager preset name
  voice_rate text,                           -- SSML prosody rate, e.g. '+8%' (= speed_modifier)
  voice_pitch text,                          -- SSML prosody pitch, e.g. '+15Hz' (= pitch_modifier)
  trigger_keywords text[] not null default '{}', -- reply-text fallback match
  priority int not null default 100,         -- lower = evaluated first
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- ===== personas =====
create table if not exists personas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  backstory text not null default '',
  personality_traits jsonb not null default '[]'::jsonb,
  location text not null default '',
  speech_style text not null default '',
  -- optional full system-prompt template (placeholders: {name} {location} {traits}
  -- {speech_style} {backstory} {memories}); null = built-in default prompt
  prompt_template text,
  -- LLM sampling temperature for this character (0-2); null = backend default
  base_temperature real,
  -- manual mood lock: when set, this mood overrides auto-detection for every reply
  active_mood_id uuid references moods(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ===== spec-named views (the app's personas/messages tables ARE characters/chat_history;
-- these views keep tooling that expects the spec names working) =====
-- NOTE: defined AFTER the messages table below — a view needs its source table
-- to exist first, and a fresh database previously failed right here.
create view if not exists characters as
  select id, name, prompt_template as system_prompt, base_temperature, active_mood_id, location, speech_style, backstory, personality_traits, created_at
  from personas;

-- ===== conversations =====
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid references personas(id) on delete cascade,
  user_id text not null default 'local-user',
  started_at timestamptz not null default now()
);
create index if not exists conversations_started_idx on conversations (started_at desc);

-- ===== messages =====
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_created_idx
  on messages (conversation_id, created_at);

-- Spec-named view over the messages table (safe here: messages now exists).
create view if not exists chat_history as
  select conversation_id as session_id, role, content, created_at
  from messages;

-- ===== memory_vectors (pgvector, RAG) =====
create table if not exists memory_vectors (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  content_chunk text not null,
  -- vector(1024): keep in sync with EMBEDDINGS_DIM env of the backend
  embedding vector(1024) not null,
  created_at timestamptz not null default now()
);
create index if not exists memory_vectors_conversation_idx
  on memory_vectors (conversation_id);
-- cosine similarity index for top-k retrieval (PRD section 8 step 3)
create index if not exists memory_vectors_embedding_idx
  on memory_vectors using hnsw (embedding vector_cosine_ops);

-- ===== api_keys (key pool state; PRD sections 7 + 9.3) =====
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('openrouter', 'groq', 'nvidia', 'azure_tts', 'fishaudio', 'google', 'gemini', 'minimax')),
  key_value text not null,              -- AES-256-GCM encrypted (see src/crypto.js)
  account_label text not null default '', -- e.g. 'account-1'; azure_tts rows carry the region here
  status text not null default 'active' check (status in ('active', 'cooldown', 'exhausted')),
  daily_quota int not null default 50,
  requests_used_today int not null default 0,
  last_reset_at timestamptz not null default now(),
  last_failure_at timestamptz,
  cooldown_expires_at timestamptz       -- PRD section 9.3 pseudocode uses this column
);
create index if not exists api_keys_provider_status_idx on api_keys (provider, status);
-- upsertKey() relies on (provider, account_label) uniqueness for
-- `on conflict do nothing` — one pool row per account/region.
create unique index if not exists api_keys_provider_label_uidx
  on api_keys (provider, account_label);

-- ===== key_usage_log (PRD section 12: every key failure logged for pool tuning) =====
create table if not exists key_usage_log (
  id bigserial primary key,
  key_id uuid references api_keys(id) on delete set null,
  timestamp timestamptz not null default now(),
  status_code int,
  latency_ms int
);
create index if not exists key_usage_log_key_idx on key_usage_log (key_id, timestamp desc);

-- Single-user private app (PRD section 4): all access happens through the backend
-- holding the service-role connection string, so RLS stays disabled by design.
