// Fish Audio TTS — keyed optional provider (PRD section 6 mentions a fishaudio TTS
// model in the pool). OpenRouter itself has no TTS endpoint, so this talks to the
// Fish Audio API directly; dormant unless api_keys has fishaudio rows.
export async function fishSynthesize(text, voice, keySecret, timeoutMs, { baseUrl, referenceId }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/tts`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${keySecret}`,
        'model': 's1',
      },
      body: JSON.stringify({
        text,
        reference_id: referenceId || undefined,
        format: 'mp3',
      }),
    });
    if (!res.ok) { const e = new Error(`fish-tts HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); e.status = res.status; throw e; }
    const audio = Buffer.from(await res.arrayBuffer());
    if (!audio.length) throw new Error('fish-tts produced empty audio');
    return { audio, mime: 'audio/mpeg' };
  } finally {
    clearTimeout(timer);
  }
}
