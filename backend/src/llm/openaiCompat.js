// OpenAI-compatible chat client used for every LLM tier (OpenRouter, Groq, NVIDIA
// are all OpenAI-compatible; PRD sections 6 + 9.2).
export class LLMHttpError extends Error {
  constructor(status, message, { isEmpty = false } = {}) {
    super(message);
    this.status = status;
    // True when the provider answered HTTP 200 but with no usable text (content
    // filter, reasoning-only output, truncation). The KEY is healthy in that
    // case — the caller must fail over to another MODEL, not cool the key down.
    this.isEmpty = isEmpty;
  }
}

// `content` is a string on OpenAI-compatible providers, but some gateways return
// content-part arrays; tolerate both and normalize to plain text.
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('');
  }
  return '';
}

export async function chatCompletion({ baseUrl, apiKey, model, messages, timeoutMs, temperature }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // OpenRouter attribution headers (recommended, harmless elsewhere)
        'HTTP-Referer': 'https://waguri.local',
        'X-Title': 'Waguri persona-twin',
      },
      // characters.base_temperature from Supabase rides in as `temperature`
      body: JSON.stringify({ model, messages, ...(temperature !== undefined ? { temperature } : {}) }),
    });
    const latencyMs = Date.now() - started;
    const bodyText = await res.text();
    if (!res.ok) {
      throw new LLMHttpError(res.status, bodyText.slice(0, 500) || `HTTP ${res.status}`);
    }
    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      // HTTP 200 with a non-JSON body (proxy error page) — the key is fine, the
      // upstream answer is garbage; treat like an empty response.
      throw new LLMHttpError(502, `Non-JSON completion body: ${bodyText.slice(0, 200)}`, { isEmpty: true });
    }
    const text = contentToText(data?.choices?.[0]?.message?.content).trim();
    if (!text) throw new LLMHttpError(502, `Empty completion body: ${bodyText.slice(0, 200)}`, { isEmpty: true });
    return { text, latencyMs, status: res.status };
  } catch (e) {
    if (e instanceof LLMHttpError) throw e;
    if (e.name === 'AbortError') throw new LLMHttpError(504, `LLM request timeout after ${timeoutMs}ms`);
    throw new LLMHttpError(0, `LLM network error: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}
