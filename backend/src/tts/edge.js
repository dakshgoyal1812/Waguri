// Edge TTS provider — primary, keyless (PRD section 9.4, msedge-tts).
// Failures (network, IP-level rate limit) are thrown so the TTS pool treats them
// like a key cooldown and falls through to the next provider.
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

// msedge-tts close() is synchronous and returns void (dist/MsEdgeTTS.d.ts:85) — and
// throws if the websocket never connected. Contain both instead of chaining .catch.
function safeClose(tts) {
  try { tts.close(); } catch { /* socket may already be gone */ }
}

export async function edgeSynthesize(text, voice, timeoutMs, prosody = {}) {
  const tts = new MsEdgeTTS();
  // The underlying websocket may reject without a useful message; always contain it.
  const withTimeout = (p) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('edge-tts timeout')), timeoutMs)),
  ]);

  try {
    await withTimeout(tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3));
    // Mood voice tone: only hand ProsodyOptions over when non-empty.
    const hasProsody = prosody && (prosody.rate || prosody.pitch || prosody.volume);
    const { audioStream } = hasProsody
      ? tts.toStream(text, prosody)
      : tts.toStream(text);
    const chunks = [];
    try {
      for await (const c of audioStream) chunks.push(c);
    } finally {
      audioStream.on?.('error', () => {}); // drain late socket errors
    }
    const audio = Buffer.concat(chunks);
    if (!audio.length) throw new Error('edge-tts produced empty audio');
    safeClose(tts);
    return { audio, mime: 'audio/mpeg' };
  } catch (e) {
    safeClose(tts);
    const msg = e && e.message ? e.message : String(e);
    throw new Error(`edge-tts failed: ${msg}`);
  }
}
