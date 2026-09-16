// Key Pool Manager — PRD section 9.3 (the core ask).
//
// getNextKey(provider): active keys ordered by requests_used_today ASC; if none
// active, reactivate cooldown keys whose cooldown_expires_at has passed.
//
// Failure semantics: 429 -> cooldown (60s for a per-minute limit, midnight UTC for
// a daily limit); 401/402/403 -> exhausted; other failures -> short cooldown so the
// caller immediately retries with the next key. No user-facing delay (section 9.3).
//
// State lives in memory and is synced to storage on change / every few seconds
// (section 9.3: "well under 300ms added latency per key switch").
import { config, seedKeys } from '../config.js';
import { encryptSecret, decryptSecret } from '../crypto.js';

export class PoolExhaustedError extends Error {
  constructor(providerLabel) {
    super(`All keys in the pool are exhausted for: ${providerLabel}`);
    this.name = 'PoolExhaustedError';
    this.status = 503;
  }
}

function nextMidnightUTC() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
}

// Classify a 429 into a cooldown expiry: per-minute limits get 60s, daily limits
// run until midnight UTC (PRD section 9.3).
export function cooldownExpiryFrom429(message) {
  const m = String(message || '');
  if (/per[-_ ]?day|daily|quota|credit|billing/i.test(m)) return nextMidnightUTC();
  return new Date(Date.now() + config.cooldownPerMinuteMs);
}

export class KeyPool {
  constructor(storage) {
    this.storage = storage;
    // provider -> array of key state objects (in-memory source of truth)
    this.cache = new Map();
    this.dirty = new Set(); // key ids needing persistence
    this.flushTimer = null;
  }

  async init() {
    await this.seedFromEnv();
    await this.loadAll();
    await this.resetStaleDailyCounters();
    this.flushTimer = setInterval(() => { this.flush().catch(() => {}); }, config.poolFlushIntervalMs);
    this.flushTimer.unref?.();
  }

