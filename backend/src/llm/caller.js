// LLM call with multi-key rotation across provider tiers (PRD sections 9.2 + 9.3).
// Tier order comes from LLM_PROVIDER_TIERS (e.g. openrouter,groq,nvidia). Within a
// tier every active key is tried least-used first; within a key every configured
// model is tried (PRD section 13: free model availability rotates, keep as config).
// A single key's failure must never surface to the user (PRD section 12) — only
// total pool exhaustion throws PoolExhaustedError.
import { config } from '../config.js';
import { chatCompletion, LLMHttpError } from './openaiCompat.js';
import { cooldownExpiryFrom429, PoolExhaustedError } from '../keys/keyPool.js';

export function createLLMCaller(keyPool) {
  // options.temperature: characters.base_temperature from Supabase (undefined = provider default)
  async function callLLM(messages, options = {}) {
    const errors = [];
    for (const provider of config.llmTiers) {
      const prov = config.llmProviders[provider];
      if (!prov || !prov.models.length) continue;

      // Each failed key leaves the active set (cooldown/exhausted), so this loop
      // always makes progress and terminates when the tier is drained.
      // Keyless providers (local dev against the mock / a self-hosted
      // OpenAI-compatible server, no keys in .env) get one direct attempt.
      const keyless = !(await keyPool.hasKeys(provider));
      if (keyless) {
        for (const model of prov.models) {
          const started = Date.now();
          try {
            const res = await chatCompletion({
              baseUrl: prov.baseUrl,
              apiKey: 'local-dev', // placeholder — local/mock servers ignore it
              model,
              messages,
              timeoutMs: config.requestTimeoutMs,
              temperature: options.temperature,
            });
            return { text: res.text, provider, model, keyId: null, latencyMs: Date.now() - started };
          } catch (e) {
            errors.push(`${provider}/keyless/${model}: HTTP ${e instanceof LLMHttpError ? e.status : 500} ${String(e.message).slice(0, 200)}`);
          }
        }
        continue; // keyless tier failed — try the next tier
      }
      for (;;) {
        const key = await keyPool.getNextKey(provider);
        if (!key) break; // tier exhausted -> fall to next tier

        for (const model of prov.models) {
          const started = Date.now();
          try {
            const res = await chatCompletion({
              baseUrl: prov.baseUrl,
              apiKey: key.secret,
              model,
              messages,
              timeoutMs: config.requestTimeoutMs,
              temperature: options.temperature,
            });
            await keyPool.markSuccess(key.id);
            await keyPool.recordUsage(key.id, res.status, res.latencyMs);
            return {
              text: res.text,
              provider,
              model,
              keyId: key.id,
              latencyMs: Date.now() - started,
            };
          } catch (e) {
            const status = e instanceof LLMHttpError ? e.status : 500;
            const latencyMs = Date.now() - started;
            await keyPool.recordUsage(key.id, status, latencyMs);
            errors.push(`${provider}/${key.account_label}/${model}: HTTP ${status} ${String(e.message).slice(0, 200)}`);

            if (status === 429) {
              // Per-minute limit -> 60s; daily quota -> midnight UTC (PRD section 9.3)
              await keyPool.markCooldown(key.id, cooldownExpiryFrom429(e.message));
            } else if (status === 401 || status === 402 || status === 403) {
              await keyPool.markExhausted(key.id); // invalid key / no credits
            } else {
              // 5xx / network: brief cooldown so the next attempt uses another key
              await keyPool.markCooldown(key.id, new Date(Date.now() + config.cooldownPerMinuteMs));
            }
          }
        }
      }
    }
    throw new PoolExhaustedError(config.llmTiers.join(','));
  }
  return callLLM;
}
