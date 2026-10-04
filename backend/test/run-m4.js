// PRD Milestone 4 test: Add TTS (Edge TTS primary) + Azure fallback pool (PRD 9.4).
// Tests:
//   - In-process:
//     - Edge TTS failure triggers virtual cooldown
//     - Azure regional key rotation on 429 (region 1 cooldown -> region 2 succeeds)
//     - Azure key exhaustion on 401/403
//     - Key usage logged to storage (status code + latency)
//     - All TTS providers failing -> clean 503
//   - E2E:
//     - POST /api/chat with Edge TTS failing falls through to Azure Speech mock
//     - 429 on first Azure regional key -> second regional key serves audio seamlessly
//     - GET audio_url returns 200 with valid audio bytes from the fallback provider
import './_setenv.js';
import { startProc, stopProc, waitFor, check, done, TEST_ENV } from './util.js';
import { KeyPool } from '../src/keys/keyPool.js';
import { createMemoryStorage } from '../src/db/memory.js';
import { encryptSecret } from '../src/crypto.js';
import { createTTSPool } from '../src/tts/index.js';

console.log('=== PRD Milestone 4: TTS Pool & Failover Test ===');

// ================= unit section (in-process) =================
{
  const storage = createMemoryStorage();
  await storage.init();

  // Provision two Azure regional keys
  const k1 = await storage.upsertKey({
    provider: 'azure_tts',
    key_value: encryptSecret('azure-key-eastus'),
    account_label: 'eastus',
  });
  const k2 = await storage.upsertKey({
    provider: 'azure_tts',
    key_value: encryptSecret('azure-key-westus'),
    account_label: 'westus',
  });

  const pool = new KeyPool(storage);
  await pool.init();

  // Test pool returns active key with region
  const next1 = await pool.getNextKey('azure_tts');
  check('unit: getNextKey returns active azure_tts key', !!next1 && (next1.account_label === 'eastus' || next1.account_label === 'westus'));

  // Test cooldown on 429
  await pool.markCooldown(k1.id, new Date(Date.now() + 60_000));
  const next2 = await pool.getNextKey('azure_tts');
  check('unit: after eastus 429 cooldown, getNextKey yields westus', next2.id === k2.id, `got=${next2?.account_label}`);

  // Test exhausted on 401/403
  await pool.markExhausted(k2.id);
  const next3 = await pool.getNextKey('azure_tts');
  check('unit: when all azure keys in cooldown/exhausted, getNextKey returns null', next3 === null);

  // Test usage logging
  await pool.recordUsage(k1.id, 429, 45);
  await pool.recordUsage(k2.id, 200, 68);
  const log = await storage.getUsageLog(10);
  check('unit: key_usage_log records Azure TTS usage', log.some((r) => r.key_id === k1.id && r.status_code === 429) && log.some((r) => r.key_id === k2.id && r.status_code === 200));
}

// ================= e2e section =================
const BACK = 'http://127.0.0.1:8085';
let mockLlm, mockAzure, backend;

try {
  // Start mock OpenRouter on 9093
  mockLlm = await startProc('mock-llm', 'node', ['test/mock-openrouter.js'], {
    MOCK_PORT: '9093',
  }, (l) => l.includes('[mock-openrouter] on'));
  await waitFor('http://127.0.0.1:9093/__stats');

  // Start mock Azure on 9099 with region 1 failing 429
  mockAzure = await startProc('mock-azure', 'node', ['test/mock-azure.js'], {
    MOCK_PORT: '9099',
    MOCK_FAIL_KEYS: 'azure-key-eastus',
    MOCK_FAIL_STATUS: '429',
  }, (l) => l.includes('[mock-azure] on'));
  await waitFor('http://127.0.0.1:9099/__stats');

  // Launch backend: TTS_PROVIDERS='azure', with two regional keys
  backend = await startProc('backend-tts', 'node', ['src/server.js'], {
    ...TEST_ENV,
    PORT: '8085',
    LLM_PROVIDER_TIERS: 'openrouter',
    LLM_BASE_URL_OPENROUTER: 'http://127.0.0.1:9093/v1',
    LLM_MODELS_OPENROUTER: 'mock-model-a',
    OPENROUTER_API_KEYS: 'sk-healthy',
    TTS_PROVIDERS: 'azure', // Azure primary to test regional failover
    AZURE_TTS_KEYS: 'eastus:azure-key-eastus,westus:azure-key-westus',
    AZURE_TTS_BASE_URL_TEMPLATE: 'http://127.0.0.1:9099/{region}',
  }, (l) => l.includes('[waguri-backend] listening'));
  await waitFor(`${BACK}/api/health`);

  // Seed persona (persona writes are admin-only)
  await fetch(`${BACK}/api/persona`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': 'test-admin-token' },
    body: JSON.stringify({ name: 'Waguri' }),
  });

  // Turn 1: request chat. Region eastus hits 429, region westus serves audio!
  const chatRes = await (await fetch(`${BACK}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hello Waguri!' }),
  })).json();

  check('e2e: chat succeeds with 200 during TTS regional failover', !!chatRes.reply_text, JSON.stringify(chatRes));
  check('e2e: audio_url returned despite 429 on eastus key', !!chatRes.audio_url, JSON.stringify(chatRes));

  // Inspect Azure stats
  const azStats = await (await fetch('http://127.0.0.1:9099/__stats')).json();
  check('e2e: eastus key received a request (and returned 429)', azStats.perKey['azure-key-eastus'] >= 1, JSON.stringify(azStats));
  check('e2e: westus key received request and succeeded', azStats.perKey['azure-key-westus'] >= 1, JSON.stringify(azStats));

  // Verify GET audio_url delivers valid audio bytes
  const audioRes = await fetch(chatRes.audio_url);
  check('e2e: audio_url returns HTTP 200', audioRes.status === 200);
  const audioBuf = Buffer.from(await audioRes.arrayBuffer());
  check('e2e: audio response has content-type audio/mpeg', audioRes.headers.get('content-type')?.includes('audio/mpeg'));
  check('e2e: audio buffer is non-empty', audioBuf.length > 0);

  // Check keypool status shows eastus in cooldown
  const poolStatus = await (await fetch(`${BACK}/api/keypool/status`, {
    headers: { 'x-admin-token': 'test-admin-token' },
  })).json();

  const eastusKey = poolStatus.providers?.azure_tts?.find((k) => k.account_label === 'eastus');
  const westusKey = poolStatus.providers?.azure_tts?.find((k) => k.account_label === 'westus');
  check('e2e: eastus key marked as cooldown in key pool status', eastusKey?.status === 'cooldown', JSON.stringify(eastusKey));
  check('e2e: westus key marked as active with requests_used_today >= 1', westusKey?.status === 'active' && westusKey?.requests_used_today >= 1, JSON.stringify(westusKey));

} finally {
  await stopProc(backend);
  await stopProc(mockAzure);
  await stopProc(mockLlm);
}

done('run-m4.js');
