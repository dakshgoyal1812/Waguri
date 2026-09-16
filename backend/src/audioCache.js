// In-memory audio cache backing the "audio URL" returned by POST /api/chat
// (PRD section 10). Render free tier has an ephemeral disk, so audio lives in
// memory with an LRU bound — private single-user app, short clips only.
const MAX_ENTRIES = 40;
const cache = new Map(); // id -> { buffer, mime, createdAt }
let seq = 0;

export function storeAudio(buffer, mime) {
  const id = `aud-${Date.now().toString(36)}-${(++seq).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  cache.set(id, { buffer, mime, createdAt: Date.now() });
  while (cache.size > MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    cache.delete(oldest[0]);
  }
  return id;
}

export function getAudio(id) {
  return cache.get(id) || null;
}
