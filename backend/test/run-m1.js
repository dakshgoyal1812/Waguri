// PRD Milestone 1 test: backend skeleton + schema replica + single-key OpenRouter
// chat (no rotation yet) + persona endpoint + history + admin-protected keypool.
import { startProc, stopProc, waitFor, check, done, TEST_ENV } from './util.js';

const BACK = 'http://127.0.0.1:8081';
let mock, backend;

try {
  mock = await startProc('mock-openrouter', 'node', ['test/mock-openrouter.js'], {
    MOCK_PORT: '9090',
  }, (l) => l.includes('[mock-openrouter] on'));
  await waitFor('http://127.0.0.1:9090/__stats');

  backend = await startProc('backend', 'node', ['src/server.js'], {
    ...TEST_ENV,
    PORT: '8081',
    LLM_PROVIDER_TIERS: 'openrouter',
    LLM_BASE_URL_OPENROUTER: 'http://127.0.0.1:9090/v1',
    LLM_MODELS_OPENROUTER: 'mock-model-a',
    OPENROUTER_API_KEYS: 'sk-test-single-key',
    TTS_PROVIDERS: 'edge,google',
    TTS_VOICE: 'en-IN-NeerjaNeural',
  }, (l) => l.includes('[waguri-backend] listening'));
  await waitFor(`${BACK}/api/health`);

  // --- persona (PRD section 10: POST /api/persona) ---
  const personaRes = await fetch(`${BACK}/api/persona`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Waguri', location: 'Delhi, India',
      backstory: 'Scholarship student in Delhi who loves pastries and visits the bakery of her childhood friend Daksh.',
      personality_traits: ['gentle', 'resilient', 'loves bakery cakes'],
      speech_style: 'warm, sweet, light Hinglish',
    }),
  });
  const persona = await personaRes.json();
  check('POST /api/persona -> 200 with id', personaRes.status === 200 && !!persona.id, JSON.stringify(persona));

  // --- chat (PRD section 10: POST /api/chat -> reply text + audio URL) ---
  const chatRes = await fetch(`${BACK}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hi Waguri! What did you eat today?' }),
  });
  const chat = await chatRes.json();
  check('POST /api/chat -> 200', chatRes.status === 200, JSON.stringify(chat));
  check('reply has conversation_id', !!chat.conversation_id, JSON.stringify(chat));
  check('reply_text present and emotion tag stripped', typeof chat.reply_text === 'string' && chat.reply_text.startsWith('MOCK-OK'), JSON.stringify(chat));
  check('emotion extracted = happy', chat.emotion === 'happy', JSON.stringify(chat));
  check('audio_url returned (PRD: text + audio URL)', typeof chat.audio_url === 'string' && chat.audio_url.includes('/api/audio/'), JSON.stringify(chat));
  check('llm meta reports provider/model', chat.meta?.llm?.provider === 'openrouter' && chat.meta?.llm?.model === 'mock-model-a', JSON.stringify(chat.meta));

  // --- audio bytes (PRD section 10: audio URL must resolve) ---
  if (chat.audio_url) {
    const audioRes = await fetch(chat.audio_url);
    const buf = Buffer.from(await audioRes.arrayBuffer());
    check('GET audio_url -> 200 with MP3 bytes', audioRes.status === 200 && buf.length > 1000, `status=${audioRes.status} bytes=${buf.length}`);
  }

  // --- history (PRD section 10: paginated) ---
  const histRes = await fetch(`${BACK}/api/conversations/${chat.conversation_id}/history?limit=10`);
  const hist = await histRes.json();
  check('GET history -> 200 with 2 messages (user+assistant)', histRes.status === 200 && hist.total === 2, JSON.stringify(hist));
  check('history roles correct', hist.items?.[0]?.role === 'user' && hist.items?.[1]?.role === 'assistant', JSON.stringify(hist.items));

  // --- follow-up chat reuses conversation ---
  const chat2Res = await fetch(`${BACK}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: chat.conversation_id, message: 'and what about yesterday?' }),
  });
  const chat2 = await chat2Res.json();
  check('follow-up chat keeps same conversation', chat2Res.status === 200 && chat2.conversation_id === chat.conversation_id, JSON.stringify(chat2));
  const hist2 = await (await fetch(`${BACK}/api/conversations/${chat.conversation_id}/history`)).json();
  check('history now 4 messages', hist2.total === 4, `total=${hist2.total}`);

  // --- keypool/status must not be public (PRD section 10) ---
  const noTok = await fetch(`${BACK}/api/keypool/status`);
  // 401 = token configured but missing; the ADMIN_TOKEN-unset -> 403 case is
  // covered in the M4 test with different env
  check('GET /api/keypool/status without token -> 401', noTok.status === 401, `status=${noTok.status}`);
  const withTok = await fetch(`${BACK}/api/keypool/status`, { headers: { 'x-admin-token': 'test-admin-token' } });
  const pool = await withTok.json();
  check('GET /api/keypool/status with token -> 200, shows key, no secret', withTok.status === 200
    && pool.providers.openrouter?.length === 1
    && pool.providers.openrouter[0].status === 'active'
    && !JSON.stringify(pool).includes('sk-test'), JSON.stringify(pool));

  // --- reset-quotas (PRD section 10) ---
  const noTokReset = await fetch(`${BACK}/api/reset-quotas`, { method: 'POST' });
  check('POST /api/reset-quotas without token -> 401', noTokReset.status === 401, `status=${noTokReset.status}`);
  const tokReset = await fetch(`${BACK}/api/reset-quotas`, { method: 'POST', headers: { 'x-admin-token': 'test-admin-token' } });
  check('POST /api/reset-quotas with token -> ok', tokReset.status === 200, JSON.stringify(await tokReset.json()));
} catch (e) {
  check('harness completed without error', false, e.message);
} finally {
  await stopProc(backend);
  await stopProc(mock);
}
done('run-m1.js');
