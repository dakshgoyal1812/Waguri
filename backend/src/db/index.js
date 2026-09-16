// Storage adapter factory (PRD section 7 data model on Supabase; memory replica
// for local dev / tests when STORAGE_ADAPTER=memory).
import { config } from '../config.js';
import { createMemoryStorage } from './memory.js';
import { createSupabaseStorage } from './supabase.js';

// A .env copied from the template still contains <placeholder> markers. Those are
// "not configured yet", same as an empty value — the backend must boot locally
// (in-memory) instead of crashing. A REAL-looking URL that fails to connect is
// still a hard error: production data must never silently fall back to memory.
function isUnconfigured(url) {
  return !url || /<[^>]+>/.test(url);
}

export async function createStorage() {
  if (config.storageAdapter === 'memory') {
    const s = createMemoryStorage();
    await s.init();
    return s;
  }
  if (isUnconfigured(config.databaseUrl)) {
    console.warn(
      '[storage] STORAGE_ADAPTER=supabase but DATABASE_URL is not set yet — ' +
      'using in-memory storage. Put your Supabase pooler URL in .env ' +
      '(run deploy/schema.sql there first) to persist persona + conversations.'
    );
    const s = createMemoryStorage();
    await s.init();
    return s;
  }
  const s = createSupabaseStorage(config.databaseUrl);
  await s.init();
  return s;
}
