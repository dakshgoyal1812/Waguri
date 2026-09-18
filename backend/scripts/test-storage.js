import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSupabaseStorage } from '../src/db/supabase.js';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const db = createSupabaseStorage(process.env.DATABASE_URL);

async function testAllStorage() {
  console.log('Testing storage methods...');
  try {
    await db.init();
    console.log('✅ init()');

    const persona = await db.getDefaultPersona();
    console.log('✅ getDefaultPersona():', persona?.name, persona?.id);

    const moods = await db.listAllMoods();
    console.log('✅ listAllMoods(): count =', moods.length);

    const conv = await db.createConversation({ persona_id: persona?.id, user_id: 'test-runner' });
    console.log('✅ createConversation():', conv.id);

    const latest = await db.getLatestConversation('test-runner');
    console.log('✅ getLatestConversation():', latest?.id);

    const msgUser = await db.addMessage({ conversation_id: conv.id, role: 'user', content: 'Test user message' });
    console.log('✅ addMessage(user):', msgUser.id);

    const msgAssistant = await db.addMessage({ conversation_id: conv.id, role: 'assistant', content: 'Test assistant reply' });
    console.log('✅ addMessage(assistant):', msgAssistant.id);

    const recent = await db.getRecentMessages(conv.id, 5);
    console.log('✅ getRecentMessages(): count =', recent.length);

    const history = await db.getHistory(conv.id, { page: 1, limit: 10 });
    console.log('✅ getHistory(): total =', history.total);

    // Vector test
    const dummyVector = new Array(1024).fill(0).map((_, i) => (i === 0 ? 1 : 0));
    const mem = await db.insertMemoryVector({ conversation_id: conv.id, content_chunk: 'test chunk', embedding: dummyVector });
    console.log('✅ insertMemoryVector():', mem.id);

    const search = await db.searchMemory({ conversation_id: conv.id, embedding: dummyVector, k: 3 });
    console.log('✅ searchMemory(): found =', search.length);

    const keys = await db.listKeys('groq');
    console.log('✅ listKeys(groq): count =', keys.length);

    await db.logKeyUsage({ key_id: keys[0]?.id || null, status_code: 200, latency_ms: 123 });
    console.log('✅ logKeyUsage()');

    const usage = await db.getUsageLog(5);
    console.log('✅ getUsageLog(): count =', usage.length);

    console.log('\nALL STORAGE METHODS PASSED!');
  } catch (err) {
    console.error('❌ Storage method failed:', err);
  } finally {
    process.exit(0);
  }
}

testAllStorage();
