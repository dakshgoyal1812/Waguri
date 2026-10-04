// Verification Suite for Public APIs Integration (Weather, Anime, Facts/Trivia, Jokes)
import assert from 'node:assert/strict';
import {
  fetchWeather,
  fetchAnime,
  fetchTriviaQuestion,
  fetchWikipediaSummary,
  fetchJoke,
  detectToolIntent,
  getEnrichedContext,
  decodeHtmlEntities,
} from '../src/tools/publicApis.js';
import { createChatOrchestrator } from '../src/orchestrator/chat.js';
import { createGamesModule } from '../src/games/index.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failed++;
  }
}

console.log('\n======================================================');
console.log('  Testing Public APIs (Weather, Anime, Trivia, Jokes)  ');
console.log('======================================================\n');

// 1. Weather (Open-Meteo)
await test('1. fetchWeather returns valid temperature and condition for Delhi', async () => {
  const res = await fetchWeather('Delhi');
  assert.equal(res.success, true);
  assert.ok(res.city.includes('Delhi'), `Expected Delhi, got ${res.city}`);
  assert.ok(res.temperature.includes('°C'), `Expected temp in °C, got ${res.temperature}`);
  assert.ok(res.condition, 'Expected weather condition string');
});

await test('2. fetchWeather handles invalid city gracefully', async () => {
  const res = await fetchWeather('xyznonexistentcity123456');
  assert.equal(res.success, false);
  assert.ok(res.error, 'Expected error message on invalid city');
});

// 2. Anime (AniList + Jikan)
await test('3. fetchAnime returns anime details for Naruto', async () => {
  const res = await fetchAnime('Naruto');
  assert.equal(res.success, true);
  assert.ok(res.title.toLowerCase().includes('naruto'), `Expected Naruto, got ${res.title}`);
  assert.ok(res.score, 'Expected score');
  assert.ok(res.genres, 'Expected genres');
});

await test('4. fetchAnime returns recommendations when requested', async () => {
  const res = await fetchAnime('', true);
  assert.equal(res.success, true);
  assert.equal(res.isRecommendation, true);
  assert.ok(Array.isArray(res.recommendations), 'Expected recommendations array');
  assert.ok(res.recommendations.length > 0, 'Expected at least 1 recommendation');
});

// 3. Facts / Trivia (Wikipedia + Open Trivia DB)
await test('5. fetchWikipediaSummary returns factual extract for Albert Einstein', async () => {
  const res = await fetchWikipediaSummary('Albert Einstein');
  assert.equal(res.success, true);
  assert.ok(res.title.includes('Einstein'), `Expected Einstein, got ${res.title}`);
  assert.ok(res.extract.length > 20, 'Expected substantial extract');
});

await test('6. fetchTriviaQuestion returns decoded question and 4 options', async () => {
  const res = await fetchTriviaQuestion();
  assert.equal(res.success, true);
  assert.ok(res.question, 'Expected question text');
  assert.equal(res.options.length, 4, 'Expected 4 multiple-choice options');
  assert.ok(['A', 'B', 'C', 'D'].includes(res.correctLetter), 'Expected valid letter A-D');
  assert.ok(res.correctAnswer, 'Expected correct answer text');
});

await test('7. decodeHtmlEntities handles special characters properly', () => {
  const raw = '&quot;Hello &amp; World&#039;s &lt;test&gt; Pok&eacute;mon&quot;';
  const decoded = decodeHtmlEntities(raw);
  assert.equal(decoded, '"Hello & World\'s <test> Pokémon"');
});

// 4. Jokes / Fun (JokeAPI + Official Joke)
await test('8. fetchJoke returns safe joke', async () => {
  const res = await fetchJoke();
  assert.equal(res.success, true);
  assert.ok(res.jokeText, 'Expected jokeText');
  assert.ok(['single', 'twopart'].includes(res.type), 'Expected single or twopart joke');
});

// 5. Intent Detection
await test('9. detectToolIntent detects weather, anime, trivia, joke, fact queries', () => {
  const w1 = detectToolIntent('Delhi me mausam kaisa hai?');
  assert.equal(w1?.tool, 'weather');
  assert.equal(w1?.query.toLowerCase(), 'delhi');

  const w2 = detectToolIntent('Mumbai weather today');
  assert.equal(w2?.tool, 'weather');
  assert.equal(w2?.query.toLowerCase(), 'mumbai');

  const j1 = detectToolIntent('Mujhe ek funny joke sunao');
  assert.equal(j1?.tool, 'joke');

  const t1 = detectToolIntent('Chalo trivia quiz khelte hain');
  assert.equal(t1?.tool, 'trivia');

  const a1 = detectToolIntent('Jujutsu Kaisen kaisa anime hai?');
  assert.equal(a1?.tool, 'anime');

  const a2 = detectToolIntent('Koi accha romance anime recommend karo');
  assert.equal(a2?.tool, 'anime');
  assert.equal(a2?.isRecommendation, true);

  const f1 = detectToolIntent('Quantum computing kya hai?');
  assert.equal(f1?.tool, 'wiki');
  assert.ok(f1?.query.toLowerCase().includes('quantum computing'));
});

