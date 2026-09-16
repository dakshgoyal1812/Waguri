// Storage adapter used by the whole backend (PRD section 7 data model).
// Two implementations:
//   - supabase.js : real Postgres (Supabase) + pgvector — production path
//   - memory.js   : faithful in-memory replica — local dev and tests
export function createMemoryStorage() {
  const now = () => new Date();
  const db = {
    personas: new Map(),
    moods: new Map(),
    conversations: new Map(),
    messages: new Map(), // conversation_id -> [msg]
    memoryVectors: new Map(), // conversation_id -> [{id, content_chunk, embedding, created_at}]
    apiKeys: new Map(), // id -> key row
    usageLog: [],
  };
  let seq = 0;
  const id = () => `id-${++seq}-${Math.random().toString(36).slice(2, 10)}`;
  const clone = (x) => JSON.parse(JSON.stringify(x));

  return {
    kind: 'memory',

    async init() {},

    // ---- personas ----
    async upsertPersona(p) {
      const existing = p.id && db.personas.get(p.id);
      // set generated fields AFTER the spread so explicit `id: undefined`
      // (route destructuring) can't clobber them
      const row = existing
        ? { ...existing, ...p, id: existing.id }
        : { ...p, id: p.id || id(), created_at: now().toISOString() };
      db.personas.set(row.id, row);
      return clone(row);
    },
    async getPersona(pid) { return db.personas.get(pid) ? clone(db.personas.get(pid)) : null; },
    async listPersonas() { return [...db.personas.values()].map(clone); },
    async getDefaultPersona() {
      const rows = [...db.personas.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
      return rows.length ? clone(rows[0]) : null;
    },

    // ---- moods (feeling layer) ----
    async listMoods() {
      return [...db.moods.values()]
        .filter((m) => m.enabled)
        .sort((a, b) => a.priority - b.priority)
        .map(clone);
    },
    async listAllMoods() {
      return [...db.moods.values()].sort((a, b) => a.priority - b.priority).map(clone);
    },
    async upsertMood(m) {
      if (!m.name) throw new Error('mood.name is required');
      const existing = [...db.moods.values()].find((x) => x.name === m.name) ||
        (m.id ? db.moods.get(m.id) : null);
      const row = existing
        ? { ...existing, ...m, id: existing.id, name: existing.name }
        : { trigger_keywords: [], enabled: true, priority: 100, vrm_expression: 'neutral', ...m, id: id(), created_at: now().toISOString() };
      db.moods.set(row.id, row);
      return clone(row);
    },
    async deleteMood(mid) {
      return db.moods.delete(mid);
    },

    // ---- conversations ----
    async createConversation({ persona_id, user_id = 'local-user' }) {
      const row = { id: id(), persona_id: persona_id ?? null, user_id, started_at: now().toISOString() };
      db.conversations.set(row.id, row);
      db.messages.set(row.id, []);
      db.memoryVectors.set(row.id, []);
      return clone(row);
    },
    async getConversation(cid) { return db.conversations.get(cid) ? clone(db.conversations.get(cid)) : null; },

    // ---- messages ----
    async addMessage({ conversation_id, role, content }) {
      const row = { id: id(), conversation_id, role, content, created_at: now().toISOString() };
      db.messages.get(conversation_id).push(row);
      return clone(row);
    },
    async getRecentMessages(conversation_id, limit) {
      const all = db.messages.get(conversation_id) || [];
      return all.slice(-limit).map(clone);
    },
    async getHistory(conversation_id, { page = 1, limit = 50 }) {
      const all = db.messages.get(conversation_id) || [];
      const total = all.length;
      const start = Math.max(0, total - page * limit);
      const items = all.slice(start, start + limit).map(clone); // newest page first, oldest-first inside
      return { items, page, limit, total };
    },

    // ---- memory vectors (RAG) ----
    async insertMemoryVector({ conversation_id, content_chunk, embedding }) {
      const row = { id: id(), conversation_id, content_chunk, embedding, created_at: now().toISOString() };
      db.memoryVectors.get(conversation_id).push(row);
      return { id: row.id };
    },
    async searchMemory({ conversation_id, embedding, k }) {
      const rows = db.memoryVectors.get(conversation_id) || [];
      const cos = (a, b) => {
        let dot = 0, na = 0, nb = 0;
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
        return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
      };
      return rows
        .map((r) => ({ content_chunk: r.content_chunk, created_at: r.created_at, similarity: cos(embedding, r.embedding) }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, k);
    },

    // ---- api_keys ----
    async listKeys(provider) {
      return [...db.apiKeys.values()].filter((k) => k.provider === provider).map(clone);
    },
    async upsertKey({ provider, key_value, account_label = '', daily_quota = 50 }) {
      const found = [...db.apiKeys.values()].find((k) => k.provider === provider && k.account_label === account_label);
      if (found) {
        found.key_value = key_value;
        return clone(found);
      }
      const row = {
        id: id(), provider, key_value, account_label, status: 'active',
        daily_quota, requests_used_today: 0, last_reset_at: now().toISOString(),
        last_failure_at: null, cooldown_expires_at: null,
      };
      db.apiKeys.set(row.id, row);
      return clone(row);
    },
    async updateKey(id, fields) {
      const row = db.apiKeys.get(id);
      if (!row) return null;
      Object.assign(row, fields);
      return clone(row);
    },
    async resetDailyCounters() {
      let n = 0;
      for (const row of db.apiKeys.values()) {
        row.requests_used_today = 0;
        row.last_reset_at = now().toISOString();
        if (row.status !== 'active') row.status = 'active';
        row.cooldown_expires_at = null;
        n++;
      }
      return n;
    },

    // ---- key_usage_log ----
    async logKeyUsage({ key_id, status_code, latency_ms }) {
      db.usageLog.push({ id: db.usageLog.length + 1, key_id, timestamp: now().toISOString(), status_code, latency_ms });
    },
    async getUsageLog(limit = 100) { return db.usageLog.slice(-limit).reverse().map(clone); },

    // test hook
    _db: db,
  };
}
