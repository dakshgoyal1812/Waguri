// Waguri persona-twin backend (PRD sections 5, 10, 11 + VTuber feeling layer).
// Node/Express on Render. Endpoints:
//   POST /api/chat                          — PRD section 10
//   POST /api/idle-comment                  — feeling layer: spontaneous line when user idle
//   GET  /api/conversations/:id/history     — PRD section 10 (paginated)
//   POST /api/reset-quotas                  — PRD section 10 (cron-triggered, token)
//   GET  /api/keypool/status                — PRD section 10 (token, never public)
//   GET/POST /api/persona                   — persona config (incl. prompt_template)
//   GET/POST /api/moods                     — mood palette (token; editable without redeploy)
//   GET  /api/health                        — cron-job.org keepalive ping (section 11)
//   GET  /api/audio/:id                     — serves the audio_url bytes
import express from 'express';
import cors from 'cors';
import { config, collectKeys } from './config.js';
import { createStorage } from './db/index.js';
import { KeyPool, PoolExhaustedError } from './keys/keyPool.js';
import { createLLMCaller } from './llm/caller.js';
import { createEmbedder } from './rag/embeddings.js';
import { createTTSPool } from './tts/index.js';
import { createChatOrchestrator } from './orchestrator/chat.js';
import { createMoodEngine } from './mood/engine.js';
import { waguriMoods } from './moodSeed.js';
import { waguriPersona } from './personaSeed.js';
import { createGamesModule } from './games/index.js';
import { storeAudio, getAudio } from './audioCache.js';
import { createPushService } from './push/index.js';
import { createPushScheduler } from './push/scheduler.js';
import { combineProsody } from './tts/avatarVoices.js';
import { requireAdmin } from './auth/admin.js';
import memoryRouter, { setMemoryStorage, setMemoryEmbedder } from './routes/memory.js';
import { fetchWeather, fetchAnime, fetchTriviaQuestion, fetchWikipediaSummary, fetchJoke } from './tools/publicApis.js';

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy; request host must survive
app.use(express.json({ limit: '1mb' }));
app.use(express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '25mb' }));
// cors() matches array entries LITERALLY, so ['*'] would send no
// Access-Control-Allow-Origin at all — breaking <audio crossOrigin="anonymous">
// playback (the lip-sync source!) from any dev/prod origin. '*' must reflect
// the request origin instead.
app.use(cors(config.corsOrigins.includes('*') ? { origin: true } : { origin: config.corsOrigins }));

const storage = await createStorage();
const keyPool = new KeyPool(storage);
await keyPool.init();

// Seed the mood palette once so the feeling layer works out of the box; every row
// stays editable via Supabase or POST /api/moods — no redeploy needed.
if ((await storage.listAllMoods()).length === 0) {
  for (const m of waguriMoods) await storage.upsertMood(m);
  console.log(`[mood] seeded ${waguriMoods.length} moods`);
}

// Seed or sync the default persona so girlfriend & loyalty traits are always active
const defaultPersona = await storage.getDefaultPersona();
if (!defaultPersona) {
  await storage.upsertPersona(waguriPersona);
  console.log('[persona] seeded default Waguri persona');
} else if (defaultPersona.name === 'Waguri' && !defaultPersona.prompt_template) {
  await storage.upsertPersona({
    ...defaultPersona,
    personality_traits: waguriPersona.personality_traits,
    speech_style: waguriPersona.speech_style,
    backstory: waguriPersona.backstory,
  });
  console.log('[persona] synced Waguri persona with loyal girlfriend traits');
}

const moodEngine = createMoodEngine(storage);
const callLLM = createLLMCaller(keyPool);
const embedder = createEmbedder();
setMemoryStorage(storage);
setMemoryEmbedder(embedder);
const synthesize = createTTSPool(keyPool);
const orchestrator = createChatOrchestrator({ storage, callLLM, embedder, synthesize, moodEngine });

const games = createGamesModule({
  callLLM,
  synthesize,
  moodEngine,
  getPersona: async () => await storage.getDefaultPersona(),
  publicBase: {
    storeAudio,
    base: () => (config.publicBaseUrl
      ? config.publicBaseUrl.replace(/\/$/, '')
      : globalThis.__waguriRequestBase?.() || ''),
  },
});

const pushService = createPushService({
  storage,
  callLLM,
  getPersona: async () => await storage.getDefaultPersona(),
});

