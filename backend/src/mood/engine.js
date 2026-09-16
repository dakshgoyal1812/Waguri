// Mood engine — the "feeling" layer. Picks the active mood for a reply from the
// conversation context, user sentiment, LLM tags, and reply keywords.
import { config } from '../config.js';

export const MOOD_PRESETS = {
  happy: { name: 'happy', vrm_expression: 'happy', voice_rate: '+3%', voice_pitch: '+6Hz' },
  excited: { name: 'excited', vrm_expression: 'excited', voice_rate: '+10%', voice_pitch: '+14Hz' },
  playful: { name: 'playful', vrm_expression: 'playful', voice_rate: '+5%', voice_pitch: '+8Hz' },
  curious: { name: 'curious', vrm_expression: 'curious', voice_rate: '+2%', voice_pitch: '+5Hz' },
  surprised: { name: 'surprised', vrm_expression: 'surprised', voice_rate: '+7%', voice_pitch: '+16Hz' },
  relaxed: { name: 'relaxed', vrm_expression: 'relaxed', voice_rate: '-4%', voice_pitch: '-3Hz' },
  sad: { name: 'sad', vrm_expression: 'sad', voice_rate: '-8%', voice_pitch: '-8Hz' },
  angry: { name: 'angry', vrm_expression: 'angry', voice_rate: '+5%', voice_pitch: '-4Hz' },
  neutral: { name: 'neutral', vrm_expression: 'neutral', voice_rate: '+0%', voice_pitch: '+0Hz' },
};

// Conversational sentiment analysis of the USER's prompt (English, Hindi & Hinglish).
const USER_SENTIMENT = [
  { mood: 'playful', words: ['mario', 'game', 'play', 'khel', 'khelein', 'khelte', 'challenge', 'shaitan', 'masti', 'tease', 'tictactoe', 'kart', 'race', 'quiz', 'joke', 'mazak', 'haraya', 'jeet'] },
  { mood: 'excited', words: ['amazing', 'incredible', 'lets go', "let's go", 'so happy', 'won', 'yay', 'yayyy', 'best day', 'maza aa gaya', 'kya baat', 'mast', 'jhakaas', 'party', 'zabardast', 'super', 'awesome', 'celebrate', 'congrats', 'mubarak', 'pass ho gaya'] },
  { mood: 'curious', words: ['recommend', 'suggest', 'which', 'kaunsa', 'konsa', 'batao', 'kaise', 'kyun', 'kya hota', 'secret', 'advice', 'wonder', 'tell me', 'opinion', 'soch', 'kya lagta', 'kahan', 'explain', 'meaning', 'jaanna hai'] },
  { mood: 'relaxed', words: ['evening', 'shaam', 'chai', 'coffee', 'rest', 'aaram', 'cozy', 'sleep', 'so jao', 'chill', 'sukoon', 'peace', 'thakan', 'thak', 'tired', 'relax', 'raat', 'night', 'goodnight'] },
  { mood: 'sad', words: ['sad', 'crying', 'cried', 'depressed', 'alone', 'lonely', 'hurt', 'miss', 'dukht', 'dukh', 'ro raha', 'ro rahi', 'rulayega', 'bura din', 'udaas', 'dard', 'fail', 'heartbreak', 'breakup', 'problem', 'upset', 'tension', 'chinta', 'stress'] },
  { mood: 'angry', words: ['angry', 'hate', 'furious', 'annoyed', 'pissed', 'gussa', 'naraz', 'chup', 'bakwas', 'irritat', 'shut up', 'pagal'] },
  { mood: 'surprised', words: ['what?!', 'no way', 'you wont believe', "won't believe", 'guess what', 'shocking', 'kya?!', 'omg', 'haien', 'sach mein?', 'really?', 'unbelievable'] },
  { mood: 'happy', words: ['hi', 'hello', 'hey', 'kaise ho', 'kya hal', 'kya haal', 'good morning', 'subah', 'happy', 'great day', 'good news', 'hehe', 'hahaha', 'lol', 'lmao', 'khush', 'achha laga', 'accha laga', 'fun', 'sweet', 'mithai', 'cake', 'pastry', 'love you', 'pyari', 'friend', 'dost', 'cute', 'sundar', 'khubsurat', 'smile'] },
];

