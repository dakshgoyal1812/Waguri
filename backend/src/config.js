// Central env config. All knobs come from environment variables (PRD section 11:
// secrets live in Render env vars, never committed).
//
// Env loading order: backend/.env overrides the repo-root .env (both are loaded;
// keys present in both win from the closer file). The root .env is the single
// place the user keeps every API key (Supabase, OpenRouter, Groq, Azure, ...).
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.env.WAGURI_TEST !== '1') {
  dotenv.config({ path: path.resolve(here, '../../.env') }); // repo root
  dotenv.config({ path: path.resolve(here, '../.env'), override: true }); // backend/
}

const int = (v, d) => (v === undefined || v === '' || isNaN(parseInt(v, 10)) ? d : parseInt(v, 10));
const list = (v) => (v ? v.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) : []);

export const config = {
  port: int(process.env.PORT, 8080),
  // Public base URL used to build absolute audio URLs. Falls back to request host.
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',

  // PRD section 5/11: Supabase Postgres + pgvector in production.
  // STORAGE_ADAPTER=memory is for local dev / tests without a Postgres instance.
  storageAdapter: process.env.STORAGE_ADAPTER || 'supabase',
  databaseUrl: process.env.DATABASE_URL || '',

  // AES-256-GCM key used to encrypt api_keys.key_value at rest (PRD section 7).
  encryptionKey: process.env.APP_ENCRYPTION_KEY || '',

  // Admin token required by /api/reset-quotas and /api/keypool/status (PRD section 10:
  // keypool status must not be exposed publicly).
  adminToken: process.env.ADMIN_TOKEN || '',

  corsOrigins: process.env.CORS_ORIGINS ? list(process.env.CORS_ORIGINS) : ['*'],

  // LLM providers, in failover-tier order (PRD section 9.2: OpenRouter primary pool,
  // Groq/NVIDIA as second tier). Model list stays config, never hardcoded (PRD section 13).
  llmTiers: list(process.env.LLM_PROVIDER_TIERS).length ? list(process.env.LLM_PROVIDER_TIERS) : ['google', 'openrouter', 'minimax', 'groq', 'nvidia'],
  llmProviders: {}, // provider -> { baseUrl, models, defaultModel } filled from env below

  // Embeddings (PRD section 6: OpenRouter or free embeddings API like Jina/Cohere;
  // PRD section 8 step 2). 'hash-test' is a deterministic local fallback for tests.
  embeddings: {
    provider: process.env.EMBEDDINGS_PROVIDER || 'openai-compat',
    baseUrl: process.env.EMBEDDINGS_BASE_URL || 'https://api.jina.ai/v1',
    apiKey: process.env.EMBEDDINGS_API_KEY || '',
    model: process.env.EMBEDDINGS_MODEL || 'jina-embeddings-v3',
    dim: int(process.env.EMBEDDINGS_DIM, 1024),
  },

  // RAG pipeline parameters (PRD section 8: top 5-12 chunks; last N raw messages).
  rag: {
    topK: int(process.env.RAG_TOP_K, 8),
    recentMessages: int(process.env.RAG_RECENT_MESSAGES, 12),
    chunkSize: int(process.env.RAG_CHUNK_SIZE, 500),
    chunkOverlap: int(process.env.RAG_CHUNK_OVERLAP, 60),
  },

  // Web Push Notifications config
  push: {
    vapidPublicKey: (process.env.VAPID_PUBLIC_KEY || 'BK_Ko-huYBFhDJdeAfKiWAL6y5ByzkMG5NLJljpNNbHP3YktTGeor2KllfEJ__-Gog9hTwTz9LemAM3_LHZI09g').trim(),
    vapidPrivateKey: (process.env.VAPID_PRIVATE_KEY || 'FjzdnxU4p1t91xtDwXK-GObaVhFFpDuPDpE0jrUllLg').trim(),
    vapidSubject: (() => {
      const s = (process.env.VAPID_SUBJECT || 'mailto:dakshgoyal1812@gmail.com').trim();
      return (s.startsWith('mailto:') || s.startsWith('https://') || s.startsWith('http://')) ? s : `mailto:${s}`;
    })(),
  },

  // TTS provider chain, first that succeeds wins (Edge TTS / Azure / Fish Audio / Gemini / Google).
  tts: {
    providers: list(process.env.TTS_PROVIDERS).length ? list(process.env.TTS_PROVIDERS) : ['edge', 'azure', 'fishaudio', 'gemini', 'google'],
    geminiModel: process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts',
    geminiVoice: process.env.GEMINI_TTS_VOICE || 'Leda',
    geminiStyle: process.env.GEMINI_TTS_STYLE || 'A soothing female voice with a gentle, empathetic tone. This voice is characterized by a fast, measured pace that creates an intimate and calming atmosphere.',
    // Real Indian female voice: en-IN-NeerjaExpressiveNeural (with en-IN-NeerjaNeural fallback)
    voice: process.env.TTS_VOICE || 'en-IN-NeerjaExpressiveNeural',
    // Bilingual output: replies containing Devanagari auto-switch to a Hindi voice.
    voiceHindi: process.env.TTS_VOICE_HINDI || 'hi-IN-SwaraNeural',
    fishBaseUrl: process.env.FISH_AUDIO_BASE_URL || 'https://api.fish.audio',
    // "Anime girl" / "Girl with a anime like cute women" Fish Audio model ID
    fishReferenceId: process.env.FISH_AUDIO_REFERENCE_ID || '69eb6788dfae49cbad7ab498f459fb80',
  },

  // Cooldown window for a per-minute rate limit (PRD section 9.3: 60s).
  cooldownPerMinuteMs: int(process.env.COOLDOWN_PER_MINUTE_MS, 60_000),

  // Key pool cache flush interval (PRD section 9.3: sync to Supabase every few
  // seconds or on change, not on every request).
  poolFlushIntervalMs: int(process.env.POOL_FLUSH_INTERVAL_MS, 5_000),

  // OpenRouter is OpenAI-compatible; base URL overridable for tests and for the
  // Groq/NVIDIA second tier (both also OpenAI-compatible).
  requestTimeoutMs: int(process.env.REQUEST_TIMEOUT_MS, 60_000),
};

