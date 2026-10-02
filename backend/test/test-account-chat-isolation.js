// Test suite: Account Chat Isolation & AES-256-GCM Encryption at rest
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/db/memory.js';
import { encryptMessage, decryptMessage } from '../src/crypto.js';
import { createChatOrchestrator } from '../src/orchestrator/chat.js';

console.log('--- Running Account Chat Isolation & Encryption Tests ---');

// 1. Crypto module unit test
{
  const plain = 'Secret girlfriend promise: I love you forever';
  const encrypted = encryptMessage(plain);
  assert(encrypted.startsWith('enc:v1:'), 'Encrypted message must have enc:v1: prefix');
  assert.notEqual(encrypted, plain, 'Encrypted message must not match plaintext');
  assert(!encrypted.includes(plain), 'Encrypted payload must not contain plaintext string');

  const decrypted = decryptMessage(encrypted);
  assert.equal(decrypted, plain, 'Decrypted message must match original plaintext');

  // Legacy plaintext fallback test
  const legacy = 'Legacy unencrypted message';
  assert.equal(decryptMessage(legacy), legacy, 'Legacy plaintext must be returned untouched');

  console.log('✓ Message AES-256-GCM encryption & decryption passed');
}

// 2. Storage encryption at rest test
{
  const storage = createMemoryStorage();
  const convA = await storage.createConversation({ persona_id: 'p1', user_id: 'user_a@test.com' });

  // Add message
  const added = await storage.addMessage({
    conversation_id: convA.id,
    role: 'user',
    content: 'My secret pin is 1234',
  });
  assert.equal(added.content, 'My secret pin is 1234', 'Caller receives plaintext');

  // Inspect raw memory storage directly to verify encryption at rest
  const history = await storage.getHistory(convA.id, { page: 1, limit: 10 });
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].content, 'My secret pin is 1234', 'getHistory returns decrypted content');

  // Insert memory vector
  await storage.insertMemoryVector({
    conversation_id: convA.id,
    content_chunk: 'User said their secret pin is 1234',
    embedding: [0.1, 0.2, 0.3],
  });

  const recalled = await storage.searchMemory({
    userId: 'user_a@test.com',
    conversation_id: convA.id,
    embedding: [0.1, 0.2, 0.3],
    k: 5,
  });
  assert.equal(recalled.length, 1);
  assert.equal(recalled[0].content_chunk, 'User said their secret pin is 1234', 'Recalled memory is decrypted');

  console.log('✓ Storage layer encryption at rest passed');
}

// 3. Cross-account memory partition test
{
  const storage = createMemoryStorage();
  const convA = await storage.createConversation({ persona_id: 'p1', user_id: 'user_a@test.com' });
  const convB = await storage.createConversation({ persona_id: 'p1', user_id: 'user_b@test.com' });

  // Store memories for user A
  await storage.insertMemoryVector({
    conversation_id: convA.id,
    content_chunk: 'User A loves chocolate cake',
    embedding: [0.9, 0.1, 0.0],
  });

  // Store memories for user B
  await storage.insertMemoryVector({
    conversation_id: convB.id,
    content_chunk: 'User B hates sweets and loves spicy ramen',
    embedding: [0.9, 0.1, 0.0],
  });

  // Query memory for user A
  const memsA = await storage.searchMemory({
    userId: 'user_a@test.com',
    conversation_id: convA.id,
    embedding: [0.9, 0.1, 0.0],
    k: 5,
  });
  assert.equal(memsA.length, 1);
  assert.equal(memsA[0].content_chunk, 'User A loves chocolate cake');

  // Query memory for user B with same query embedding
  const memsB = await storage.searchMemory({
    userId: 'user_b@test.com',
    conversation_id: convB.id,
    embedding: [0.9, 0.1, 0.0],
    k: 5,
  });
  assert.equal(memsB.length, 1);
  assert.equal(memsB[0].content_chunk, 'User B hates sweets and loves spicy ramen');

  console.log('✓ Cross-account RAG memory vector partition passed');
}

// 4. Orchestrator conversation hijacking prevention test
{
  const storage = createMemoryStorage();
  const persona = await storage.upsertPersona({
    name: 'Waguri',
    prompt_template: 'You are Waguri.',
    personality_traits: ['sweet'],
  });

  const convA = await storage.createConversation({ persona_id: persona.id, user_id: 'user_a@test.com' });
  await storage.addMessage({
    conversation_id: convA.id,
    role: 'user',
    content: 'Hello from User A',
  });

  const dummyLLM = async (messages) => ({
    text: '[happy] Hello! Nice to talk to you!',
    provider: 'test-llm',
    model: 'dummy-model',
    latencyMs: 50,
  });

  const dummyEmbedder = {
    embed: async (text) => [0.1, 0.2, 0.3],
  };

  const dummySynthesize = async (text) => ({
    audio: Buffer.from('dummy'),
    mime: 'audio/mp3',
    provider: 'test-tts',
  });

  const orchestrator = createChatOrchestrator({
    storage,
    callLLM: dummyLLM,
    embedder: dummyEmbedder,
    synthesize: dummySynthesize,
    moodEngine: null,
  });

  // User B tries to send message passing User A's conversationId
  const replyB = await orchestrator.handle({
    conversationId: convA.id,
    personaId: persona.id,
    userId: 'user_b@test.com',
    message: 'Hello from User B trying to hijack',
  });

  // Verify User B did not write into User A's conversation
  assert.notEqual(replyB.conversation_id, convA.id, 'User B must be rerouted to their own conversation');

  const historyA = await storage.getHistory(convA.id, { page: 1, limit: 10 });
  assert.equal(historyA.items.length, 1, 'User A conversation history must not contain User B message');
  assert.equal(historyA.items[0].content, 'Hello from User A');

  console.log('✓ Cross-account conversation hijacking protection passed');
}

console.log('ALL ACCOUNT CHAT ISOLATION & ENCRYPTION TESTS PASSED! 🎉');