const REPLY_KEYWORDS = [
  { mood: 'playful', words: ['game', 'haar', 'jeet', 'chalo', 'masti', 'challenge', 'tease', 'pakad', 'haraya', 'khel', 'kart', 'mario', 'shaitan', 'mazak'] },
  { mood: 'excited', words: ['amazing', 'zabardast', 'gazab', 'kya baat', 'super', 'love it', 'excited', 'party', 'best ever', 'jhakaas', 'yay', 'hurray', 'badhai'] },
  { mood: 'curious', words: ['wonder', 'kaise', 'kyun', 'sach mein', 'bata na', 'really?', 'guess karo', 'jaanna hai', 'socho'] },
  { mood: 'relaxed', words: ['sukoon', 'cozy', 'aaram', 'chill', 'shaam', 'chai', 'coffee', 'peace', 'sofe', 'relax', 'so jao', 'neend'] },
  { mood: 'sad', words: ['sorry', 'bura laga', 'take care', 'himmat', 'chinta mat', 'tension mat', 'udaas', 'dard', 'aww', 'main hoon na'] },
  { mood: 'angry', words: ['gussa', 'hmph', 'meanie', 'not fair', 'bakwas', 'naraz'] },
  { mood: 'surprised', words: ['what!', 'really?', 'no way', 'ehh?!', 'whoa', 'shocking', 'arre baap re'] },
  { mood: 'happy', words: ['pastry', 'cake', 'sweet', 'croissant', 'smile', 'khush', 'mazedaar', 'accha', 'achha', 'hehe', 'tasty', 'swaad', 'pyar', 'dosti', 'welcome', 'shukriya'] },
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
    // Dynamic mood resolution according to full conversation context:
    // 1. Explicit persona mood lock (Supabase active_mood_id)
    // 2. LLM tagged emotion ([happy], [playful], [excited], etc.)
    // 3. User prompt sentiment (empathy mirroring)
    // 4. Assistant reply content keywords
    // 5. Friendly conversational default (warm 'happy')
    async detect(replyText, taggedEmotion, persona, userText) {
      const rows = await moods();
      const findByName = (name) => {
        if (!name) return null;
        const norm = String(name).toLowerCase().trim();
        const found = rows.find((m) => m.name.toLowerCase() === norm);
        if (found) return found;
        return MOOD_PRESETS[norm] || null;
      };

      if (persona?.active_mood_id) {
        const locked = rows.find((m) => m.id === persona.active_mood_id);
        if (locked) return locked;
      }

      // 1. LLM explicit emotion tag
      if (taggedEmotion && taggedEmotion !== 'neutral') {
        const byTag = findByName(taggedEmotion);
        if (byTag) return byTag;
      }

      // 2. Empathy mirror: your sentiment becomes her mood
      const userMood = detectUserSentiment(userText);
      if (userMood) {
        const mirrored = findByName(userMood);
        if (mirrored) return mirrored;
      }

      // 3. Assistant reply keyword analysis
      const lowerReply = String(replyText || '').toLowerCase();
      for (const { mood, words } of REPLY_KEYWORDS) {
        if (words.some((w) => lowerReply.includes(w))) {
          const match = findByName(mood);
          if (match) return match;
        }
      }

      // Also check DB rows trigger_keywords
      for (const m of rows) {
        if ((m.trigger_keywords || []).some((k) => lowerReply.includes(String(k).toLowerCase()))) return m;
      }

      // 4. Default: an enthusiastic, warm friend defaults to happy
      return findByName('happy') || MOOD_PRESETS.happy;
    },

    // Expression preset for a mood, falling back to the tag or neutral.
    expressionFor(mood, taggedEmotion) {
      return mood?.vrm_expression || mood?.name || (taggedEmotion && MOOD_PRESETS[taggedEmotion]?.vrm_expression) || taggedEmotion || 'happy';
    },

    // SSML prosody for TTS derived from the mood's voice tone params.
    prosodyFor(mood) {
      if (!mood) return {};
      const preset = MOOD_PRESETS[mood.name] || {};
      const p = {};
      if (mood.voice_rate || preset.voice_rate) p.rate = mood.voice_rate || preset.voice_rate;
      if (mood.voice_pitch || preset.voice_pitch) p.pitch = mood.voice_pitch || preset.voice_pitch;
      return p;
    },

    invalidate() { cache = { rows: null, at: 0 }; },
  };
}