  async stop() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush();
  }

  // PRD section 11: keys arrive as Render environment variables; they are encrypted
  // and persisted into api_keys so the pool manager owns them from then on.
  async seedFromEnv() {
    const quotaEnv = (name, d) => parseInt(process.env[name] || '', 10) || d;
    const quotas = {
      openrouter: quotaEnv('OPENROUTER_DAILY_QUOTA', 50),
      groq: quotaEnv('GROQ_DAILY_QUOTA', 1000),
      nvidia: quotaEnv('NVIDIA_DAILY_QUOTA', 40),
      google: quotaEnv('GOOGLE_DAILY_QUOTA', 1500),
      gemini: quotaEnv('GEMINI_DAILY_QUOTA', 1500),
      minimax: quotaEnv('MINIMAX_DAILY_QUOTA', 1000),
      azure_tts: quotaEnv('AZURE_TTS_DAILY_QUOTA', 500),
      fishaudio: quotaEnv('FISHAUDIO_DAILY_QUOTA', 50),
    };
    for (const [provider, keys] of Object.entries(seedKeys)) {
      // Skip template/placeholder values copied from .env.example ("sk-or-v1-xxx…",
      // "<your-key>") — seeding a fake key would just burn requests on 401s.
      const real = keys.filter((k) => {
        const raw = typeof k === 'string' ? k : k.key;
        return raw && !/x{4,}/i.test(raw) && !/[<>]/.test(raw);
      });
      if (!real.length) continue;
      const existing = await this.storage.listKeys(provider);
      if (existing.length > 0) continue;
      for (let i = 0; i < real.length; i++) {
        const entry = typeof real[i] === 'string'
          ? { region: '', key: real[i] }
          : real[i];
        const label = provider === 'azure_tts'
          ? entry.region || `account-${i + 1}` // azure region rides on account_label
          : `account-${i + 1}`;
        await this.storage.upsertKey({
          provider,
          key_value: encryptSecret(entry.key),
          account_label: label,
          daily_quota: quotas[provider] ?? 50,
        });
      }
    }
  }

  async loadAll() {
    const providers = new Set([
      ...config.llmTiers,
      'azure_tts', 'fishaudio', // TTS keyed pools (PRD sections 9.4 / 6)
    ]);
    for (const provider of providers) {
      const rows = await this.storage.listKeys(provider);
      this.cache.set(provider, rows.map((r) => this.inflate(r)));
    }
  }

  inflate(row) {
    return {
      id: row.id,
      provider: row.provider,
      account_label: row.account_label,
      status: row.status,
      daily_quota: row.daily_quota,
      requests_used_today: row.requests_used_today,
      last_reset_at: row.last_reset_at,
      last_failure_at: row.last_failure_at,
      cooldown_expires_at: row.cooldown_expires_at,
      secret: row.key_value ? decryptSecret(row.key_value) : '', // decrypted, memory-only
    };
  }

  // Daily counters reset at midnight UTC via /api/reset-quotas (PRD section 9.3);
  // this boot-time check catches a backend that was down when the cron fired.
  async resetStaleDailyCounters() {
    const today = new Date().toISOString().slice(0, 10);
    for (const [, keys] of this.cache) {
      for (const k of keys) {
        if (String(k.last_reset_at).slice(0, 10) !== today) {
          k.requests_used_today = 0;
          k.last_reset_at = new Date().toISOString();
          if (k.status === 'cooldown' || k.status === 'exhausted') { k.status = 'active'; k.cooldown_expires_at = null; }
          this.dirty.add(k.id);
        }
      }
    }
    await this.flush();
  }

  // True when the provider has NO keys configured at all (as opposed to keys
  // that are all cooling down / exhausted). Local dev against a mock or a
  // self-hosted OpenAI-compatible server (LLM_BASE_URL_*) legitimately has no
  // keys — the caller then uses keyless mode instead of "pool exhausted".
  async hasKeys(provider) {
    let keys = this.cache.get(provider);
    if (!keys) { keys = (await this.storage.listKeys(provider)).map((r) => this.inflate(r)); this.cache.set(provider, keys); }
    return keys.length > 0;
  }

  // PRD section 9.3 pseudocode, verbatim semantics.
  async getNextKey(provider) {
    let keys = this.cache.get(provider);
    if (!keys) { keys = (await this.storage.listKeys(provider)).map((r) => this.inflate(r)); this.cache.set(provider, keys); }

    const byLeastUsed = (a, b) => a.requests_used_today - b.requests_used_today;
    let active = keys.filter((k) => k.status === 'active').sort(byLeastUsed);
    if (active.length === 0) {
      // Reactivate any key whose cooldown has passed (PRD section 9.3).
      const now = Date.now();
      for (const k of keys) {
        if (k.status === 'cooldown' && k.cooldown_expires_at && new Date(k.cooldown_expires_at).getTime() < now) {
          k.status = 'active';
          k.cooldown_expires_at = null;
          this.dirty.add(k.id);
        }
      }
      active = keys.filter((k) => k.status === 'active').sort(byLeastUsed);
    }
    return active[0] || null;
  }

  // PRD section 9.3: increment requests_used_today on a successful call.
  async markSuccess(keyId) {
    const k = this.find(keyId);
    if (!k) return;
    k.requests_used_today += 1;
    this.dirty.add(k.id);
  }

  async markCooldown(keyId, expiresAt) {
    const k = this.find(keyId);
    if (!k) return;
    k.status = 'cooldown';
    k.cooldown_expires_at = expiresAt.toISOString();
    k.last_failure_at = new Date().toISOString();
    this.dirty.add(k.id);
  }

  async markExhausted(keyId) {
    const k = this.find(keyId);
    if (!k) return;
    k.status = 'exhausted';
    k.last_failure_at = new Date().toISOString();
    this.dirty.add(k.id);
  }

  find(keyId) {
    for (const [, keys] of this.cache) {
      const k = keys.find((x) => x.id === keyId);
      if (k) return k;
    }
    return null;
  }

  // PRD section 12: every key failure (and call latency) lands in key_usage_log.
  async recordUsage(keyId, statusCode, latencyMs) {
    try { await this.storage.logKeyUsage({ key_id: keyId, status_code: statusCode, latency_ms: latencyMs }); } catch { /* logging must never break the call path */ }
  }

  // Debounced write-through: memory first, storage every few seconds or on change
  // (PRD section 9.3 latency target).
  async flush() {
    if (!this.dirty.size) return;
    const ids = [...this.dirty];
    this.dirty.clear();
    for (const id of ids) {
      const k = this.find(id);
      if (!k) continue;
      try {
        await this.storage.updateKey(id, {
          status: k.status,
          requests_used_today: k.requests_used_today,
          cooldown_expires_at: k.cooldown_expires_at,
          last_failure_at: k.last_failure_at,
          last_reset_at: k.last_reset_at,
        });
      } catch { /* retried by the periodic flush if it fails again */ }
    }
  }

  async forceDailyReset() {
    for (const [, keys] of this.cache) {
      for (const k of keys) {
        k.requests_used_today = 0;
        k.last_reset_at = new Date().toISOString();
        k.status = 'active';
        k.cooldown_expires_at = null;
        this.dirty.add(k.id);
      }
    }
    await this.storage.resetDailyCounters();
    await this.flush();
  }

  // Debug view for GET /api/keypool/status (PRD section 10) — never exposes secrets.
  status() {
    const out = {};
    for (const [provider, keys] of this.cache) {
      out[provider] = keys.map((k) => ({
        id: k.id,
        account_label: k.account_label,
        status: k.status,
        requests_used_today: k.requests_used_today,
        daily_quota: k.daily_quota,
        cooldown_expires_at: k.cooldown_expires_at,
        last_failure_at: k.last_failure_at,
      }));
    }
    return out;
  }
}
