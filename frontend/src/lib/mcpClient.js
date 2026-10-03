// Model Context Protocol (MCP) Client Library for Waguri Web App.
// Supports connecting to external and native MCP servers via JSON-RPC 2.0.

import { proxyMcpRequest, BASE_URL } from '../api.js';

export const STORAGE_KEY = 'waguri_mcp_servers';

export const DEFAULT_PRESET_SERVERS = [
  {
    id: 'waguri-native',
    name: 'Waguri AI Core (Native)',
    url: `${BASE_URL || ''}/api/mcp`,
    type: 'native',
    enabled: true,
    description: 'Waguri in-character chat, persona inspection, RAG memory search, alarms, and games.',
    authHeader: '',
    status: 'unknown',
    toolsCount: 6,
    lastPing: null,
  },
  {
    id: 'supabase-cloud',
    name: 'Supabase Project MCP',
    url: 'https://mcp.supabase.com/mcp?project_ref=enyzrcbnlfhsndfrefbv',
    type: 'supabase',
    enabled: false,
    description: 'Postgres database queries, migrations, edge functions, and table inspections.',
    authHeader: '', // Optional Bearer token
    status: 'unknown',
    toolsCount: 0,
    lastPing: null,
  },
];

/**
 * Retrieve saved MCP servers from localStorage (merges with default presets).
 */
export function getSavedServers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PRESET_SERVERS;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Ensure native preset is always present if not removed
      const hasNative = parsed.some((s) => s.id === 'waguri-native');
      if (!hasNative) {
        return [DEFAULT_PRESET_SERVERS[0], ...parsed];
      }
      return parsed;
    }
  } catch (err) {
    console.warn('[mcpClient] error reading saved servers:', err);
  }
  return DEFAULT_PRESET_SERVERS;
}

/**
 * Save MCP servers list to localStorage.
 */
export function saveServers(servers) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
  } catch (err) {
    console.error('[mcpClient] error saving servers:', err);
  }
}

/**
 * Send an MCP JSON-RPC 2.0 request to an MCP server URL.
 * Automatically routes through the backend proxy (/api/mcp/proxy) for external URLs
 * to eliminate browser CORS blocks.
 */
export async function sendMcpRequest(server, method, params = {}) {
  const url = server.url.trim();
  const headers = {};
  if (server.authHeader && server.authHeader.trim()) {
    const cleanAuth = server.authHeader.trim();
    headers['Authorization'] = cleanAuth.startsWith('Bearer ') ? cleanAuth : `Bearer ${cleanAuth}`;
  }

  const payload = {
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params,
  };

  const isRelativeOrSameOrigin = url.startsWith('/') ||
    (typeof window !== 'undefined' && url.startsWith(window.location.origin));

  if (isRelativeOrSameOrigin) {
    // Direct call to local/native backend
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`MCP Server returned HTTP ${res.status}: ${errText.slice(0, 150)}`);
    }
    return res.json();
  }

  // Use backend proxy for external MCP servers
  const proxyRes = await proxyMcpRequest({
    url,
    headers,
    body: payload,
  });

  if (!proxyRes || proxyRes.ok === false) {
    throw new Error(proxyRes?.error || 'Failed to connect via MCP proxy');
  }

  return proxyRes.data;
}

/**
 * Test connectivity & perform initialize handshake with the MCP server.
 * Returns { success, latencyMs, serverInfo, error }
 */
export async function pingMcpServer(server) {
  const start = performance.now();
  try {
    const response = await sendMcpRequest(server, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'waguri-webapp',
        version: '1.0.0',
      },
    });

    const latencyMs = Math.round(performance.now() - start);
    const serverInfo = response?.result?.serverInfo || { name: 'Unknown MCP Server' };

    return {
      success: true,
      latencyMs,
      serverInfo,
      protocolVersion: response?.result?.protocolVersion || '2024-11-05',
      capabilities: response?.result?.capabilities,
    };
  } catch (err) {
    return {
      success: false,
      latencyMs: Math.round(performance.now() - start),
      error: err.message,
    };
  }
}

/**
 * Discover tools exposed by the MCP server (tools/list).
 */
export async function fetchMcpTools(server) {
  try {
    const response = await sendMcpRequest(server, 'tools/list', {});
    const tools = response?.result?.tools || [];
    return {
      success: true,
      tools,
      count: tools.length,
    };
  } catch (err) {
    return {
      success: false,
      tools: [],
      error: err.message,
    };
  }
}

/**
 * Execute an MCP tool (tools/call).
 */
export async function callMcpTool(server, toolName, args = {}) {
  try {
    const response = await sendMcpRequest(server, 'tools/call', {
      name: toolName,
      arguments: args,
    });

    if (response?.error) {
      throw new Error(response.error.message || `Tool call failed (${response.error.code})`);
    }

    const content = response?.result?.content;
    let outputText = '';
    if (Array.isArray(content)) {
      outputText = content
        .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
        .join('\n');
    } else if (typeof response?.result === 'object') {
      outputText = JSON.stringify(response.result, null, 2);
    } else {
      outputText = String(response?.result ?? 'Executed successfully.');
    }

    return {
      success: !response?.result?.isError,
      output: outputText,
      raw: response?.result,
    };
  } catch (err) {
    return {
      success: false,
      output: err.message,
      error: err.message,
    };
  }
}

/**
 * Generate configuration snippet for desktop clients (Claude Desktop, Cursor, etc.).
 */
export function generateConfigSnippet(server, clientType = 'cursor') {
  const url = server.url.startsWith('/')
    ? (typeof window !== 'undefined' ? `${window.location.origin}${server.url}` : server.url)
    : server.url;

  const serverKey = (server.name || 'custom-mcp')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .slice(0, 24);

  const headers = {};
  if (server.authHeader && server.authHeader.trim()) {
    headers['Authorization'] = server.authHeader.trim().startsWith('Bearer ')
      ? server.authHeader.trim()
      : `Bearer ${server.authHeader.trim()}`;
  }

  const serverConfig = {
    type: 'http',
    url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };

  if (clientType === 'cursor') {
    return JSON.stringify(
      {
        mcpServers: {
          [serverKey]: serverConfig,
        },
      },
      null,
      2
    );
  }

  if (clientType === 'claude-desktop') {
    return JSON.stringify(
      {
        mcpServers: {
          [serverKey]: serverConfig,
        },
      },
      null,
      2
    );
  }

  if (clientType === 'claude-code') {
    return `claude mcp add ${serverKey} -t http ${url}`;
  }

  return url;
}
