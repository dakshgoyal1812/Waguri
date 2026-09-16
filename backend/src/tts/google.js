// Google TTS — keyless fallback (PRD section 6 lists "google tts model" in the TTS
// pool). Uses the public translate_tts endpoint; text is chunked to <=200 chars
// because that endpoint caps query length.
const MAX_Q = 200;

export async function googleSynthesize(text, voice, timeoutMs) {
  const parts = chunk(String(text));
  const buffers = [];
  for (const p of parts) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=${encodeURIComponent(p)}`;
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
