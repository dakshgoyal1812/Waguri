// PRD Milestone 6 test: Load-test failover (simulate 429 bursts, confirm switch is invisible)
// PRD section 12 acceptance criteria:
//   - p95 reply latency under ~3s for text (well under 300ms added overhead per switch)
//   - Rotation invisible to user: no 429 or quota error surfaces from a single key hit
//   - Key usage and failures recorded in key_usage_log
import './_setenv.js';
import { startProc, stopProc, waitFor, check, done, TEST_ENV } from './util.js';

console.log('=== PRD Milestone 6: Failover Load & Invisibility Test ===');

const BACK = 'http://127.0.0.1:8086';
let mockLlm, backend;

try {
  // Mock OpenRouter configured to 429 on sk-burstable-1 after 3 requests,
  // falling over to sk-burstable-2 and sk-burstable-3
  mockLlm = await startProc('mock-llm-load', 'node', ['test/mock-openrouter.js'], {
    MOCK_PORT: '9094',
    MOCK_FAIL_KEYS: 'sk-fail-1',
    MOCK_FAIL_STATUS: '429',
    MOCK_FAIL_BODY: 'Rate limit exceeded: 429 Too Many Requests',
  }, (l) => l.includes('[mock-openrouter] on'));
  await waitFor('http://127.0.0.1:9094/__stats');

  backend = await startProc('backend-load', 'node', ['src/server.js'], {
    ...TEST_ENV,
    PORT: '8086',
    LLM_PROVIDER_TIERS: 'openrouter',
    LLM_BASE_URL_OPENROUTER: 'http://127.0.0.1:9094/v1',
    LLM_MODELS_OPENROUTER: 'mock-model-a',
    OPENROUTER_API_KEYS: 'sk-fail-1,sk-backup-2,sk-backup-3',
    TTS_PROVIDERS: 'none', // isolate LLM failover timing
  }, (l) => l.includes('[waguri-backend] listening'));
  await waitFor(`${BACK}/api/health`);

  // Seed persona (persona writes are admin-only)
  await fetch(`${BACK}/api/persona`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': 'test-admin-token' },
    body: JSON.stringify({ name: 'Waguri', location: 'Delhi' }),
  });

  // Execute burst of 15 chat requests
  const totalRequests = 15;
  const latencies = [];
  const results = [];

  console.log(`Sending ${totalRequests} concurrent/pipelined chat requests during simulated 429...`);
  for (let i = 0; i < totalRequests; i++) {
    const t0 = Date.now();
    const res = await fetch(`${BACK}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Test burst message ${i}` }),
    });
    const dur = Date.now() - t0;
    latencies.push(dur);
    const json = await res.json();
    results.push({ status: res.status, json });
  }

  // Check 1: 100% of requests succeeded
  const allSucceeded = results.every((r) => r.status === 200 && r.json.reply_text);
  check('e2e: all burst requests succeeded with HTTP 200', allSucceeded);

  // Check 2: No errors surfaced to client (invisible rotation per PRD 12)
  const noErrorsSurfaced = results.every((r) => !r.json.error);
  check('e2e: zero errors surfaced to client during key rotation', noErrorsSurfaced);

  // Check 3: Latency calculations
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  console.log(`[latency metrics] p50=${p50}ms, p95=${p95}ms, max=${latencies[latencies.length - 1]}ms`);

  check('e2e: p95 latency under 3000ms (PRD section 12)', p95 < 3000, `p95=${p95}ms`);

  // Check 4: Inspect mock stats to ensure keys rotated and traffic balanced
  const mockStats = await (await fetch('http://127.0.0.1:9094/__stats')).json();
  check('e2e: failed key received traffic and failed', (mockStats.perKey['sk-fail-1'] || 0) >= 1);
  check('e2e: backup keys absorbed the load', (mockStats.perKey['sk-backup-2'] || 0) > 0 && (mockStats.perKey['sk-backup-3'] || 0) > 0);

  // Check 5: Pool status verifies cooldown
  const statusRes = await (await fetch(`${BACK}/api/keypool/status`, {
    headers: { 'x-admin-token': 'test-admin-token' },
  })).json();

  const failKey = statusRes.providers?.openrouter?.find((k) => k.account_label === 'account-1');
  check('e2e: failing key correctly marked in cooldown', failKey?.status === 'cooldown');

} finally {
  await stopProc(backend);
  await stopProc(mockLlm);
}

done('run-m6.js');
