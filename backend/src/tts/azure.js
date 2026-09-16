// Azure Speech TTS — keyed fallback pool (PRD section 9.4). Keys live in api_keys
// with provider='azure_tts'; the region rides on account_label (ASSUMPTION: the
// PRD's account_label field is the natural place to carry the per-key region).
// 429/quota -> cooldown, instantly retry next region's key (PRD section 9.4).
export function azureBaseUrlOverride() {
  return process.env.AZURE_TTS_BASE_URL_TEMPLATE || ''; // e.g. http://127.0.0.1:9099/{region} for tests
}

export async function azureSynthesize(text, voice, keySecret, region, timeoutMs, prosody = {}) {
  const template = azureBaseUrlOverride();
  const base = template
    ? template.replace('{region}', region)
    : `https://${region}.tts.speech.microsoft.com`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/cognitiveservices/v1`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Ocp-Apim-Subscription-Key': keySecret,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'waguri-persona-twin',
      },
      body: ssml(text, voice, prosody),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      const e = new Error(`azure-tts HTTP ${res.status}: ${detail}`);
      e.status = res.status;
      throw e;
    }
    const audio = Buffer.from(await res.arrayBuffer());
    if (!audio.length) throw new Error('azure-tts produced empty audio');
    return { audio, mime: 'audio/mpeg' };
  } catch (e) {
    if (!e.status) { const w = new Error(`azure-tts failed: ${e.message}`); w.status = 0; throw w; }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function ssml(text, voice, prosody = {}) {
  // Mood voice tone rides in a prosody element; attrs omitted when absent.
  const attrs = [
    prosody.rate ? `rate='${escapeXml(prosody.rate)}'` : '',
    prosody.pitch ? `pitch='${escapeXml(prosody.pitch)}'` : '',
  ].filter(Boolean).join(' ');
  const inner = attrs ? `<prosody ${attrs}>${escapeXml(text)}</prosody>` : escapeXml(text);
  return `<speak version='1.0' xml:lang='en-IN'><voice name='${escapeXml(voice)}'>${inner}</voice></speak>`;
}
function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
