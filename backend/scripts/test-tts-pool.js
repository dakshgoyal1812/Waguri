import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTTSPool } from '../src/tts/index.js';
import { KeyPool } from '../src/keys/keyPool.js';
import { createStorage } from '../src/db/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

async function testTTSPool() {
  console.log('Testing TTS Pool with Gemini TTS as primary...');
  const storage = await createStorage();
  const keyPool = new KeyPool(storage);
  await keyPool.init();

  const synthesize = createTTSPool(keyPool);
  const start = Date.now();
  const text = 'Arre yaar, main Waguri hoon! Kaise ho aap?';
  const result = await synthesize(text);

  console.log(`✅ Synthesis successful!`);
  console.log(`   Provider used: ${result.provider}`);
  console.log(`   Audio bytes: ${result.audio.length}`);
  console.log(`   MIME type: ${result.mime}`);
  console.log(`   Duration: ${Date.now() - start}ms`);

  await keyPool.stop();
  process.exit(0);
}

testTTSPool().catch((err) => {
  console.error('❌ TTS Pool test failed:', err);
  process.exit(1);
});