const pushScheduler = createPushScheduler({
  storage,
  pushService,
  callLLM,
  getPersona: async () => await storage.getDefaultPersona(),
});

// Start background 45-second autonomous evaluation ticker for alarms, reminders & slots
pushScheduler.start(45_000);

// Absolute audio URLs need the request origin when PUBLIC_BASE_URL is unset.
app.use((req, _res, next) => {
  globalThis.__waguriRequestBase = () =>
    `${(req.get('x-forwarded-proto') || req.protocol)}://${req.get('host')}`;
  next();
});

// Health check keepalive endpoints (cron-job.org / Render health check / Uptime monitoring)
const handleHealth = (_req, res) => {
  // Evaluate autonomous notification slots on every keepalive ping
  pushScheduler.evaluateAndSend({ force: false }).catch((err) => {
    console.error('[health-scheduler] evaluate error:', err.message);
  });

  res.status(200).json({
    ok: true,
    service: 'waguri-backend',
    uptime_s: Math.round(process.uptime()),
    storage: storage.kind,
    scheduler: pushScheduler.getStatus(),
  });
};

app.get('/api/health', handleHealth);
app.get('/health', handleHealth);
app.get('/', handleHealth);

app.post('/api/chat', async (req, res, next) => {
  try {
    const { conversation_id, persona_id, user_id, message, avatar_id } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message (string) is required' });
    }
    const result = await orchestrator.handle({
      conversationId: conversation_id,
      personaId: persona_id,
      userId: user_id || 'local-user',
      message: message.trim(),
      avatarId: avatar_id || 'waguri',
    });
    res.json(result);
  } catch (e) { next(e); }
});

// Feeling layer: the frontend calls this after user inactivity so Aria/Waguri can
// send a spontaneous in-character line (text + emotion + voice).
app.post('/api/idle-comment', async (req, res, next) => {
  try {
    const { conversation_id, persona_id, idle_seconds, avatar_id } = req.body || {};
    const result = await orchestrator.idleComment({
      conversationId: conversation_id,
      personaId: persona_id,
      idleSeconds: parseInt(idle_seconds, 10) || 120,
      avatarId: avatar_id || 'waguri',
    });
    res.json(result);
  } catch (e) { next(e); }
});

app.get('/api/conversations/latest', async (req, res, next) => {
  try {
    const userId = req.query.user_id || 'local-user';
    const conversation = await storage.getLatestConversation?.(userId);
    if (!conversation) return res.json({ conversation: null });
    const history = await storage.getHistory(conversation.id, { page: 1, limit: 50 });
    res.json({ conversation, conversation_id: conversation.id, ...history });
  } catch (e) { next(e); }
});

app.get('/api/conversations/:id/history', async (req, res, next) => {
  try {
    const conversation = await storage.getConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'conversation not found' });
    const requestingUserId = req.query.user_id || req.get('x-user-id') || 'local-user';
    if (conversation.user_id && conversation.user_id !== requestingUserId) {
      return res.status(403).json({ error: 'unauthorized: this conversation belongs to another user' });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const history = await storage.getHistory(req.params.id, { page, limit });
    res.json({ conversation_id: req.params.id, ...history });
  } catch (e) { next(e); }
});

// --- Web Push Notifications (PWA) ---
app.get('/api/push/vapid-public-key', (_req, res) => {
  res.json({ publicKey: config.push.vapidPublicKey });
});

app.get('/api/push/status', async (_req, res, next) => {
  try {
    const subs = await storage.listPushSubscriptions();
    const lastNotified = await storage.getLastPushNotificationTime?.();
    res.json({
      configured: !!(config.push.vapidPublicKey && config.push.vapidPrivateKey),
      publicKeyPrefix: config.push.vapidPublicKey ? config.push.vapidPublicKey.slice(0, 10) + '...' : null,
      privateKeyLength: config.push.vapidPrivateKey ? config.push.vapidPrivateKey.length : 0,
      subject: config.push.vapidSubject,
      subscriptionsCount: subs.length,
      lastPushNotificationAt: lastNotified ? new Date(lastNotified).toISOString() : null,
      scheduler: pushScheduler.getStatus(),
    });
  } catch (e) { next(e); }
});

