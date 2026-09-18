import { config, seedKeys } from '../src/config.js';
import { geminiSynthesize } from '../src/tts/gemini.js';
import { edgeSynthesize } from '../src/tts/edge.js';

console.log('Testing TTS verification...');
const googleKeys = seedKeys.google || [];
console.log('Google keys count:', googleKeys.length);

if (googleKeys.length > 0) {
  const start = Date.now();
  const rawKey = typeof googleKeys[0] === 'string' ? googleKeys[0] : googleKeys[0].key;
  try {
    const res = await geminiSynthesize('Namaste! Main Waguri hoon.', rawKey, {
      voice: config.tts.geminiVoice,
      model: config.tts.geminiModel,
      style: config.tts.geminiStyle,
      timeoutMs: 15000,
    });
    console.log(`✅ Gemini TTS: OK (${Date.now() - start}ms, voice=${config.tts.geminiVoice}, bytes=${res.audio.length}, mime=${res.mime})`);
  } catch (err) {
    console.error('❌ Gemini TTS failed:', err.message);
  }
}

const edgeStart = Date.now();
try {
  const edgeRes = await edgeSynthesize('Hello from Waguri!', config.tts.voice, 10000);
  console.log(`✅ Edge TTS fallback: OK (${Date.now() - edgeStart}ms, bytes=${edgeRes.audio.length}, mime=${edgeRes.mime})`);
} catch (err) {
  console.error('❌ Edge TTS failed:', err.message);
}

process.exit(0);
