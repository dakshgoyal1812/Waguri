// Mood engine — the "feeling" layer. Picks the active mood for a reply from the
// Supabase `moods` table (data, not code): the LLM's [emotion] tag wins, then
// trigger-keyword matching on the reply text by priority, then 'neutral'.
// Moods are cached briefly so per-message lookups never add DB round-trips.
import { config } from '../config.js';

// Sentiment keywords for the HUMAN's message (English + Hinglish). When you sound
// happy/sad/angry/excited, she mirrors YOUR feeling first — that is the empathy
// layer. Checked before her own reply analysis.
const USER_SENTIMENT = [
  { mood: 'sad', words: ['sad', 'crying', 'cried', 'depressed', 'alone', 'lonely', 'hurt', 'miss her', 'died', 'dukht', 'dukh', 'ro raha', 'ro rahi', 'rulayega', 'bura din', 'udaas', 'dard'] },
  { mood: 'angry', words: ['angry', 'hate', 'furious', 'annoyed', 'pissed', 'gussa', 'naraz', 'chup', 'bakwas'] },
  { mood: 'excited', words: ['amazing', 'incredible', 'lets go', "let's go", 'so happy', 'won', 'yayyy', 'best day', 'maza aa gaya', 'kya baat', 'mast', 'jhakaas', 'party'] },
  { mood: 'happy', words: ['happy', 'great day', 'good news', 'hehe', 'hahaha', 'lol', 'lmao', 'khush', 'achha laga', 'fun'] },
  { mood: 'surprised', words: ['what?!', 'no way', 'you wont believe', "won't believe", 'guess what', 'shocking', 'kya?!'] },
];

function detectUserSentiment(userText) {
  const lower = String(userText || '').toLowerCase();
  if (!lower) return null;
  for (const { mood, words } of USER_SENTIMENT) {
    if (words.some((w) => lower.includes(w))) return mood;
  }
  return null;
}

export function createMoodEngine(storage) {
  let cache = { rows: null, at: 0 };
  const TTL_MS = 30_000;

  async function moods() {
    if (cache.rows && Date.now() - cache.at < TTL_MS) return cache.rows;
    try {
      cache = { rows: await storage.listMoods(), at: Date.now() };
    } catch (e) {
      console.error('[mood] listing moods failed, using empty palette:', e.message);
      cache = { rows: [], at: Date.now() };
    }
    return cache.rows;
  }

  return {
    // Full pipeline: user sentiment (empathy mirror) -> persona mood lock ->
    // LLM reply tag -> reply keywords -> neutral.
    // taggedEmotion: the [happy]/[sad]/... tag the model prefixed (may be null).
    // userText: the human's message — if it carries feeling, she mirrors it.
    // persona: active_mood_id is a manual lock from Supabase (beats everything).
    // Returns the mood row or null when the palette is empty (caller falls back
    // to the raw tag / neutral).
    async detect(replyText, taggedEmotion, persona, userText) {
      const rows = await moods();
      if (!rows.length) return null;
      const findByName = (name) => rows.find((m) => m.name.toLowerCase() === String(name).toLowerCase());

      if (persona?.active_mood_id) {
        const locked = rows.find((m) => m.id === persona.active_mood_id);
        if (locked) return locked;
      }
      // empathy mirror: your mood becomes her mood
      const userMood = detectUserSentiment(userText);
      if (userMood) {
        const mirrored = findByName(userMood);
        if (mirrored) return mirrored;
      }
      if (taggedEmotion) {
        const byTag = findByName(taggedEmotion);
        if (byTag) return byTag;
      }
      const lower = String(replyText).toLowerCase();
      for (const m of rows) {
        if ((m.trigger_keywords || []).some((k) => lower.includes(String(k).toLowerCase()))) return m;
      }
      return rows.find((m) => m.name === 'neutral') || rows[rows.length - 1] || null;
    },

    // Expression preset for a mood, falling back to the tag or neutral.
    expressionFor(mood, taggedEmotion) {
      return mood?.vrm_expression || taggedEmotion || 'neutral';
    },

    // SSML prosody for TTS derived from the mood's voice tone params.
    prosodyFor(mood) {
      if (!mood) return {};
      const p = {};
      if (mood.voice_rate) p.rate = mood.voice_rate;
      if (mood.voice_pitch) p.pitch = mood.voice_pitch;
      return p;
    },

    invalidate() { cache = { rows: null, at: 0 }; },
  };
}