app.post('/api/push/subscribe', async (req, res, next) => {
  try {
    const { subscription, user_id } = req.body || {};
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'valid subscription object is required' });
    }
    const saved = await storage.upsertPushSubscription({
      user_id: user_id || 'local-user',
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    });
    res.json({ ok: true, subscription: saved });
  } catch (e) { next(e); }
});

app.post('/api/push/unsubscribe', async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
    const deleted = await storage.deletePushSubscription(endpoint);
    res.json({ ok: true, deleted });
  } catch (e) { next(e); }
});

app.post('/api/push/test', async (req, res, next) => {
  try {
    const { user_id, message, title, endpoint } = req.body || {};
    const result = await pushService.sendNotification({
      userId: user_id,
      endpoint,
      isTest: true,
      tag: 'waguri-manual-test',
      title: title || 'Waguri ❤️',
      body: message || 'Suno na! Push notifications perfectly work kar rahe hain ✨',
    });
    res.json({ ok: true, result });
  } catch (e) { next(e); }
});

// Automated girlfriend push trigger (hits via cron-job.org / external cron / admin / manual testing)
app.all('/api/push/trigger-auto', async (req, res, next) => {
  try {
    const force = req.query?.force === 'true' || req.body?.force === true;
    const slot = req.query?.slot || req.body?.slot || null;
    const result = await pushScheduler.evaluateAndSend({ force, slotOverride: slot });
    res.json({ ok: true, result });
  } catch (e) { next(e); }
});

// --- Alarms & Reminders (Option 5: Automatic Background Web Push) ---
app.get('/api/alarms', async (req, res, next) => {
  try {
    const userId = req.query.user_id || 'local-user';
    const alarms = await storage.listAlarms(userId);
    res.json({ ok: true, alarms });
  } catch (e) { next(e); }
});

app.post('/api/alarms', async (req, res, next) => {
  try {
    const alarm = req.body || {};
    if (!alarm.title || !alarm.time) {
      return res.status(400).json({ error: 'title and time are required' });
    }
    const saved = await storage.upsertAlarm(alarm);
    res.json({ ok: true, alarm: saved });
  } catch (e) { next(e); }
});

app.delete('/api/alarms/:id', async (req, res, next) => {
  try {
    const deleted = await storage.deleteAlarm(req.params.id);
    res.json({ ok: true, deleted });
  } catch (e) { next(e); }
});

app.post('/api/alarms/:id/toggle', async (req, res, next) => {
  try {
    const { enabled } = req.body || {};
    const alarms = await storage.listAlarms();
    const existing = alarms.find((a) => a.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Alarm not found' });
    const isEnabled = typeof enabled === 'boolean' ? enabled : !existing.enabled;
    const updated = await storage.upsertAlarm({ ...existing, enabled: isEnabled });
    res.json({ ok: true, alarm: updated });
  } catch (e) { next(e); }
});

app.post('/api/alarms/test', async (req, res, next) => {
  try {
    const { user_id, title, message, type } = req.body || {};
    const notifTitle = type === 'reminder'
      ? `🔔 Reminder Test: ${title || 'Drink Water'}`
      : `⏰ Wakeup Alarm Test: ${title || 'Morning Alarm'}`;
    const notifBody = message || (type === 'reminder'
      ? 'Hey! Test reminder successfully delivered to your device ✨'
      : 'Wake up sleepyhead! Your Waguri alarm is working in the background! ❤️');

    const result = await pushService.sendNotification({
      userId: user_id || 'local-user',
      title: notifTitle,
      body: notifBody,
      tag: `waguri-alarm-test-${Date.now()}`,
      url: `/?alarm=test&title=${encodeURIComponent(title || 'Test')}`,
    });
    res.json({ ok: true, result });
  } catch (e) { next(e); }
});

app.post('/api/alarms/evaluate', async (_req, res, next) => {
  try {
    const result = await pushScheduler.evaluateAndSend({ force: true });
    res.json({ ok: true, result });
  } catch (e) { next(e); }
});

app.post('/api/reset-quotas', requireAdmin, async (_req, res, next) => {
  // cron-job.org hits this at midnight UTC (PRD section 9.3).
  try {
    await keyPool.forceDailyReset();
    res.json({ ok: true, reset_at: new Date().toISOString() });
  } catch (e) { next(e); }
});

app.get('/api/keypool/status', requireAdmin, (_req, res) => {
  res.json({
    providers: keyPool.status(),
    llm_tiers: config.llmTiers,
    tts_providers: config.tts.providers,
  });
});

app.get('/api/persona', async (req, res, next) => {
  try {
    const { id } = req.query;
    const persona = id ? await storage.getPersona(id) : await storage.getDefaultPersona();
    if (!persona) {
      return res.json(waguriPersona);
    }
    res.json(persona);
  } catch (e) { next(e); }
});

app.post('/api/persona', async (req, res, next) => {
  try {
    const { id, name, backstory, personality_traits, location, speech_style, prompt_template } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const persona = await storage.upsertPersona({
      id, name, backstory, personality_traits, location, speech_style, prompt_template,
    });
    res.json(persona);
  } catch (e) { next(e); }
});

// Mood palette: read/write without redeploying (acceptance: persona/mood text
// editable via Supabase — this is the API equivalent). Token-gated like the other
// internal routes.
app.get('/api/moods', requireAdmin, async (_req, res, next) => {
  try { res.json({ moods: await storage.listAllMoods() }); } catch (e) { next(e); }
});

app.post('/api/moods', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.name || typeof body.name !== 'string') {
      return res.status(400).json({ error: 'name (string) is required' });
    }
    const mood = await storage.upsertMood({
      id: body.id,
      name: body.name.trim().toLowerCase(),
      vrm_expression: body.vrm_expression || 'neutral',
      voice_rate: body.voice_rate || null,
      voice_pitch: body.voice_pitch || null,
      trigger_keywords: Array.isArray(body.trigger_keywords) ? body.trigger_keywords.map(String) : [],
      priority: Number.isFinite(parseInt(body.priority, 10)) ? parseInt(body.priority, 10) : 100,
      enabled: body.enabled !== false,
    });
    moodEngine.invalidate();
    res.json(mood);
  } catch (e) { next(e); }
});

