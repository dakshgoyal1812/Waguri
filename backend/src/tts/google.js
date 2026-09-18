// Google TTS — keyless fallback (PRD section 6 lists "google tts model" in the TTS
// pool). Uses the public translate_tts endpoint; text is chunked to <=200 chars
// because that endpoint caps query length.
// Bilingual: detects Devanagari script for Hindi voice, otherwise Indian English.
const MAX_Q = 200;
const DEVANAGARI = /[\u0900-\u097F]/;

export async function googleSynthesize(text, voice, timeoutMs) {
  // Extract language from voice string (e.g., 'hi-IN-SwaraNeural' -> 'hi', 'en-IN-...' -> 'en')
  const langCode = voice && typeof voice === 'string' && voice.includes('-IN')
    ? voice.split('-')[0]
    : (DEVANAGARI.test(text) ? 'hi' : 'en');
  const parts = chunk(String(text));
  const buffers = [];
  for (const p of parts) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${langCode}&q=${encodeURIComponent(p)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      if (!res.ok) { const e = new Error(`google-tts HTTP ${res.status}`); e.status = res.status; throw e; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new Error('google-tts produced empty audio');
      buffers.push(buf);
    } finally {
      clearTimeout(timer);
    }
  }
  return { audio: Buffer.concat(buffers), mime: 'audio/mpeg' };
}

function chunk(text) {
  const words = text.split(/\s+/);
  const out = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > MAX_Q && cur) { out.push(cur.trim()); cur = w; }
    else cur = `${cur} ${w}`;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
