// Complete verification of all API keys and services configured in .env
import pg from 'pg';
import { config, seedKeys } from '../src/config.js';
import { chatCompletion, LLMHttpError } from '../src/llm/openaiCompat.js';
import { createEmbedder } from '../src/rag/embeddings.js';
import { edgeSynthesize } from '../src/tts/edge.js';
import { geminiSynthesize } from '../src/tts/gemini.js';

console.log('====================================================');
console.log('       WAGURI PROJECT API KEYS & SERVICES TEST       ');
console.log('====================================================\n');

async function testDatabase() {
  console.log('--- 1. Testing Database (Supabase / Postgres) ---');
  if (!config.databaseUrl) {
    console.log('⚠️  DATABASE_URL is not set. STORAGE_ADAPTER = ' + config.storageAdapter);
    return;
  }
  const pool = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    const { rows } = await pool.query('SELECT 1 as ok, current_database(), current_user;');
    console.log(`✅ Postgres Connection: OK (DB: ${rows[0].current_database}, User: ${rows[0].current_user})`);
    
    // Check vector extension
    try {
      const ext = await pool.query("SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';");
      if (ext.rows.length) {
        console.log(`✅ pgvector Extension: Enabled (v${ext.rows[0].extversion})`);
      } else {
        console.log('⚠️  pgvector Extension: NOT installed in database');
      }
    } catch (e) {
      console.log('⚠️  pgvector check failed:', e.message);
    }

    // Check tables
    const tblRes = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const tables = tblRes.rows.map(r => r.table_name);
    console.log(`ℹ️  Found tables in public schema: ${tables.join(', ') || '(none)'}`);
    const expected = ['personas', 'conversations', 'messages', 'memory_vectors', 'api_keys', 'moods'];
    const missing = expected.filter(t => !tables.includes(t));
    if (missing.length) {
      console.log(`⚠️  Missing expected tables: ${missing.join(', ')}`);
    } else {
      console.log('✅ All expected tables present');
    }
  } catch (err) {
    console.log(`❌ Database connection failed: ${err.message}`);
  } finally {
    await pool.end();
  }
}

async function testEmbeddings() {
  console.log('\n--- 2. Testing Embeddings ---');
  console.log(`Provider: ${config.embeddings.provider}`);
  console.log(`Base URL: ${config.embeddings.baseUrl}`);
  console.log(`Model: ${config.embeddings.model}`);
  console.log(`API Key: ${config.embeddings.apiKey ? '***' + config.embeddings.apiKey.slice(-4) : '(none)'}`);
  try {
    const embedder = createEmbedder();
    const start = Date.now();
    const vec = await embedder.embed('Hello Waguri memory test');
    console.log(`✅ Embeddings OK: generated vector length ${vec.length} in ${Date.now() - start}ms`);
  } catch (err) {
    console.log(`❌ Embeddings failed: ${err.message}`);
  }
}

async function testLLMKeys() {
  console.log('\n--- 3. Testing LLM Provider Keys ---');
  for (const tier of config.llmTiers) {
    const prov = config.llmProviders[tier];
    if (!prov) {
      console.log(`Provider tier '${tier}' has no config.`);
      continue;
    }
    const keys = seedKeys[tier] || [];
    console.log(`\nProvider: [${tier.toUpperCase()}] | Base URL: ${prov.baseUrl}`);
    console.log(`Models configured: ${prov.models.join(', ') || '(none)'}`);
    console.log(`Total keys found: ${keys.length}`);

    if (keys.length === 0) {
      console.log(`⚠️  No keys configured for ${tier}`);
      continue;
    }

    for (let i = 0; i < keys.length; i++) {
      const rawKey = typeof keys[i] === 'string' ? keys[i] : keys[i].key;
      const masked = rawKey.length > 8 ? rawKey.slice(0, 5) + '...' + rawKey.slice(-4) : '***';
      let succeeded = false;
      let lastErr = null;
      for (const m of prov.models) {
        try {
          const start = Date.now();
          const res = await chatCompletion({
            baseUrl: prov.baseUrl,
            apiKey: rawKey,
            model: m,
            messages: [{ role: 'user', content: 'Say "OK" in 1 word.' }],
            timeoutMs: 15000,
          });
          const dur = Date.now() - start;
          console.log(`  ✅ Key #${i + 1} (${masked}) [${m}]: OK (${dur}ms) -> "${res.text.trim().replace(/\n/g, ' ').slice(0, 30)}"`);
          succeeded = true;
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!succeeded) {
        console.log(`  ❌ Key #${i + 1} (${masked}): FAILED -> ${lastErr ? lastErr.message.slice(0, 180) : 'unknown error'}`);
      }
    }
  }
}

async function testTTS() {
  console.log('\n--- 4. Testing TTS Providers ---');
  console.log(`Configured TTS providers: ${config.tts.providers.join(', ')}`);

  // Test Gemini TTS
  const googleKeys = seedKeys.google || [];
  if (googleKeys.length > 0) {
    try {
      const start = Date.now();
      const rawKey = typeof googleKeys[0] === 'string' ? googleKeys[0] : googleKeys[0].key;
      const res = await geminiSynthesize('Namaste! Main Waguri hoon.', rawKey, {
        voice: config.tts.geminiVoice,
        model: config.tts.geminiModel,
        style: config.tts.geminiStyle,
        timeoutMs: 15000,
      });
      console.log(`✅ Gemini TTS synthesized successfully in ${Date.now() - start}ms (voice: ${config.tts.geminiVoice}, audio: ${res.audio.length} bytes, MIME: ${res.mime})`);
    } catch (err) {
      console.log(`❌ Gemini TTS synthesis failed: ${err.message}`);
    }
  }

  try {
    const start = Date.now();
    const res = await edgeSynthesize('Hello! Waguri is ready.', config.tts.voice, 10000);
    console.log(`✅ Edge TTS synthesized successfully in ${Date.now() - start}ms (audio: ${res.audio.length} bytes, MIME: ${res.mime})`);
  } catch (err) {
    console.log(`❌ Edge TTS synthesis failed: ${err.message}`);
  }
}

async function run() {
  await testDatabase();
  await testEmbeddings();
  await testLLMKeys();
  await testTTS();
  console.log('\n====================================================');
  console.log('                 VERIFICATION COMPLETE              ');
  console.log('====================================================\n');
}

run();
