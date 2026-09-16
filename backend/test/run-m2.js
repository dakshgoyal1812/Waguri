// PRD Milestone 2 test: pgvector RAG retrieval wiring (PRD section 8).
// 1. exchange stored as embedding chunk(s) asynchronously after the reply
// 2. relevant past chunk retrieved + injected into the system prompt on next turn
// 3. long exchanges get chunked into multiple vectors
// 4. embeddings outage degrades gracefully (reply never blocked)
// Plus unit checks for chunker / emotion extraction / 429 cooldown classification.
import { startProc, stopProc, waitFor, check, done, TEST_ENV } from './util.js';
import { chunkText } from '../src/rag/chunker.js';
import { extractEmotion } from '../src/prompt.js';
import { hashEmbed } from '../src/rag/embeddings.js';
import { cooldownExpiryFrom429 } from '../src/keys/keyPool.js';

// ---- unit checks (pure functions) ----
{
  const long = 'Sentence one about cakes. '.repeat(40); // ~1100 chars -> multiple chunks
  const chunks = chunkText(long, { size: 500, overlap: 50 });
  check('unit: chunker splits long text into multiple overlapping chunks', chunks.length >= 2 && chunks.every((c) => c.length <= 520), `chunks=${chunks.length} lens=${chunks.map((c) => c.length)}`);
  const { emotion, reply } = extractEmotion('[surprised] No way, really?!');
  check('unit: emotion extraction strips tag', emotion === 'surprised' && reply === 'No way, really?!', JSON.stringify({ emotion, reply }));
  check('unit: missing emotion tag -> neutral', extractEmotion('plain text').emotion === 'neutral');
  const perMin = cooldownExpiryFrom429('Rate limit exceeded: free-models-per-minute. Try again in 20s.');
  const perDay = cooldownExpiryFrom429('Rate limit exceeded: free-models-per-day. Add 10 credits.');
  const minOk = perMin - Date.now() > 30_000 && perMin - Date.now() < 70_000;
  // invariant: expiry is in the future and lands exactly on next midnight UTC —
  // remaining time depends on when the test runs (0h..24h), so only check the shape
  const dayOk = perDay > Date.now() && new Date(perDay).toISOString().endsWith('T00:00:00.000Z');
  check('unit: per-minute 429 -> ~60s cooldown', minOk, `delta=${perMin - Date.now()}ms`);
  check('unit: daily 429 -> next midnight UTC (PRD section 9.3)', dayOk, `expires=${new Date(perDay).toISOString()}`);
  const a = hashEmbed('strawberry shortcake cake'), b = hashEmbed('i love strawberry shortcake cake'), c = hashEmbed('quantum physics equations');
  const cos = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
  check('unit: hash embeddings — related text ranks higher', cos(a, b) > cos(a, c), `rel=${cos(a, b).toFixed(3)} unrel=${cos(a, c).toFixed(3)}`);
}

const BACK = 'http://127.0.0.1:8082';
let mock, backend, backendNoRag;

try {
  mock = await startProc('mock-openrouter', 'node', ['test/mock-openrouter.js'], { MOCK_PORT: '9091' }, (l) => l.includes('[mock-openrouter] on'));
  await waitFor('http://127.0.0.1:9091/__stats');

  backend = await startProc('backend', 'node', ['src/server.js'], {
    ...TEST_ENV, PORT: '8082',
    LLM_PROVIDER_TIERS: 'openrouter',
    LLM_BASE_URL_OPENROUTER: 'http://127.0.0.1:9091/v1',
    LLM_MODELS_OPENROUTER: 'mock-model-a',
    OPENROUTER_API_KEYS: 'sk-rag-test',
    TTS_PROVIDERS: 'google',
  }, (l) => l.includes('[waguri-backend] listening'));
  await waitFor(`${BACK}/api/health`);

  await fetch(`${BACK}/api/persona`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Waguri', location: 'Delhi' }),
  });

  // Turn 1: plant a memory (long text to force multi-chunk storage)
  const fact = 'Hey Waguri, please always remember this: my favorite cake in the whole world is the ' +
    'strawberry shortcake from the little Delhi bakery near Daksh\'s family shop. I buy it every Friday ' +
    'evening after tutoring, and the baker knows me by name. Once I bought the last slice and gave it to ' +
    'a crying kid at the metro station, and it made my whole week. ' +
    'Also random filler to make this long enough for chunking: '.repeat(3);
  const r1 = await (await fetch(`${BACK}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: fact }),
  })).json();
  check('turn 1 chat ok', r1.reply_text?.includes('MOCK-OK'), JSON.stringify(r1).slice(0, 200));

  // Turn 2: ask about it — the stored chunks must come back through RAG
  let saw = '', memories = -1, ok = false;
  for (let attempt = 0; attempt < 10 && !ok; attempt++) {
    await new Promise((r) => setTimeout(r, 600)); // async store is fire-and-forget
    const r2 = await (await fetch(`${BACK}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: r1.conversation_id, message: 'What is my favorite cake, and where do I buy it?' }),
    })).json();
    const m = r2.reply_text?.match(/memories=(\d+) SAW::(.*)/s) || [];
    memories = parseInt(m[1] || '-1', 10);
    saw = m[2] || '';
    ok = memories > 0 && /strawberry shortcake/i.test(saw);
  }
  check('turn 2 retrieves stored memory via RAG', ok, `memories=${memories} saw="${saw.slice(0, 300)}"`);
  check('long exchange was chunked into multiple vectors', memories >= 2, `memories=${memories}`);

  // 4. embeddings outage: reply must not be blocked (PRD section 8 robustness; graceful degradation)
  backendNoRag = await startProc('backend-no-rag', 'node', ['src/server.js'], {
    ...TEST_ENV, PORT: '8083',
    LLM_PROVIDER_TIERS: 'openrouter',
    LLM_BASE_URL_OPENROUTER: 'http://127.0.0.1:9091/v1',
    LLM_MODELS_OPENROUTER: 'mock-model-a',
    OPENROUTER_API_KEYS: 'sk-rag-test',
    TTS_PROVIDERS: 'google',
    EMBEDDINGS_PROVIDER: 'openai-compat',
    EMBEDDINGS_BASE_URL: 'http://127.0.0.1:9999/v1', // dead port
  }, (l) => l.includes('[waguri-backend] listening'));
  await waitFor('http://127.0.0.1:8083/api/health');
  await fetch('http://127.0.0.1:8083/api/persona', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Waguri', location: 'Delhi' }),
  });
  const r3res = await fetch('http://127.0.0.1:8083/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hello there' }),
  });
  const r3 = await r3res.json();
  check('embeddings outage: chat still 200 (retrieval skipped, reply not blocked)', r3res.status === 200 && r3.reply_text?.includes('MOCK-OK'), JSON.stringify(r3).slice(0, 200));
  check('embeddings outage: memories_used=0', r3.meta?.memories_used === 0, JSON.stringify(r3.meta));
} catch (e) {
  check('harness completed without error', false, e.message);
} finally {
  await stopProc(backend);
  await stopProc(backendNoRag);
  await stopProc(mock);
}
done('run-m2.js');
