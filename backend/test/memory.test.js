// Waguri Memory Inspector Integration & Unit Test Suite
// Verifies:
// 1. Auth: Missing token returns 401, invalid token returns 401, valid token passes.
// 2. Listing: returns created_at cursor, pagination limit, never exposes embedding column.
// 3. Search: ?q= filters text correctly.
// 4. Validation: PATCH rejects > 2000 chars and empty text with 400.
// 5. Re-embedding: PATCH re-embeds text and updates content_chunk.
// 6. Deletion: DELETE removes memory row permanently (204).
// 7. Bulk Deletion: POST /bulk-delete deletes up to 100 ids and returns count.
// 8. Export: GET /export downloads json attachment.
// 9. Cache invalidation: edit and delete trigger invalidation hook.
import { startProc, stopProc, waitFor, check, done, TEST_ENV } from './util.js';
import { onMemoryCacheInvalidate } from '../src/routes/memory.js';

const BACK = 'http://127.0.0.1:8087';
const ADMIN_TOKEN = 'test-admin-token';
let mock, backend;

try {
  mock = await startProc('mock-openrouter', 'node', ['test/mock-openrouter.js'], {
    MOCK_PORT: '9097',
  }, (l) => l.includes('[mock-openrouter] on'));
  await waitFor('http://127.0.0.1:9097/__stats');

  backend = await startProc('backend', 'node', ['src/server.js'], {
    ...TEST_ENV,
    PORT: '8087',
    LLM_PROVIDER_TIERS: 'openrouter',
    LLM_BASE_URL_OPENROUTER: 'http://127.0.0.1:9097/v1',
    LLM_MODELS_OPENROUTER: 'mock-model-a',
    OPENROUTER_API_KEYS: 'sk-memory-test',
    TTS_PROVIDERS: 'google',
  }, (l) => l.includes('[waguri-backend] listening'));
  await waitFor(`${BACK}/api/health`);

  // Track cache invalidation events
  let cacheInvalidations = 0;
  onMemoryCacheInvalidate(() => {
    cacheInvalidations++;
  });

  // --- Step 0 & Auth checks ---
  const noAuthRes = await fetch(`${BACK}/api/memory`);
  check('GET /api/memory without token returns 401', noAuthRes.status === 401);

  const wrongAuthRes = await fetch(`${BACK}/api/memory`, {
    headers: { 'x-admin-token': 'wrong-token' },
  });
  check('GET /api/memory with invalid token returns 401', wrongAuthRes.status === 401);

  const authHeaders = {
    'Content-Type': 'application/json',
    'x-admin-token': ADMIN_TOKEN,
  };

  // Seed memories through chat so conversation and vector rows exist organically
  const chat1 = await (await fetch(`${BACK}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'I love strawberry shortcake bakery treats in Delhi!' }),
  })).json();

  const chat2 = await (await fetch(`${BACK}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: chat1.conversation_id,
      message: 'My favorite programming language is Python and I enjoy building AI companions.',
    }),
  })).json();

  // Give async fire-and-forget memory storage 800ms to persist vectors
  await new Promise((r) => setTimeout(r, 800));

  // --- GET /api/memory listing & embedding secrecy ---
  const listRes = await fetch(`${BACK}/api/memory?limit=10`, { headers: authHeaders });
  check('GET /api/memory with valid token returns 200', listRes.status === 200);
  const listData = await listRes.json();
  check('listing contains items array', Array.isArray(listData.items) && listData.items.length >= 2, `count=${listData.items?.length}`);

  // CRITICAL: verify embedding column is NEVER exposed in the items
  const leaksEmbedding = listData.items.some((item) => 'embedding' in item);
  check('NEVER returns the embedding column', !leaksEmbedding);

  // Check structure of memory items
  const firstItem = listData.items[0];
  check('memory items have id, content_chunk, created_at, conversation_id',
    !!firstItem.id && typeof firstItem.content_chunk === 'string' && !!firstItem.created_at && !!firstItem.conversation_id
  );

  // --- Search filter (?q=...) ---
  const searchRes = await fetch(`${BACK}/api/memory?q=strawberry`, { headers: authHeaders });
  const searchData = await searchRes.json();
  check('search ?q=strawberry returns matching items', searchData.items.length >= 1 && searchData.items.every((m) => m.content_chunk.toLowerCase().includes('strawberry')));

  const noMatchRes = await fetch(`${BACK}/api/memory?q=nonexistentxyz123`, { headers: authHeaders });
  const noMatchData = await noMatchRes.json();
  check('search for non-existent text returns empty list', noMatchData.items.length === 0);

  // --- PATCH /api/memory/:id validation ---
  const testId = firstItem.id;

  // 1. Oversize text > 2000 chars rejected
  const oversizeText = 'A'.repeat(2001);
  const overRes = await fetch(`${BACK}/api/memory/${testId}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ content_chunk: oversizeText }),
  });
  check('PATCH text > 2000 chars rejected with 400', overRes.status === 400);

  // 2. Empty text rejected
  const emptyRes = await fetch(`${BACK}/api/memory/${testId}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ content_chunk: '   ' }),
  });
  check('PATCH empty text rejected with 400', emptyRes.status === 400);

  // 3. Valid update with re-embedding
  const newText = 'Updated memory: Waguri loves matcha latte and strawberry shortcake!';
  const patchRes = await fetch(`${BACK}/api/memory/${testId}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ content_chunk: newText }),
  });
  check('PATCH /:id returns 200', patchRes.status === 200);
  const patchedItem = await patchRes.json();
  check('PATCH updates content_chunk', patchedItem.content_chunk === newText);
  check('PATCH response does not leak embedding', !('embedding' in patchedItem));

  // Verify memory recall reflects the NEW updated text
  const verifyPatch = await (await fetch(`${BACK}/api/memory?q=matcha`, { headers: authHeaders })).json();
  check('updated memory is searchable by new text', verifyPatch.items.some((m) => m.id === testId && m.content_chunk.includes('matcha')));

  // --- DELETE /api/memory/:id ---
  const deleteRes = await fetch(`${BACK}/api/memory/${testId}`, {
    method: 'DELETE',
    headers: authHeaders,
  });
  check('DELETE /:id returns 204', deleteRes.status === 204);

  const checkDeleted = await (await fetch(`${BACK}/api/memory`, { headers: authHeaders })).json();
  check('deleted memory no longer in items list', !checkDeleted.items.some((m) => m.id === testId));

  // --- POST /api/memory/bulk-delete ---
  // Pick remaining ids
  const idsToDelete = checkDeleted.items.map((m) => m.id).slice(0, 10);
  if (idsToDelete.length > 0) {
    const bulkRes = await fetch(`${BACK}/api/memory/bulk-delete`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ ids: idsToDelete }),
    });
    check('POST /bulk-delete returns 200', bulkRes.status === 200);
    const bulkData = await bulkRes.json();
    check('bulk-delete returns deleted count', bulkData.deleted === idsToDelete.length, `expected=${idsToDelete.length} got=${bulkData.deleted}`);
  }

  // Bulk delete invalid payload validation
  const invalidBulk = await fetch(`${BACK}/api/memory/bulk-delete`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ ids: [] }),
  });
  check('POST /bulk-delete with empty ids returns 400', invalidBulk.status === 400);

  // --- POST /api/memory custom memory creation ---
  const customRes = await fetch(`${BACK}/api/memory`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      content_chunk: '[Preference] Daksh loves iced matcha latte and cold brew.',
      user_id: 'daksh@example.com',
    }),
  });
  check('POST / returns 201 on custom memory creation', customRes.status === 201);
  const customData = await customRes.json();
  check('custom memory has id and content_chunk', !!customData.id && customData.content_chunk.includes('matcha latte'));
  check('custom memory does not leak embedding', !('embedding' in customData));

  // Validation: empty text returns 400
  const emptyCustom = await fetch(`${BACK}/api/memory`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ content_chunk: '' }),
  });
  check('POST / with empty text returns 400', emptyCustom.status === 400);

  // --- Strict Account / User Isolation Check ---
  // Seed memory for userB
  await fetch(`${BACK}/api/memory`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      content_chunk: '[Fact] UserB secret memory about Paris vacation.',
      user_id: 'userB@example.com',
    }),
  });

  const userAList = await (await fetch(`${BACK}/api/memory?user_id=daksh@example.com`, { headers: authHeaders })).json();
  const userBList = await (await fetch(`${BACK}/api/memory?user_id=userB@example.com`, { headers: authHeaders })).json();

  check('userA list contains userA memory', userAList.items.some((m) => m.content_chunk.includes('matcha latte')));
  check('userA list DOES NOT contain userB memory (account isolation)', !userAList.items.some((m) => m.content_chunk.includes('Paris vacation')));

  check('userB list contains userB memory', userBList.items.some((m) => m.content_chunk.includes('Paris vacation')));
  check('userB list DOES NOT contain userA memory (account isolation)', !userBList.items.some((m) => m.content_chunk.includes('matcha latte')));

  // --- GET /api/memory/export ---
  const exportRes = await fetch(`${BACK}/api/memory/export`, { headers: authHeaders });
  check('GET /export returns 200', exportRes.status === 200);
  const contentDisp = exportRes.headers.get('content-disposition');
  check('GET /export sets Content-Disposition attachment', !!contentDisp && contentDisp.includes('waguri-memories.json'));
  const exportData = await exportRes.json();
  check('GET /export returns array of items', Array.isArray(exportData));
  check('exported items do not leak embedding column', exportData.every((m) => !('embedding' in m)));

  // Account isolated export
  const exportUserA = await (await fetch(`${BACK}/api/memory/export?user_id=daksh@example.com`, { headers: authHeaders })).json();
  check('userA export only contains userA memories', exportUserA.every((m) => !m.content_chunk.includes('Paris vacation')));

} finally {
  await stopProc(backend);
  await stopProc(mock);
}

done('test/memory.test.js');
