import { cleanTextForTTS } from './cleaner.js';

// Fish Audio TTS — "Anime girl" / "Girl with a anime like cute women" model
// Model ID: 69eb6788dfae49cbad7ab498f459fb80
// Bilingual: supports both Hinglish (Roman) and Hindi (Devanagari) text.
export async function fishSynthesize(text, voice, keySecret, timeoutMs, { baseUrl, referenceId }) {
  const token = keySecret || process.env.FISH_AUDIO_API_KEY || process.env.FISH_AUDIO_API_KEYS?.split(',')[0]?.trim();
  const refId = referenceId || process.env.FISH_AUDIO_REFERENCE_ID || '69eb6788dfae49cbad7ab498f459fb80';
  const clean = cleanTextForTTS(text);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/tts`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        text: clean,
        reference_id: refId,
        format: 'mp3',
      }),
    });
    if (!res.ok) {
      const e = new Error(`fish-tts HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      e.status = res.status;
      throw e;
    }
    const audio = Buffer.from(await res.arrayBuffer());
    if (!audio.length) throw new Error('fish-tts produced empty audio');
    return { audio, mime: 'audio/mpeg' };
  } finally {
    clearTimeout(timer);
  }
}