function providerFromEnv(name) {
  const upper = name.toUpperCase().replace(/-/g, '_');
  let models = list(process.env[`LLM_MODELS_${upper}`]);
  if (!models.length && name === 'openrouter') {
    models = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'openrouter/free'];
  }
  const baseUrl = process.env[`LLM_BASE_URL_${upper}`] || defaultBaseUrl(name);
  return {
    baseUrl,
    // A provider tier with no configured model list contributes no calls but the
    // tier stays declared so keys can be added later without code changes.
    models: models.length ? models : [],
  };
}

function defaultBaseUrl(name) {
  switch (name) {
    case 'openrouter': return 'https://openrouter.ai/api/v1';
    case 'groq': return 'https://api.groq.com/openai/v1';
    case 'nvidia': return 'https://integrate.api.nvidia.com/v1';
    case 'google':
    case 'gemini': return 'https://generativelanguage.googleapis.com/v1beta/openai';
    case 'minimax': return 'https://api.minimax.chat/v1';
    default: return '';
  }
}

for (const tier of config.llmTiers) config.llmProviders[tier] = providerFromEnv(tier);

export function collectKeys(provider, extraEnvs = []) {
  const upper = provider.toUpperCase().replace(/-/g, '_');
  const result = [];
  const add = (k) => {
    if (typeof k === 'string') {
      const trimmed = k.trim();
      if (trimmed && !result.includes(trimmed)) result.push(trimmed);
    }
  };

  // 1. Check numbered sequence: PROVIDER_API_KEY_1, PROVIDER_API_KEY_2...
  let i = 1;
  while (process.env[`${upper}_API_KEY_${i}`] || process.env[`${upper}_KEY_${i}`]) {
    const val = process.env[`${upper}_API_KEY_${i}`] || process.env[`${upper}_KEY_${i}`];
    if (val) add(val);
    i++;
  }

  // 2. Check extra aliases in sequence or lists (e.g. GEMINI_API_KEY_1)
  for (const prefix of extraEnvs) {
    let j = 1;
    while (process.env[`${prefix}_${j}`]) {
      add(process.env[`${prefix}_${j}`]);
      j++;
    }
    if (process.env[prefix]) {
      list(process.env[prefix]).forEach(add);
    }
  }

  // 3. Check plural or singular env vars
  if (process.env[`${upper}_API_KEYS`]) list(process.env[`${upper}_API_KEYS`]).forEach(add);
  if (process.env[`${upper}_API_KEY`]) add(process.env[`${upper}_API_KEY`]);

  return result;
}

// Seed keys from env on boot (PRD section 11: keys in Render environment variables).
// Supports sequential keys (PROVIDER_API_KEY_1, ...), comma-separated, or newline-separated.
export const seedKeys = {
  openrouter: collectKeys('openrouter'),
  azure_tts: collectKeys('azure_tts', ['AZURE_TTS_KEYS']).map((s) => {
    const i = s.indexOf(':');
    return i === -1 ? { region: '', key: s } : { region: s.slice(0, i), key: s.slice(i + 1) };
  }),
  groq: collectKeys('groq'),
  nvidia: collectKeys('nvidia'),
  google: collectKeys('google', ['GEMINI_API_KEYS', 'GEMINI_API_KEY']),
  minimax: collectKeys('minimax'),
  fishaudio: collectKeys('fishaudio', ['FISH_AUDIO_API_KEY', 'FISH_AUDIO_API_KEYS']),
};

// Sync back to process.env.*_API_KEYS and process.env.*_API_KEY for legacy/downstream consumers
for (const [k, arr] of Object.entries(seedKeys)) {
  const upper = k.toUpperCase().replace(/-/g, '_');
  const str = arr.map((x) => (typeof x === 'string' ? x : `${x.region}:${x.key}`)).join(',');
  if (!process.env[`${upper}_API_KEYS`] && str) process.env[`${upper}_API_KEYS`] = str;
  if (!process.env[`${upper}_API_KEY`] && arr[0]) {
    process.env[`${upper}_API_KEY`] = typeof arr[0] === 'string' ? arr[0] : arr[0].key;
  }
}
