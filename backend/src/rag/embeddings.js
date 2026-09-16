// Embedding provider (PRD sections 6 + 8). 'openai-compat' covers Jina / Cohere
// compatibility endpoint / OpenRouter-style /v1/embeddings servers. 'hash-test' is
// a deterministic local fallback so the RAG pipeline is testable without keys —
// it is not intended for production quality.
import { config } from '../config.js';

export function createEmbedder() {
  const { provider, baseUrl, apiKey, model, dim } = config.embeddings;

  if (provider === 'hash-test' || (provider === 'openai-compat' && !apiKey)) {
    if (provider === 'openai-compat' && !apiKey) {
      console.warn('[embeddings] EMBEDDINGS_API_KEY is empty — falling back to local hash-test embeddings.');
    }
    return {
      kind: 'hash-test',
      dim,
      async embed(text) { return hashEmbed(text, dim); },
    };
  }

  return {
    kind: 'openai-compat',
    dim,
    async embed(text) {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, input: [text] }),
      });
      if (!res.ok) throw new Error(`Embeddings HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const vec = data?.data?.[0]?.embedding;
      if (!Array.isArray(vec)) throw new Error('Embeddings response missing data[0].embedding');
      return vec;
    },
  };
}

// Deterministic bag-of-words hashing embedding: same text -> same vector; texts
// sharing words -> high cosine similarity. Good enough to prove retrieval wiring.
export function hashEmbed(text, dim = 384) {
  const vec = new Float64Array(dim);
  const words = String(text).toLowerCase().match(/[a-z0-9']{3,}/g) || [];
  for (const w of words) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 16777619); }
    vec[Math.abs(h) % dim] += 1;
  }
  // L2-normalize
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}
