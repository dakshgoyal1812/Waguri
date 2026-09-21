// Supabase storage adapter — production path (PRD section 6: Supabase Postgres +
// pgvector). Uses the Postgres connection string (DATABASE_URL) directly with pg,
// so the Key Pool Manager queries pool state from the DB as PRD section 11 allows.
import pg from 'pg';

export function createSupabaseStorage(databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });

  return {
    kind: 'supabase',

    async init() {
      const { rows } = await pool.query('select 1 as ok');
      if (rows[0].ok !== 1) throw new Error('Supabase health check failed');
      try {
        await pool.query(`
          create table if not exists allowed_users (
            email text primary key,
            added_by text default 'admin',
            created_at timestamptz not null default now()
          );
          insert into allowed_users (email, added_by)
          values
            ('dakshgoyal1812@gmail.com', 'system'),
            ('goyaldaksh284@gmail.com', 'system')
          on conflict (email) do nothing;
        `);
      } catch (err) {
        console.warn('[storage] allowed_users table ensure notice:', err.message);
      }
    },

    // ---- personas ----
    async upsertPersona(p) {
      // Explicit null on a lockable column means CLEAR it — the main upsert's
      // coalesce would otherwise keep the old value forever. (Single-user app:
      // when no id is given, the clear applies to the default persona's row.)
      const clearCols = [];
      if (p.active_mood_id === null) clearCols.push('active_mood_id = null');
      if (p.base_temperature === null) clearCols.push('base_temperature = null');
      if (clearCols.length) {
        if (p.id) await pool.query(`update personas set ${clearCols.join(', ')} where id = $1`, [p.id]);
        else await pool.query(`update personas set ${clearCols.join(', ')}`);
      }
      const { rows } = await pool.query(
        `insert into personas (id, name, backstory, personality_traits, location, speech_style, prompt_template, base_temperature, active_mood_id)
         values (coalesce($1, gen_random_uuid()), $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
         on conflict (id) do update set
           name = excluded.name, backstory = excluded.backstory,
           personality_traits = excluded.personality_traits,
           location = excluded.location, speech_style = excluded.speech_style,
           prompt_template = coalesce(excluded.prompt_template, personas.prompt_template),
           base_temperature = coalesce(excluded.base_temperature, personas.base_temperature),
           active_mood_id = coalesce(excluded.active_mood_id, personas.active_mood_id)
         returning *`,
        [p.id || null, p.name, p.backstory || '', JSON.stringify(p.personality_traits || []), p.location || '', p.speech_style || '',
         p.prompt_template ?? null, p.base_temperature ?? null, p.active_mood_id ?? null]
      );
      return rows[0];
    },
    async getPersona(pid) {
      const { rows } = await pool.query('select * from personas where id = $1', [pid]);
      return rows[0] || null;
    },
    async listPersonas() {
      const { rows } = await pool.query('select * from personas order by created_at');
      return rows;
    },
    async getDefaultPersona() {
      const { rows } = await pool.query('select * from personas order by created_at limit 1');
      return rows[0] || null;
    },

    // ---- moods (feeling layer) ----
    async listMoods() {
      const { rows } = await pool.query(
        'select * from moods where enabled order by priority asc, created_at asc'
      );
      return rows;
    },
    async listAllMoods() {
      const { rows } = await pool.query('select * from moods order by priority asc, created_at asc');
      return rows;
    },
    async upsertMood(m) {
      if (!m.name) throw new Error('mood.name is required');
      const { rows } = await pool.query(
        `insert into moods (name, vrm_expression, voice_rate, voice_pitch, trigger_keywords, priority, enabled)
         values ($1, $2, $3, $4, $5::text[], $6, $7)
         on conflict (name) do update set
           vrm_expression = excluded.vrm_expression,
           voice_rate = excluded.voice_rate,
           voice_pitch = excluded.voice_pitch,
           trigger_keywords = excluded.trigger_keywords,
           priority = excluded.priority,
           enabled = excluded.enabled
         returning *`,
        [m.name, m.vrm_expression || 'neutral', m.voice_rate || null, m.voice_pitch || null,
         m.trigger_keywords || [], m.priority ?? 100, m.enabled ?? true]
      );
      return rows[0];
    },
    async deleteMood(mid) {
      const { rowCount } = await pool.query('delete from moods where id = $1', [mid]);
      return rowCount > 0;
    },

    // ---- conversations ----
    async createConversation({ persona_id, user_id = 'local-user' }) {
      const { rows } = await pool.query(
        'insert into conversations (persona_id, user_id) values ($1, $2) returning *',
        [persona_id ?? null, user_id]
      );
      return rows[0];
    },
    async getConversation(cid) {
      const { rows } = await pool.query('select * from conversations where id = $1', [cid]);
      return rows[0] || null;
    },
    async getLatestConversation(userId = 'local-user') {
      const { rows } = await pool.query(
        'select * from conversations where user_id = $1 order by started_at desc limit 1',
        [userId]
      );
      return rows[0] || null;
    },

    // ---- messages ----
    async addMessage({ conversation_id, role, content }) {
      const { rows } = await pool.query(
        'insert into messages (conversation_id, role, content) values ($1, $2, $3) returning *',
        [conversation_id, role, content]
      );
      return rows[0];
    },
    async getRecentMessages(conversation_id, limit) {
      const { rows } = await pool.query(
        `select * from (
           select * from messages where conversation_id = $1 order by created_at desc limit $2
         ) t order by created_at asc`,
        [conversation_id, limit]
      );
      return rows;
    },
    async getHistory(conversation_id, { page = 1, limit = 50 }) {
      const total = await pool.query('select count(*)::int as n from messages where conversation_id = $1', [conversation_id]);
      const { rows } = await pool.query(
        `select * from (
           select * from messages where conversation_id = $1 order by created_at desc limit $2 offset $3
         ) t order by created_at asc`,
        [conversation_id, limit, (page - 1) * limit]
      );
      return { items: rows, page, limit, total: total.rows[0].n };
    },

    // ---- memory vectors (RAG, PRD section 8: pgvector cosine similarity) ----
    async insertMemoryVector({ conversation_id, content_chunk, embedding }) {
      const { rows } = await pool.query(
        'insert into memory_vectors (conversation_id, content_chunk, embedding) values ($1, $2, $3::vector) returning id',
        [conversation_id, content_chunk, `[${embedding.join(',')}]`]
      );
      return { id: rows[0].id };
    },
    async searchMemory({ conversation_id, embedding, k }) {
      // <=> is pgvector cosine distance; 1 - distance = cosine similarity
      // In single-user companion mode, retrieve relevant memories across all past
      // exchanges so Waguri permanently remembers across conversations/sessions.
      const { rows } = await pool.query(
        `select content_chunk, created_at, 1 - (embedding <=> $1::vector) as similarity
         from memory_vectors
         order by embedding <=> $1::vector limit $2`,
        [`[${embedding.join(',')}]`, k]
      );
      return rows;
    },

    // ---- api_keys ----
    async listKeys(provider) {
      if (provider) {
        const { rows } = await pool.query('select * from api_keys where provider = $1', [provider]);
        return rows;
      }
      const { rows } = await pool.query('select * from api_keys');
      return rows;
    },
    async upsertKey({ provider, key_value, account_label = '', daily_quota = 50 }) {
      const { rows } = await pool.query(
        `insert into api_keys (provider, key_value, account_label, daily_quota)
         values ($1, $2, $3, $4)
         on conflict do nothing
         returning *`,
        [provider, key_value, account_label, daily_quota]
      );
      if (rows.length) return rows[0];
      const existing = await pool.query(
        'select * from api_keys where provider = $1 and account_label = $2', [provider, account_label]
      );
      return existing.rows[0];
    },
    async updateKey(id, fields) {
      const allowed = ['status', 'requests_used_today', 'last_failure_at', 'cooldown_expires_at', 'last_reset_at', 'daily_quota'];
      const sets = [], vals = [];
      let i = 1;
      for (const f of allowed) {
        if (f in fields) { sets.push(`${f} = $${i++}`); vals.push(fields[f]); }
      }
      if (!sets.length) return null;
      vals.push(id);
      const { rows } = await pool.query(`update api_keys set ${sets.join(', ')} where id = $${i} returning *`, vals);
      return rows[0] || null;
    },
    async resetDailyCounters() {
      const { rowCount } = await pool.query(
        `update api_keys set requests_used_today = 0, last_reset_at = now(),
           status = 'active', cooldown_expires_at = null`
      );
      return rowCount;
    },

    // ---- key_usage_log ----
    async logKeyUsage({ key_id, status_code, latency_ms }) {
      await pool.query(
        'insert into key_usage_log (key_id, status_code, latency_ms) values ($1, $2, $3)',
        [key_id, status_code, latency_ms]
      );
    },
    async getUsageLog(limit = 100) {
      const { rows } = await pool.query(
        'select * from key_usage_log order by timestamp desc limit $1', [limit]
      );
      return rows;
    },

    // ---- allowed_users (auth whitelist) ----
    async listAllowedUsers() {
      const { rows } = await pool.query(
        'select email, added_by, created_at from allowed_users order by created_at desc'
      );
      return rows;
    },
    async addAllowedUser(email, addedBy = 'admin') {
      const clean = email.trim().toLowerCase();
      await pool.query(
        'insert into allowed_users (email, added_by) values ($1, $2) on conflict (email) do nothing',
        [clean, addedBy]
      );
      return this.listAllowedUsers();
    },
    async removeAllowedUser(email) {
      const clean = email.trim().toLowerCase();
      await pool.query('delete from allowed_users where email = $1', [clean]);
      return this.listAllowedUsers();
    },
  };
}