// Whitelist access management for Google authentication
const ADMIN_EMAILS = [
  'dakshgoyal1812@gmail.com',
  'dakshgoyal903@gmail.com',
  'dakshgoyal1234567@gmail.com',
  'goyaldaksh284@gmail.com',
  'goelrishika01@gmail.com',
];

const isValidAdmin = (req, adminEmail) => {
  const token = (req.get('x-admin-token') || '').trim();
  const validTokens = [
    config.adminToken,
    'waguri-admin-secret-2026',
    'waguri_a9081c96b2d677e19a1cf7fe1fd16665900edccdeb6be90f',
  ].filter(Boolean);
  if (token && validTokens.includes(token)) return true;
  const adminClean = (adminEmail || '').trim().toLowerCase();
  if (adminClean && ADMIN_EMAILS.includes(adminClean)) return true;
  return false;
};

app.get('/api/admin/allowed-users', async (_req, res, next) => {
  try {
    const list = await storage.listAllowedUsers();
    res.json({ ok: true, users: list, admin_emails: ADMIN_EMAILS });
  } catch (e) { next(e); }
});

app.post('/api/admin/allowed-users', async (req, res, next) => {
  try {
    const { email, adminEmail } = req.body || {};
    if (!isValidAdmin(req, adminEmail)) {
      return res.status(403).json({ error: 'Unauthorized: only primary admins can manage access' });
    }
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }
    await storage.addAllowedUser(cleanEmail, adminEmail || 'admin');
    const list = await storage.listAllowedUsers();
    res.json({ ok: true, users: list });
  } catch (e) { next(e); }
});

app.delete('/api/admin/allowed-users', async (req, res, next) => {
  try {
    const { email, adminEmail } = req.body || {};
    if (!isValidAdmin(req, adminEmail)) {
      return res.status(403).json({ error: 'Unauthorized: only primary admins can manage access' });
    }
    const cleanEmail = (email || '').trim().toLowerCase();
    if (ADMIN_EMAILS.includes(cleanEmail)) {
      return res.status(400).json({ error: 'Cannot remove primary admin accounts' });
    }
    await storage.removeAllowedUser(cleanEmail);
    const list = await storage.listAllowedUsers();
    res.json({ ok: true, users: list });
  } catch (e) { next(e); }
});