// 6. getEnrichedContext
await test('10. getEnrichedContext generates formatted instructions for persona prompt', async () => {
  const ctx = await getEnrichedContext('Delhi me mausam kaisa hai?', { location: 'Delhi', user_name: 'Daksh' });
  assert.ok(ctx, 'Expected enriched context');
  assert.equal(ctx.type, 'weather');
  assert.ok(ctx.contextText.includes('REAL-TIME LIVE WEATHER TOOL DATA'));
  assert.ok(ctx.contextText.includes('Delhi'));
});

// 7. Chat Orchestrator Integration
await test('11. Orchestrator integrates toolContext and returns meta.tool_used', async () => {
  const fakePersona = {
    id: 'waguri-test',
    name: 'Waguri',
    location: 'Delhi',
    user_name: 'Daksh',
    personality_traits: ['warm', 'playful'],
    speech_style: 'Hinglish casual',
    backstory: 'Loving companion',
  };

  const messages = [];
  const fakeStorage = {
    getDefaultPersona: async () => fakePersona,
    getPersona: async () => fakePersona,
    getConversation: async (id) => ({ id, user_id: 'test-user' }),
    createConversation: async () => ({ id: 'conv-123', user_id: 'test-user' }),
    getRecentMessages: async () => [],
    addMessage: async (msg) => {
      const m = { id: `msg-${Date.now()}`, ...msg };
      messages.push(m);
      return m;
    },
    searchMemory: async () => [],
    insertMemoryVector: async () => {},
  };

  let receivedSystemPrompt = '';
  const fakeCallLLM = async (llmMessages) => {
    receivedSystemPrompt = llmMessages.find((m) => m.role === 'system')?.content || '';
    return {
      text: '[happy] Arre Daksh, Delhi me abhi temperature badhiya 28 degree hai aur aasman ekdum saaf hai!',
      provider: 'mock-llm',
      model: 'mock-model',
      latencyMs: 120,
    };
  };

  const fakeEmbedder = { embed: async () => Array(384).fill(0.1) };
  const fakeSynthesize = async () => ({ audio: Buffer.from('mock audio'), mime: 'audio/mp3', provider: 'mock-tts' });

  const orchestrator = createChatOrchestrator({
    storage: fakeStorage,
    callLLM: fakeCallLLM,
    embedder: fakeEmbedder,
    synthesize: fakeSynthesize,
    moodEngine: null,
  });

  const res = await orchestrator.handle({
    conversationId: 'conv-123',
    personaId: 'waguri-test',
    userId: 'test-user',
    message: 'Delhi me mausam kaisa hai?',
  });

  assert.ok(res.reply_text.includes('Delhi'));
  assert.equal(res.meta.tool_used?.type, 'weather');
  assert.ok(receivedSystemPrompt.includes('REAL-TIME LIVE WEATHER TOOL DATA'));
});

// 8. Trivia Game Support in createGamesModule
await test('12. createGamesModule supports trivia game mode and scoring', async () => {
  const games = createGamesModule({
    callLLM: async () => ({ text: '[happy] Sahi jawab Daksh! Mast khele tum!' }),
    synthesize: async () => ({ audio: Buffer.from('tts'), mime: 'audio/mp3', provider: 'mock' }),
    moodEngine: null,
    getPersona: async () => ({ name: 'Waguri', user_name: 'Daksh' }),
    publicBase: { storeAudio: () => 'audio-1', base: () => 'http://localhost:3000' },
  });

  const startRes = await games.start({ game: 'trivia' });
  assert.equal(startRes.game, 'trivia');
  assert.ok(startRes.session_id);
  assert.ok(/trivia/i.test(startRes.reply_text) || /options/i.test(startRes.reply_text));

  const moveRes = await games.move({
    sessionId: startRes.session_id,
    choice: startRes.state?.options?.[0]?.slice(0, 1) || 'A',
  });

  assert.equal(moveRes.game, 'trivia');
  assert.ok(moveRes.reply_text);
  assert.ok(typeof moveRes.correct === 'boolean');
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
