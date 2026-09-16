// TTS pool orchestrator (PRD sections 6 + 9.4).
//
// Chain comes from TTS_PROVIDERS (default edge,azure,google). Keyed providers
// (azure_tts, fishaudio) rotate through the Key Pool Manager with the exact same
// cooldown semantics as the LLM pool. Keyless providers (edge, google) have no
// quota to rotate — PRD section 9.4: "treat a failure here the same as a 'key'
// cooldown in the pool logic", so they get a virtual 60s in-memory cooldown.
import { config } from '../config.js';
import { edgeSynthesize } from './edge.js';
import { azureSynthesize } from './azure.js';
import { googleSynthesize } from './google.js';
import { fishSynthesize } from './fishaudio.js';
import { cleanTextForTTS } from './cleaner.js';

const VIRTUAL_COOLDOWN_MS = config.cooldownPerMinuteMs;
const virtualHealth = new Map(); // provider -> cooldownUntil (ms epoch)

const DEVANAGARI = /[\u0900-\u097F]/;

function voiceFor(text) {
  // Bilingual: Devanagari text needs a Hindi voice; Roman-script English/Hinglish
  // is spoken well by the Indian-English or Anime female voice.
  return DEVANAGARI.test(text) ? config.tts.voiceHindi : config.tts.voice;
}

function virtualAvailable(name) {
  return (virtualHealth.get(name) || 0) < Date.now();
}

export function createTTSPool(keyPool) {
  // prosody: { rate?, pitch? } SSML strings from the active mood (voice tone).
  async function synthesize(text, prosody = {}) {
    const errors = [];
    // Emojis, asterisks, and markdown must NEVER be read aloud by TTS
    const clean = cleanTextForTTS(text);
    const voice = voiceFor(clean);

    for (const provider of config.tts.providers) {
      try {
        if (provider === 'fishaudio') {
          const envKey = process.env.FISH_AUDIO_API_KEY || process.env.FISH_AUDIO_API_KEYS?.split(',')[0]?.trim();
          if (envKey) {
            try {
              const r = await fishSynthesize(clean, voice, envKey, config.requestTimeoutMs, {
                baseUrl: config.tts.fishBaseUrl,
                referenceId: config.tts.fishReferenceId || '69eb6788dfae49cbad7ab498f459fb80',
              });
              return { ...r, provider: 'fishaudio' };
            } catch (e) {
              errors.push(`fishaudio/env: ${e.message}`);
            }
          } else {
            for (;;) {
              const key = await keyPool.getNextKey('fishaudio');
              if (!key) { errors.push('fishaudio: pool exhausted'); break; }
              const started = Date.now();
              try {
                const r = await fishSynthesize(clean, voice, key.secret, config.requestTimeoutMs, {
                  baseUrl: config.tts.fishBaseUrl,
                  referenceId: config.tts.fishReferenceId || '69eb6788dfae49cbad7ab498f459fb80',
                });
                await keyPool.markSuccess(key.id);
                await keyPool.recordUsage(key.id, 200, Date.now() - started);
                return { ...r, provider: 'fishaudio' };
              } catch (e) {
                await keyPool.recordUsage(key.id, e.status ?? 0, Date.now() - started);
                errors.push(`fishaudio/${key.account_label}: ${e.message}`);
                await keyPool.markCooldown(key.id, new Date(Date.now() + VIRTUAL_COOLDOWN_MS));
              }
            }
          }
          continue;
        }
        if (provider === 'edge') {
          if (!virtualAvailable('edge')) { errors.push('edge: virtual cooldown'); continue; }
          const r = await edgeSynthesize(clean, voice, config.requestTimeoutMs, prosody);
          return { ...r, provider };
        }
        if (provider === 'google') {
          if (!virtualAvailable('google')) { errors.push('google: virtual cooldown'); continue; }
          const r = await googleSynthesize(clean, voice, config.requestTimeoutMs);
          return { ...r, provider };
        }
        if (provider === 'azure') {
          // PRD section 9.4: same getNextKey('azure_tts') pattern — on 429 mark that
          // region's key in cooldown and instantly retry with the next region's key.
          for (;;) {
            const key = await keyPool.getNextKey('azure_tts');
            if (!key) { errors.push('azure: pool exhausted'); break; }
            const started = Date.now();
            try {
              const r = await azureSynthesize(clean, voice, key.secret, key.account_label, config.requestTimeoutMs, prosody);
              await keyPool.markSuccess(key.id);
              await keyPool.recordUsage(key.id, 200, Date.now() - started);
              return { ...r, provider: 'azure' };
            } catch (e) {
              await keyPool.recordUsage(key.id, e.status ?? 0, Date.now() - started);
              errors.push(`azure/${key.account_label}: ${e.message}`);
              if (e.status === 429) await keyPool.markCooldown(key.id, new Date(Date.now() + VIRTUAL_COOLDOWN_MS));
              else if (e.status === 401 || e.status === 403) await keyPool.markExhausted(key.id);
              else await keyPool.markCooldown(key.id, new Date(Date.now() + VIRTUAL_COOLDOWN_MS));
            }
          }
          continue;
        }
        errors.push(`${provider}: unknown provider`);
      } catch (e) {
        // Keyless provider hard failure -> virtual cooldown so the next request in
        // the next 60s goes straight to the fallback instead of re-failing slowly.
        if (provider === 'edge' || provider === 'google') {
          virtualHealth.set(provider, Date.now() + VIRTUAL_COOLDOWN_MS);
        }
        errors.push(`${provider}: ${e.message}`);
      }
    }
    const err = new Error(`All TTS providers failed: ${errors.join(' | ')}`);
    err.status = 503;
    throw err;
  }
  return synthesize;
}