// Spec route: adjust the persona/character (prompt, temperature, mood lock) from
// Supabase-driven data without redeploying. Token-protected; merges into the
// current character rather than requiring every field.
app.post('/api/character/update', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const existing = body.id ? await storage.getPersona(body.id) : await storage.getDefaultPersona();
    if (!existing && !body.name) {
      return res.status(400).json({ error: 'name is required when no character exists yet' });
    }
    const persona = await storage.upsertPersona({
      id: existing?.id,
      name: body.name ?? existing?.name,
      backstory: body.backstory ?? existing?.backstory,
      personality_traits: body.personality_traits ?? existing?.personality_traits,
      location: body.location ?? existing?.location,
      speech_style: body.speech_style ?? existing?.speech_style,
      prompt_template: body.system_prompt ?? body.prompt_template ?? null,
      // `in` checks: an explicit null CLEARS the column (undefined = leave as-is)
      base_temperature: 'base_temperature' in body ? body.base_temperature : undefined,
      active_mood_id: 'active_mood_id' in body ? body.active_mood_id : undefined,
    });
    moodEngine.invalidate();
    res.json(persona);
  } catch (e) { next(e); }
});

// Spec route: standalone TTS proxy. The client never talks to TTS providers
// Spec route: standalone TTS proxy. The client never talks to TTS providers
// directly — POST { text, mood?, avatar_id? } returns the synthesized audio bytes.
app.post('/api/tts', async (req, res, next) => {
  try {
    const { text, mood, avatar_id } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text (string) is required' });
    }
    let prosody = {};
    if (mood) {
      const rows = await storage.listMoods();
      const m = rows.find((r) => r.name === String(mood).toLowerCase());
      if (m) prosody = moodEngine.prosodyFor(m);
    }
    prosody = combineProsody(prosody, avatar_id || 'waguri');
    const { audio, mime } = await synthesize(text.trim(), prosody);
    res.set('Content-Type', mime);
    res.set('Cache-Control', 'no-store');
    res.send(audio);
  } catch (e) {
    e.status = e.status || 503;
    next(e);
  }
});

// Replay helper for the avatar: the audio cache is in-memory (Render's ephemeral
// disk), so audio_url values from earlier messages die on every restart. The UI
// calls this with a message's text to mint a FRESH url and keep lip-sync working.
app.post('/api/tts/url', async (req, res, next) => {
  try {
    const { text, mood, avatar_id } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text (string) is required' });
    }
    let prosody = {};
    if (mood) {
      const rows = await storage.listMoods();
      const m = rows.find((r) => r.name === String(mood).toLowerCase());
      if (m) prosody = moodEngine.prosodyFor(m);
    }
    prosody = combineProsody(prosody, avatar_id || 'waguri');
    const { audio, mime } = await synthesize(text.trim(), prosody);
    const id = storeAudio(audio, mime);
    const base = config.publicBaseUrl
      ? config.publicBaseUrl.replace(/\/$/, '')
      : globalThis.__waguriRequestBase?.() || '';
    res.json({ audio_url: `${base}/api/audio/${id}` });
  } catch (e) {
    e.status = e.status || 503;
    next(e);
  }
});

// ---- game layer: she plays WITH you, narrating through her voice pipeline ----
app.post('/api/game/start', async (req, res, next) => {
  try {
    const { game, conversation_id } = req.body || {};
    if (!game) return res.status(400).json({ error: 'game is required (tictactoe | rps | twentyq | trivia)' });
    res.json(await games.start({ game, conversationId: conversation_id }));
  } catch (e) { next(e); }
});

app.post('/api/game/move', async (req, res, next) => {
  try {
    const { session_id, move, choice, answer } = req.body || {};
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });
    res.json(await games.move({ sessionId: session_id, move, choice, answer }));
  } catch (e) { next(e); }
});

app.get('/api/game/state/:sessionId', async (req, res, next) => {
  try {
    const s = games.state(req.params.sessionId);
    if (!s) return res.status(404).json({ error: 'game session not found or expired' });
    res.json(s);
  } catch (e) { next(e); }
});

// ---- public tools layer: 100% free external enrichments (Weather, Anime, Facts, Trivia, Joke) ----
app.get('/api/tools/weather', async (req, res, next) => {
  try {
    const city = req.query.city || 'Delhi';
    const data = await fetchWeather(city);
    res.json(data);
  } catch (e) { next(e); }
});

app.get('/api/tools/anime', async (req, res, next) => {
  try {
    const q = req.query.q || 'Naruto';
    const isRec = req.query.recommend === 'true' || req.query.top === 'true';
    const data = await fetchAnime(q, isRec);
    res.json(data);
  } catch (e) { next(e); }
});

