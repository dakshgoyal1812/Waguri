// PRD Milestone 3 test: Key Pool Manager (LLM) with cooldown/failover (PRD 9.3).
// Unit (in-process, real KeyPool + memory storage):
//   - least-used-first ordering, cooldown reactivation on expiry, exhausted keys
//     never time back in, daily counters reset, key_usage_log rows, flush persists
// E2E (HTTP with mock OpenRouter):
//   - 429 on one key -> user still gets 200 (rotation invisible), switch overhead
//     well under 300ms, pool status reflects cooldown
//   - daily-limit 429 on every key -> 503 only at total pool exhaustion
//   - 402 -> key marked exhausted (not cooldown)
import './_setenv.js';
import { startProc, stopProc, waitFor, check, done, TEST_ENV } from './util.js';
import { KeyPool, cooldownExpiryFrom429, PoolExhaustedError } from '../src/keys/keyPool.js';
import { createMemoryStorage } from '../src/db/memory.js';
import { encryptSecret } from '../src/crypto.js';

// ================= unit section (in-process) =================
{
  const storage = createMemoryStorage();
  await storage.init();
  const k1 = await storage.upsertKey({ provider: 'openrouter', key_value: encryptSecret('u1'), account_label: 'account-1' });
  const k2 = await storage.upsertKey({ provider: 'openrouter', key_value: encryptSecret('u2'), account_label: 'account-2' });
  const k3 = await storage.upsertKey({ provider: 'openrouter', key_value: encryptSecret('u3'), account_label: 'account-3' });
  const pool = new KeyPool(storage);
  await pool.init();

  const n1 = await pool.getNextKey('openrouter');
  check('unit: first getNextKey returns an active key', !!n1);
  await pool.markSuccess(n1.id); // now u1 has 1 request, others 0
  const n2 = await pool.getNextKey('openrouter');
  check('unit: ordering picks least requests_used_today (PRD 9.3 SQL ORDER BY)', n2.id !== n1.id, `n1=${n1.account_label} n2=${n2?.account_label}`);
  await pool.markSuccess(n2.id); await pool.markSuccess(n2.id);
  const n3 = await pool.getNextKey('openrouter');
  check('unit: third call reaches the untouched key', n3.id === k3.id, `got=${n3.account_label}`);

  // cooldown expiry reactivation (PRD 9.3: reactivate when cooldown_expires_at < now).
  // Make the expired-cooldown key the ONLY candidate so the return value proves it.
  await pool.markCooldown(k1.id, new Date(Date.now() + 100));
  await pool.markExhausted(k2.id);
  await pool.markExhausted(k3.id);
  await new Promise((r) => setTimeout(r, 150));
  const reacted = await pool.getNextKey('openrouter');
  check('unit: expired cooldown key is reactivated by getNextKey', reacted.id === k1.id && reacted.status === 'active', `got=${reacted?.account_label}/${reacted?.status}`);

  // exhausted keys do NOT come back with time (only /api/reset-quotas revives them)
  await new Promise((r) => setTimeout(r, 30));
  const got = await pool.getNextKey('openrouter');
  check('unit: exhausted key never returned (until daily reset)', got.id !== k3.id, `got=${got?.account_label}`);

  // usage log (PRD section 12: all key failures logged)
  await pool.recordUsage(k1.id, 429, 123);
  const log = await storage.getUsageLog(10);
  check('unit: key_usage_log row written with status+latency', log.some((r) => r.key_id === k1.id && r.status_code === 429 && r.latency_ms === 123), JSON.stringify(log));

  // flush persists in-memory state to the storage adapter
  await pool.markSuccess(k2.id);
  await pool.flush();
  const persisted = (await storage.listKeys('openrouter')).find((k) => k.id === k2.id);
  check('unit: flush() persists requests_used_today to storage', persisted.requests_used_today === 3, `got=${persisted.requests_used_today}`);

  // forceDailyReset revives exhausted keys (cron path, PRD 9.3)
  await pool.forceDailyReset();
  const after = (await storage.listKeys('openrouter')).find((k) => k.id === k3.id);
  check('unit: forceDailyReset zeroes counters and revives exhausted keys', after.status === 'active' && after.requests_used_today === 0, JSON.stringify(after));
}

// ================= e2e section =================
const BACK = 'http://127.0.0.1:8084';
let mockRot, backendRot, mockDead, backendDead, mockPayw, backendPayw;

