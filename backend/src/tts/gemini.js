// Google / Gemini TTS provider (Gemini 2.5 Flash TTS / Gemini 3.1 Flash TTS Preview)
// Supports steerable performance via Director's Notes / Style instructions and prebuilt voice (e.g. Leda).
// Converts the raw Linear16 24kHz PCM returned by Gemini into standard WAV so browsers and
// <audio> elements play it seamlessly.

function pcmToWav(pcmBuffer, sampleRate = 24000, numChannels = 1, bitDepth = 16) {
  const byteRate = (sampleRate * numChannels * bitDepth) / 8;
  const blockAlign = (numChannels * bitDepth) / 8;
  const dataLength = pcmBuffer.length;
  const buffer = Buffer.alloc(44 + dataLength);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);

  // Sub-chunk 1: "fmt "
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // SubChunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitDepth, 34);

  // Sub-chunk 2: "data"
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  pcmBuffer.copy(buffer, 44);

  return buffer;
}

export async function geminiSynthesize(text, apiKey, options = {}) {
  const voiceName = options.voice || 'Leda';
  const model = options.model || 'gemini-2.5-flash-preview-tts';
  const style = options.style || 'A soothing female voice with a gentle, empathetic tone. This voice is characterized by a fast, measured pace that creates an intimate and calming atmosphere.';
  const timeoutMs = options.timeoutMs || 20000;

  // Combine style instructions (Director's notes) with the text transcript
  const promptText = style
    ? `Director's Notes: ${style}\n\nTranscript:\n${text}`
    : text;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: promptText }]
      }
    ],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName
          }
        }
      }
    }
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const err = new Error(`gemini-tts HTTP ${res.status}: ${errBody.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    const inline = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inline || !inline.data) {
      const err = new Error('gemini-tts produced no audio data');
      err.status = 502;
      throw err;
    }

    const rawPcm = Buffer.from(inline.data, 'base64');
    if (!rawPcm.length) {
      throw new Error('gemini-tts produced empty audio buffer');
    }

    const wavBuffer = pcmToWav(rawPcm, 24000);
    return { audio: wavBuffer, mime: 'audio/wav' };
  } finally {
    clearTimeout(timer);
  }
}
