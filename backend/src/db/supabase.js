// Supabase storage adapter — production path (PRD section 6: Supabase Postgres +
// pgvector). Uses the Postgres connection string (DATABASE_URL) directly with pg,
// so the Key Pool Manager queries pool state from the DB as PRD section 11 allows.
import pg from 'pg';
import { encryptMessage, decryptMessage } from '../crypto.js';

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

            create table if not exists push_subscriptions (
            id uuid primary key default gen_random_uuid(),
            user_id text not null default 'local-user',
            endpoint text not null unique,
            p256dh text not null,
            auth text not null,
            created_at timestamptz not null default now(),
            last_notified_at timestamptz,
            last_slot text
          );
          alter table push_subscriptions add column if not exists last_notified_at timestamptz;
          alter table push_subscriptions add column if not exists last_slot text;

          create table if not exists reminders_alarms (
            id uuid primary key default gen_random_uuid(),
            user_id text not null default 'local-user',
            title text not null default 'Reminder',
            message text,
            time text not null,
            days jsonb not null default '[]'::jsonb,
            type text not null default 'alarm',
            enabled boolean not null default true,
            last_fired_date text,
            created_at timestamptz not null default now()
          );
        `);
      } catch (err) {
        console.warn('[storage] schema ensure notice:', err.message);
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
      const encrypted = encryptMessage(content);
      const { rows } = await pool.query(
        'insert into messages (conversation_id, role, content) values ($1, $2, $3) returning *',
        [conversation_id, role, encrypted]
      );
      return { ...rows[0], content }; // caller receives plain content
    },
    async getRecentMessages(conversation_id, limit) {
      const { rows } = await pool.query(
        `select * from (
           select * from messages where conversation_id = $1 order by created_at desc limit $2
         ) t order by created_at asc`,
        [conversation_id, limit]
      );
      return rows.map((r) => ({ ...r, content: decryptMessage(r.content) }));
    },
    async getHistory(conversation_id, { page = 1, limit = 50 }) {
      const total = await pool.query('select count(*)::int as n from messages where conversation_id = $1', [conversation_id]);
      const { rows } = await pool.query(
        `select * from (
           select * from messages where conversation_id = $1 order by created_at desc limit $2 offset $3
         ) t order by created_at asc`,
        [conversation_id, limit, (page - 1) * limit]
      );
      const items = rows.map((r) => ({ ...r, content: decryptMessage(r.content) }));
      return { items, page, limit, total: total.rows[0].n };
    },
    async getLastUserMessageTime() {
      try {
        const { rows } = await pool.query(
          `select created_at from messages where role = 'user' order by created_at desc limit 1`
        );
        return rows[0] ? new Date(rows[0].created_at).getTime() : null;
      } catch {
        return null;
      }
    },

    // ---- memory vectors (RAG, PRD section 8: pgvector cosine similarity) ----
    async insertMemoryVector({ conversation_id, content_chunk, embedding }) {
      const encryptedChunk = encryptMessage(content_chunk);
      const { rows } = await pool.query(
        'insert into memory_vectors (conversation_id, content_chunk, embedding) values ($1, $2, $3::vector) returning id',
        [conversation_id, encryptedChunk, `[${embedding.join(',')}]`]
      );
      return { id: rows[0].id };
    },
    async searchMemory({ userId, conversation_id, embedding, k }) {
      // <=> is pgvector cosine distance; 1 - distance = cosine similarity
      // In companion mode, retrieve relevant memories strictly partitioned by user
      let query = `
        select mv.content_chunk, mv.created_at, 1 - (mv.embedding <=> $1::vector) as similarity
        from memory_vectors mv
        join conversations c on mv.conversation_id = c.id
        where c.user_id = $3
        order by mv.embedding <=> $1::vector limit $2
      `;
      let params = [`[${embedding.join(',')}]`, k, userId];

      if (!userId && conversation_id) {
        query = `
          select mv.content_chunk, mv.created_at, 1 - (mv.embedding <=> $1::vector) as similarity
          from memory_vectors mv
          join conversations c on mv.conversation_id = c.id
          where c.user_id = (select user_id from conversations where id = $3)
          order by mv.embedding <=> $1::vector limit $2
        `;
        params = [`[${embedding.join(',')}]`, k, conversation_id];
      } else if (!userId && !conversation_id) {
        query = `
          select content_chunk, created_at, 1 - (embedding <=> $1::vector) as similarity
          from memory_vectors
          order by embedding <=> $1::vector limit $2
        `;
        params = [`[${embedding.join(',')}]`, k];
      }

      const { rows } = await pool.query(query, params);
      return rows.map((r) => ({
        ...r,
        content_chunk: decryptMessage(r.content_chunk),
      }));
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

    // ---- push_subscriptions (Web Push) ----
    async upsertPushSubscription({ user_id = 'local-user', endpoint, p256dh, auth }) {
      const { rows } = await pool.query(
        `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
         values ($1, $2, $3, $4)
         on conflict (endpoint) do update set
           user_id = excluded.user_id,
           p256dh = excluded.p256dh,
           auth = excluded.auth
         returning *`,
        [user_id, endpoint, p256dh, auth]
      );
      return rows[0];
    },
    async listPushSubscriptions(userId) {
      if (userId) {
        const { rows } = await pool.query('select * from push_subscriptions where user_id = $1 order by created_at desc', [userId]);
        return rows;
      }
      const { rows } = await pool.query('select * from push_subscriptions order by created_at desc');
      return rows;
    },
    async deletePushSubscription(endpoint) {
      const { rowCount } = await pool.query('delete from push_subscriptions where endpoint = $1', [endpoint]);
      return rowCount > 0;
    },
    async recordPushNotification({ endpoint, slot } = {}) {
      try {
        if (endpoint) {
          await pool.query(
            'update push_subscriptions set last_notified_at = now(), last_slot = coalesce($2, last_slot) where endpoint = $1',
            [endpoint, slot || null]
          );
        } else {
          await pool.query(
            'update push_subscriptions set last_notified_at = now(), last_slot = coalesce($1, last_slot)',
            [slot || null]
          );
        }
      } catch (err) {
        console.warn('[storage] recordPushNotification notice:', err.message);
      }
    },
    async getLastPushNotificationTime(userId) {
      try {
        const query = userId
          ? 'select max(last_notified_at) as last_time from push_subscriptions where user_id = $1'
          : 'select max(last_notified_at) as last_time from push_subscriptions';
        const { rows } = await pool.query(query, userId ? [userId] : []);
        return rows[0]?.last_time ? new Date(rows[0].last_time).getTime() : null;
      } catch {
        return null;
      }
    },

    // ---- Alarms & Voice Reminders ----
    async listAlarms(userId) {
      try {
        const query = userId
          ? 'select * from reminders_alarms where user_id = $1 order by time asc'
          : 'select * from reminders_alarms order by time asc';
        const { rows } = await pool.query(query, userId ? [userId] : []);
        return rows.map((r) => ({
          ...r,
          days: Array.isArray(r.days) ? r.days : (r.days ? (typeof r.days === 'string' ? JSON.parse(r.days) : r.days) : []),
        }));
      } catch (err) {
        console.warn('[storage] listAlarms error:', err.message);
        return [];
      }
    },
    async upsertAlarm({ id: alarmId, user_id = 'local-user', title, message, time, days = [], type = 'alarm', enabled = true }) {
      try {
        const daysJson = JSON.stringify(Array.isArray(days) ? days : (days ? String(days).split(',') : []));
        if (alarmId) {
          const { rows } = await pool.query(
            `insert into reminders_alarms (id, user_id, title, message, time, days, type, enabled)
             values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
             on conflict (id) do update set
               title = excluded.title,
               message = excluded.message,
               time = excluded.time,
               days = excluded.days,
               type = excluded.type,
               enabled = excluded.enabled
             returning *`,
            [alarmId, user_id, title || 'Reminder', message || '', time, daysJson, type || 'alarm', enabled !== false]
          );
          return rows[0];
        } else {
          const { rows } = await pool.query(
            `insert into reminders_alarms (user_id, title, message, time, days, type, enabled)
             values ($1, $2, $3, $4, $5::jsonb, $6, $7)
             returning *`,
            [user_id, title || 'Reminder', message || '', time, daysJson, type || 'alarm', enabled !== false]
          );
          return rows[0];
        }
      } catch (err) {
        console.error('[storage] upsertAlarm error:', err.message);
        throw err;
      }
    },
    async deleteAlarm(alarmId) {
      try {
        const { rowCount } = await pool.query('delete from reminders_alarms where id = $1', [alarmId]);
        return rowCount > 0;
      } catch (err) {
        console.error('[storage] deleteAlarm error:', err.message);
        return false;
      }
    },
    async updateAlarmFired(alarmId, dateStr, disable = false) {
      try {
        if (disable) {
          await pool.query('update reminders_alarms set last_fired_date = $2, enabled = false where id = $1', [alarmId, dateStr]);
        } else {
          await pool.query('update reminders_alarms set last_fired_date = $2 where id = $1', [alarmId, dateStr]);
        }
      } catch (err) {
        console.warn('[storage] updateAlarmFired error:', err.message);
      }
    },
  };
}