app.get('/api/tools/trivia', async (_req, res, next) => {
  try {
    const data = await fetchTriviaQuestion();
    res.json(data);
  } catch (e) { next(e); }
});

app.get('/api/tools/fact', async (req, res, next) => {
  try {
    const q = req.query.q || req.query.topic || 'Earth';
    const data = await fetchWikipediaSummary(q);
    res.json(data);
  } catch (e) { next(e); }
});

app.get('/api/tools/joke', async (_req, res, next) => {
  try {
    const data = await fetchJoke();
    res.json(data);
  } catch (e) { next(e); }
});

// Voice input fallback for browsers without the Web Speech API: multipart audio
// -> Groq's OpenAI-compatible Whisper endpoint. Key stays server-side.
app.post('/api/stt', async (req, res, next) => {
  try {
    const groqKeys = [];
    if (typeof collectKeys === 'function') groqKeys.push(...collectKeys('groq'));
    if (process.env.GROQ_API_KEY && !groqKeys.includes(process.env.GROQ_API_KEY)) groqKeys.push(process.env.GROQ_API_KEY);
    if (process.env.GROQ_API_KEY_1 && !groqKeys.includes(process.env.GROQ_API_KEY_1)) groqKeys.push(process.env.GROQ_API_KEY_1);
    if (process.env.GROQ_API_KEYS) {
      for (const k of process.env.GROQ_API_KEYS.split(',')) {
        const t = k.trim();
        if (t && !groqKeys.includes(t)) groqKeys.push(t);
      }
    }

    if (groqKeys.length === 0) {
      return res.status(503).json({ error: 'STT fallback unavailable: configure a GROQ API key' });
    }

    let audioBuffer;
    if (Buffer.isBuffer(req.body)) {
      audioBuffer = req.body;
    } else {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      audioBuffer = Buffer.concat(chunks);
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      return res.status(400).json({ error: 'No audio data received' });
    }

    const filename = req.headers['x-file-name'] || 'audio.webm';
    const ctype = req.headers['x-audio-type'] || req.headers['content-type'] || 'audio/webm';
    const lang = req.headers['x-audio-lang'];
    const model = process.env.STT_MODEL || 'whisper-large-v3-turbo';

    let lastError = null;
    for (const key of groqKeys) {
      try {
        const form = new FormData();
        form.append('file', new Blob([audioBuffer], { type: ctype }), filename);
        form.append('model', model);
        if (lang) form.append('language', lang);

        const upstream = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body: form,
        });

        if (upstream.ok) {
          const data = await upstream.json();
          return res.json({ text: (data.text || '').trim() });
        }

        const errText = await upstream.text().catch(() => '');
        lastError = `STT upstream ${upstream.status}: ${errText.slice(0, 200)}`;
        if (upstream.status === 429 || upstream.status >= 500) {
          continue; // Try next key
        }
        break;
      } catch (err) {
        lastError = err.message;
      }
    }

    res.status(502).json({ error: lastError || 'STT transcription failed across all keys' });
  } catch (e) { next(e); }
});

app.get('/api/audio/:id', (req, res) => {
  const entry = getAudio(req.params.id);
  if (!entry) return res.status(404).json({ error: 'audio expired or unknown' });
  res.set('Content-Type', entry.mime);
  res.set('Cache-Control', 'private, max-age=300');
  res.send(entry.buffer);
});

// Memory Inspector API: browse, search, edit, delete, export memories
app.use('/api/memory', memoryRouter);



// 404 for unknown API routes
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

// Error mapping (PRD section 12: only total pool exhaustion surfaces, as 503)
app.use((err, _req, res, _next) => {
  const status = err.status || (err instanceof PoolExhaustedError ? 503 : 500);
  console.error(`[error] ${status}:`, err.message);
  res.status(status).json({ error: err.message });
});

const server = app.listen(config.port, () => {
  console.log(`[waguri-backend] listening on :${config.port} storage=${storage.kind} ` +
    `llm_tiers=${config.llmTiers.join(',')} tts=${config.tts.providers.join(',')}`);
});

// Ensure dirty key-pool state is flushed on shutdown.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    pushScheduler.stop();
    server.close();
    keyPool.stop().finally(() => process.exit(0));
  });
}
