import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStorage } from '../src/db/index.js';
import { KeyPool } from '../src/keys/keyPool.js';
import { createLLMCaller } from '../src/llm/caller.js';
import { createEmbedder } from '../src/rag/embeddings.js';
import { createTTSPool } from '../src/tts/index.js';
import { createMoodEngine } from '../src/mood/engine.js';
import { createChatOrchestrator } from '../src/orchestrator/chat.js';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

async function testE2E() {
  console.log('Testing End-to-End Chat with Gemini TTS and Supabase DB...');
  const storage = await createStorage();
  const keyPool = new KeyPool(storage);
  await keyPool.init();

  const moodEngine = createMoodEngine(storage);
  const callLLM = createLLMCaller(keyPool);
  const embedder = createEmbedder();
  const synthesize = createTTSPool(keyPool);
  const orchestrator = createChatOrchestrator({ storage, callLLM, embedder, synthesize, moodEngine });

  const result = await orchestrator.handle({
    userId: 'local-user',
    message: 'Hello Waguri! Aap kaise ho?'
  });

  console.log('\n--- Result from Orchestrator ---');
  console.log('Reply text:', result.reply_text);
  console.log('Emotion:', result.emotion);
  console.log('Mood:', result.mood?.name);
  console.log('TTS provider used:', result.tts_provider);
  console.log('Audio URL:', result.audio_url);
  console.log('Memories used:', result.meta?.memories_used);
  console.log('Conversation ID:', result.conversation_id);

  await keyPool.stop();
  process.exit(0);
}

testE2E().catch((err) => {
  console.error('❌ E2E test failed:', err);
  process.exit(1);
});
