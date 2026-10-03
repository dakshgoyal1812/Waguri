// Integration test for MCP server routes (/api/mcp and /api/mcp/proxy)
import './_setenv.js';
import assert from 'node:assert';
import { createMcpRouter } from '../src/routes/mcp.js';
import express from 'express';

const app = express();
app.use(express.json());

// Mock storage
const mockStorage = {
  getDefaultPersona: async () => ({
    name: 'Waguri',
    backstory: 'AI companion',
    personality_traits: ['warm', 'cheerful'],
  }),
  getPersona: async () => ({ name: 'Waguri' }),
  searchMemory: async ({ query }) => [
    { id: '1', content: `Memory about ${query}`, score: 0.95 },
  ],
  listAlarms: async () => [
    { id: 'alarm-1', title: 'Wake up', time: '08:00', enabled: true },
  ],
  upsertAlarm: async (a) => ({ id: 'alarm-new', ...a }),
};

// Mock orchestrator
const mockOrchestrator = {
  handle: async ({ message }) => ({
    reply_text: `Hello from Waguri: ${message}`,
    emotion: 'happy',
    audio_url: 'http://mock/audio.mp3',
  }),
};

// Mock games
const mockGames = {
  start: async ({ game }) => ({
    session_id: 'session-123',
    game,
    board: '---------',
    message: 'Let the game begin!',
  }),
  move: async ({ sessionId, move }) => ({
    session_id: sessionId,
    move,
    state: 'in_progress',
  }),
};

const mcpRouter = createMcpRouter({
  storage: mockStorage,
  orchestrator: mockOrchestrator,
  games: mockGames,
  pushScheduler: {},
});

app.use('/api/mcp', mcpRouter);

const server = app.listen(9876, async () => {
  try {
    console.log('[test-mcp] Server started on port 9876');

    // 1. Test GET /api/mcp/info
    const infoRes = await fetch('http://127.0.0.1:9876/api/mcp/info');
    assert.strictEqual(infoRes.status, 200);
    const info = await infoRes.json();
    assert.strictEqual(info.name, 'waguri-mcp-server');
    assert.ok(info.tools_count >= 5);
    console.log('✓ 1. GET /api/mcp/info returned valid server info');

    // 2. Test initialize
    const initRes = await fetch('http://127.0.0.1:9876/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      }),
    });
    assert.strictEqual(initRes.status, 200);
    const initData = await initRes.json();
    assert.strictEqual(initData.result.serverInfo.name, 'waguri-mcp-server');
    console.log('✓ 2. POST /api/mcp initialize handshake passed');

    // 3. Test tools/list
    const listRes = await fetch('http://127.0.0.1:9876/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      }),
    });
    assert.strictEqual(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(Array.isArray(listData.result.tools));
    const toolNames = listData.result.tools.map((t) => t.name);
    assert.ok(toolNames.includes('waguri_chat'));
    assert.ok(toolNames.includes('waguri_search_memory'));
    assert.ok(toolNames.includes('waguri_get_persona'));
    console.log('✓ 3. POST /api/mcp tools/list discovered:', toolNames.join(', '));

    // 4. Test tools/call (waguri_get_persona)
    const callRes = await fetch('http://127.0.0.1:9876/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'waguri_get_persona',
          arguments: {},
        },
      }),
    });
    assert.strictEqual(callRes.status, 200);
    const callData = await callRes.json();
    assert.strictEqual(callData.result.isError, false);
    assert.ok(callData.result.content[0].text.includes('Waguri'));
    console.log('✓ 4. POST /api/mcp tools/call (waguri_get_persona) succeeded');

    // 5. Test tools/call (waguri_chat)
    const chatCallRes = await fetch('http://127.0.0.1:9876/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'waguri_chat',
          arguments: { message: 'Hello Waguri!' },
        },
      }),
    });
    assert.strictEqual(chatCallRes.status, 200);
    const chatCallData = await chatCallRes.json();
    assert.strictEqual(chatCallData.result.isError, false);
    assert.ok(chatCallData.result.content[0].text.includes('Hello from Waguri'));
    console.log('✓ 5. POST /api/mcp tools/call (waguri_chat) succeeded');

    // 6. Test proxy
    const proxyRes = await fetch('http://127.0.0.1:9876/api/mcp/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'http://127.0.0.1:9876/api/mcp',
        body: { jsonrpc: '2.0', id: 5, method: 'ping' },
      }),
    });
    assert.strictEqual(proxyRes.status, 200);
    const proxyData = await proxyRes.json();
    assert.strictEqual(proxyData.ok, true);
    assert.deepStrictEqual(proxyData.data.result, {});
    console.log('✓ 6. POST /api/mcp/proxy successfully forwarded and returned result');

    console.log('\n🎉 ALL MCP SERVER & PROXY TESTS PASSED!\n');
    server.close();
    setTimeout(() => process.exit(0), 50);
  } catch (err) {
    console.error('❌ Test failed:', err);
    server.close();
    setTimeout(() => process.exit(1), 50);
  }
});
