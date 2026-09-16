// OpenAI-compatible chat client used for every LLM tier (OpenRouter, Groq, NVIDIA
// are all OpenAI-compatible; PRD sections 6 + 9.2).
export class LLMHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
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
    const data = JSON.parse(bodyText);
    const text = data?.choices?.[0]?.message?.content ?? '';
    if (!text) throw new LLMHttpError(502, `Empty completion body: ${bodyText.slice(0, 200)}`);
    return { text, latencyMs, status: res.status };
  } catch (e) {
    if (e instanceof LLMHttpError) throw e;
    if (e.name === 'AbortError') throw new LLMHttpError(504, `LLM request timeout after ${timeoutMs}ms`);
    throw new LLMHttpError(0, `LLM network error: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}