try {
  // --- rotation invisible on per-minute 429 (PRD 12: no error may surface) ---
  mockRot = await startProc('mock-rot', 'node', ['test/mock-openrouter.js'], {
    MOCK_PORT: '9092', MOCK_FAIL_KEYS: 'sk-k1',
    MOCK_FAIL_BODY: 'Rate limit exceeded: free-models-per-minute. Try again in 20s.',
  }, (l) => l.includes('[mock-openrouter] on'));
  await waitFor('http://127.0.0.1:9092/__stats');

  backendRot = await startProc('backend-rot', 'node', ['src/server.js'], {
    ...TEST_ENV, PORT: '8084',
    LLM_PROVIDER_TIERS: 'openrouter',
    LLM_BASE_URL_OPENROUTER: 'http://127.0.0.1:9092/v1',
    LLM_MODELS_OPENROUTER: 'mock-model-a',
    OPENROUTER_API_KEYS: 'sk-k1,sk-k2',
    TTS_PROVIDERS: 'none', // isolate LLM overhead for the latency measurement
  }, (l) => l.includes('[waguri-backend] listening'));
  await waitFor(`${BACK}/api/health`);
  await fetch(`${BACK}/api/persona`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Waguri' }) });

  // baseline: healthy single-key latency (mock 9091 used only if running; skip - use healthy key on same mock)
  const t0 = Date.now();
  const r1 = await (await fetch(`${BACK}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hello' }),
  })).json();
  const failoverLatencyMs = Date.now() - t0;
  check('e2e: 429 on first key -> chat still 200 (rotation invisible)', r1.reply_text?.includes('MOCK-OK'), JSON.stringify(r1).slice(0, 150));
  check('e2e: no error surfaced from the failed key', !r1.error, JSON.stringify(r1).slice(0, 150));

  const status1 = await (await fetch(`${BACK}/api/keypool/status`, { headers: { 'x-admin-token': 'test-admin-token' } })).json();
  const k1s = status1.providers.openrouter.find((k) => k.account_label === 'account-1');
  const k2s = status1.providers.openrouter.find((k) => k.account_label === 'account-2');
  check('e2e: failed key moved to cooldown with expiry set', k1s.status === 'cooldown' && !!k1s.cooldown_expires_at, JSON.stringify(k1s));
  check('e2e: healthy key served the request and counted usage', k2s.status === 'active' && k2s.requests_used_today === 1, JSON.stringify(k2s));

  // failover overhead (PRD 9.3: well under 300ms per switch) — measure the pure
  // LLM round trip by timing a healthy-key request on the same backend
  const t1 = Date.now();
  await fetch(`${BACK}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'again' }) });
  const healthyLatencyMs = Date.now() - t1;
  // first request includes cold-start + failover; compare same-request shapes
  console.log(`        [latency] with-failover=${failoverLatencyMs}ms healthy=${healthyLatencyMs}ms`);
  check('e2e: failover overhead well under 300ms (PRD 9.3)', failoverLatencyMs - healthyLatencyMs < 300 || failoverLatencyMs < 300,
    `overhead≈${failoverLatencyMs - healthyLatencyMs}ms`);

  // --- total pool exhaustion: daily 429 on every key -> 503 (PRD 12 allows this) ---
  mockDead = await startProc('mock-dead', 'node', ['test/mock-openrouter.js'], {
    MOCK_PORT: '9093', MOCK_FAIL_KEYS: 'sk-x1,sk-x2',
    MOCK_FAIL_BODY: 'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000/day.',
  }, (l) => l.includes('[mock-openrouter] on'));
  await waitFor('http://127.0.0.1:9093/__stats');
  backendDead = await startProc('backend-dead', 'node', ['src/server.js'], {
    ...TEST_ENV, PORT: '8085',
    LLM_PROVIDER_TIERS: 'openrouter',
    LLM_BASE_URL_OPENROUTER: 'http://127.0.0.1:9093/v1',
    LLM_MODELS_OPENROUTER: 'mock-model-a',
    OPENROUTER_API_KEYS: 'sk-x1,sk-x2',
    TTS_PROVIDERS: 'none',
  }, (l) => l.includes('[waguri-backend] listening'));
  await waitFor('http://127.0.0.1:8085/api/health');
  await fetch('http://127.0.0.1:8085/api/persona', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Waguri' }) });
  const deadRes = await fetch('http://127.0.0.1:8085/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi' }),
  });
  const deadBody = await deadRes.json();
  check('e2e: total pool exhaustion -> 503 to the client', deadRes.status === 503, `status=${deadRes.status} body=${JSON.stringify(deadBody)}`);
  const deadStatus = await (await fetch('http://127.0.0.1:8085/api/keypool/status', { headers: { 'x-admin-token': 'test-admin-token' } })).json();
  check('e2e: both keys cooldown (daily) after exhaustion', deadStatus.providers.openrouter.every((k) => k.status === 'cooldown'), JSON.stringify(deadStatus.providers.openrouter));

  // --- 402 (no credits) -> exhausted, not cooldown ---
  mockPayw = await startProc('mock-payw', 'node', ['test/mock-openrouter.js'], {
    MOCK_PORT: '9094', MOCK_FAIL_KEYS: 'sk-p1', MOCK_FAIL_STATUS: '402',
    MOCK_FAIL_BODY: 'Insufficient credits (402).',
  }, (l) => l.includes('[mock-openrouter] on'));
  await waitFor('http://127.0.0.1:9094/__stats');
  backendPayw = await startProc('backend-payw', 'node', ['src/server.js'], {
    ...TEST_ENV, PORT: '8086',
    LLM_PROVIDER_TIERS: 'openrouter',
    LLM_BASE_URL_OPENROUTER: 'http://127.0.0.1:9094/v1',
    LLM_MODELS_OPENROUTER: 'mock-model-a',
    OPENROUTER_API_KEYS: 'sk-p1,sk-p2',
    TTS_PROVIDERS: 'none',
  }, (l) => l.includes('[waguri-backend] listening'));
  await waitFor('http://127.0.0.1:8086/api/health');
  await fetch('http://127.0.0.1:8086/api/persona', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Waguri' }) });
  const payRes = await fetch('http://127.0.0.1:8086/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi' }),
  });
  check('e2e: 402 on first key -> next key serves, 200 (invisible)', payRes.status === 200, `status=${payRes.status}`);
  const payStatus = await (await fetch('http://127.0.0.1:8086/api/keypool/status', { headers: { 'x-admin-token': 'test-admin-token' } })).json();
  const p1 = payStatus.providers.openrouter.find((k) => k.account_label === 'account-1');
  check('e2e: 402 key marked exhausted (not cooldown)', p1.status === 'exhausted', JSON.stringify(p1));
} catch (e) {
  check('harness completed without error', false, e.message);
} finally {
  await stopProc(backendRot); await stopProc(backendDead); await stopProc(backendPayw);
  await stopProc(mockRot); await stopProc(mockDead); await stopProc(mockPayw);
}
done('run-m3.js');
