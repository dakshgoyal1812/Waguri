import express from 'express';

/**
 * Creates the MCP (Model Context Protocol) router for Waguri.
 * Provides:
 * 1. POST /api/mcp         - Native Waguri MCP Server (JSON-RPC 2.0 / MCP spec)
 * 2. GET  /api/mcp         - Native Waguri MCP Server Info & capabilities
 * 3. POST /api/mcp/proxy   - Safe backend proxy for external MCP servers (bypasses CORS)
 * 4. GET  /api/mcp/info    - Overview of native MCP tools and endpoints
 */
export function createMcpRouter({ storage, orchestrator, games, pushScheduler }) {
  const router = express.Router();

  const NATIVE_TOOLS = [
    {
      name: 'waguri_chat',
      description: 'Chat with Waguri AI persona. Returns in-character dialogue, emotion expression, and synthesized voice audio URL.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'User message or question for Waguri' },
          conversation_id: { type: 'string', description: 'Optional conversation session ID' },
          user_id: { type: 'string', description: 'User identifier (default: local-user)' },
          avatar_id: { type: 'string', description: 'Active avatar companion ID (e.g., waguri, aria, chisato)' },
        },
        required: ['message'],
      },
    },
    {
      name: 'waguri_search_memory',
      description: 'Search Waguri\'s long-term RAG vector memory for past conversations, user facts, and shared experiences.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Semantic search query to retrieve memories' },
          limit: { type: 'number', description: 'Maximum number of memory items to return (1-20, default: 5)' },
          user_id: { type: 'string', description: 'Filter memories for a specific user' },
        },
        required: ['query'],
      },
    },
    {
      name: 'waguri_get_persona',
      description: 'Retrieve Waguri\'s current personality configuration, backstory, speech style, and active mood.',
      inputSchema: {
        type: 'object',
        properties: {
          persona_id: { type: 'string', description: 'Optional persona ID' },
        },
      },
    },
    {
      name: 'waguri_list_alarms',
      description: 'List all scheduled alarms, wake-up reminders, and recurring voice alerts.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'Optional user ID to filter alarms (default: local-user)' },
        },
      },
    },
    {
      name: 'waguri_create_alarm',
      description: 'Schedule a new alarm or voice reminder in Waguri.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Alarm or reminder title (e.g., Morning Workout, Drink Water)' },
          time: { type: 'string', description: '24-hour format time (HH:MM), e.g., "08:30"' },
          type: { type: 'string', enum: ['alarm', 'reminder'], description: 'Type of alert (alarm or reminder)' },
          user_id: { type: 'string', description: 'User identifier' },
        },
        required: ['title', 'time'],
      },
    },
    {
      name: 'waguri_play_game',
      description: 'Start or submit a move in an interactive game with Waguri (tic-tac-toe, rock-paper-scissors, or 20 questions).',
      inputSchema: {
        type: 'object',
        properties: {
          game: { type: 'string', enum: ['tictactoe', 'rps', 'twentyq'], description: 'Game to play' },
          session_id: { type: 'string', description: 'Active game session ID if continuing a game' },
          move: { type: 'string', description: 'Cell coordinate for tic-tac-toe (0-8) or choice for rps (rock, paper, scissors)' },
          choice: { type: 'string', description: 'Alternative choice field for RPS' },
        },
        required: ['game'],
      },
    },
  ];

  // Overview info
  router.get('/info', (_req, res) => {
    res.json({
      name: 'waguri-mcp-server',
      version: '1.0.0',
      description: 'Waguri AI Persona Model Context Protocol (MCP) Server',
      endpoint: '/api/mcp',
      proxy_endpoint: '/api/mcp/proxy',
      protocol_version: '2024-11-05',
      tools_count: NATIVE_TOOLS.length,
      tools: NATIVE_TOOLS,
    });
  });

  // GET /api/mcp - MCP Discovery & Server metadata
  router.get('/', (_req, res) => {
    res.json({
      jsonrpc: '2.0',
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'waguri-mcp-server',
          version: '1.0.0',
        },
        capabilities: {
          tools: { listChanged: false },
        },
      },
    });
  });

  // POST /api/mcp - Main Model Context Protocol (JSON-RPC 2.0) endpoint
  router.post('/', async (req, res) => {
    const { jsonrpc, id, method, params } = req.body || {};

    // Standard MCP handshake / initialize
    if (method === 'initialize') {
      return res.json({
        jsonrpc: '2.0',
        id: id ?? 1,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: {
            name: 'waguri-mcp-server',
            version: '1.0.0',
          },
          capabilities: {
            tools: { listChanged: false },
          },
        },
      });
    }

    // Ping / keepalive
    if (method === 'ping') {
      return res.json({
        jsonrpc: '2.0',
        id: id ?? 1,
        result: {},
      });
    }

    // Tools discovery: tools/list
    if (method === 'tools/list') {
      return res.json({
        jsonrpc: '2.0',
        id: id ?? 1,
        result: {
          tools: NATIVE_TOOLS,
        },
      });
    }

    // Tool execution: tools/call
    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};

      try {
        let contentText = '';

        switch (toolName) {
          case 'waguri_chat': {
            if (!args.message) {
              throw new Error('Argument "message" is required.');
            }
            const chatResult = await orchestrator.handle({
              conversationId: args.conversation_id,
              userId: args.user_id || 'local-user',
              message: String(args.message).trim(),
              avatarId: args.avatar_id || 'waguri',
            });
            contentText = JSON.stringify(chatResult, null, 2);
            break;
          }

          case 'waguri_search_memory': {
            if (!args.query) {
              throw new Error('Argument "query" is required.');
            }
            const memories = await storage.searchMemory({
              query: String(args.query),
              userId: args.user_id || 'local-user',
              limit: Math.min(20, Math.max(1, parseInt(args.limit, 10) || 5)),
            });
            contentText = JSON.stringify({ count: memories?.length || 0, memories }, null, 2);
            break;
          }

          case 'waguri_get_persona': {
            const persona = args.persona_id
              ? await storage.getPersona(args.persona_id)
              : await storage.getDefaultPersona();
            contentText = JSON.stringify(persona || {}, null, 2);
            break;
          }

          case 'waguri_list_alarms': {
            const alarms = await storage.listAlarms(args.user_id || 'local-user');
            contentText = JSON.stringify({ count: alarms?.length || 0, alarms }, null, 2);
            break;
          }

          case 'waguri_create_alarm': {
            if (!args.title || !args.time) {
              throw new Error('Arguments "title" and "time" are required.');
            }
            const saved = await storage.upsertAlarm({
              title: args.title,
              time: args.time,
              type: args.type || 'alarm',
              user_id: args.user_id || 'local-user',
              enabled: true,
            });
            contentText = JSON.stringify({ ok: true, alarm: saved }, null, 2);
            break;
          }

          case 'waguri_play_game': {
            if (!args.game) {
              throw new Error('Argument "game" is required.');
            }
            if (args.session_id) {
              const moveResult = await games.move({
                sessionId: args.session_id,
                move: args.move,
                choice: args.choice || args.move,
              });
              contentText = JSON.stringify(moveResult, null, 2);
            } else {
              const startResult = await games.start({ game: args.game });
              contentText = JSON.stringify(startResult, null, 2);
            }
            break;
          }

          default:
            return res.status(404).json({
              jsonrpc: '2.0',
              id: id ?? 1,
              error: {
                code: -32601,
                message: `Method or tool "${toolName}" not found.`,
              },
            });
        }

        return res.json({
          jsonrpc: '2.0',
          id: id ?? 1,
          result: {
            content: [
              {
                type: 'text',
                text: contentText,
              },
            ],
            isError: false,
          },
        });
      } catch (err) {
        return res.json({
          jsonrpc: '2.0',
          id: id ?? 1,
          result: {
            content: [
              {
                type: 'text',
                text: `Error executing tool "${toolName}": ${err.message}`,
              },
            ],
            isError: true,
          },
        });
      }
    }

    // Default unknown method
    return res.status(400).json({
      jsonrpc: '2.0',
      id: id ?? 1,
      error: {
        code: -32601,
        message: `Unsupported MCP method: "${method}"`,
      },
    });
  });

  // POST /api/mcp/proxy - Safe proxy for external MCP servers
  // Forwards requests to remote or local MCP endpoints to avoid CORS restrictions in browsers
  router.post('/proxy', async (req, res) => {
    try {
      const { url, headers = {}, body } = req.body || {};
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ ok: false, error: 'url (string) is required' });
      }

      // Security check: only allow http and https protocols
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return res.status(400).json({ ok: false, error: 'Invalid URL protocol: only http and https are allowed' });
      }

      const requestHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        ...headers,
      };

      const upstreamRes = await fetch(url, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(body || {}),
      });

      const contentType = upstreamRes.headers.get('content-type') || '';

      // If Server-Sent Events (SSE) format returned:
      if (contentType.includes('text/event-stream')) {
        const rawText = await upstreamRes.text();
        // Parse SSE data packets
        const lines = rawText.split('\n');
        let parsedData = null;
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim();
            try {
              parsedData = JSON.parse(dataStr);
              break;
            } catch {}
          }
        }
        return res.status(upstreamRes.status).json({
          ok: upstreamRes.ok,
          status: upstreamRes.status,
          data: parsedData || rawText,
        });
      }

      // Standard JSON response
      const data = await upstreamRes.json().catch(async () => {
        const txt = await upstreamRes.text().catch(() => '');
        return { text: txt };
      });

      return res.status(upstreamRes.status).json({
        ok: upstreamRes.ok,
        status: upstreamRes.status,
        data,
      });
    } catch (err) {
      console.error('[mcp-proxy] error:', err.message);
      return res.status(502).json({
        ok: false,
        error: `MCP proxy failed: ${err.message}`,
      });
    }
  });

  return router;
}

export default createMcpRouter;
