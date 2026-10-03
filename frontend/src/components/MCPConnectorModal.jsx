import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Network,
  PlugZap,
  Plus,
  Play,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Copy,
  ExternalLink,
  Trash2,
  Search,
  Code2,
  Terminal,
  Activity,
  Layers,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Shield,
  Send,
} from 'lucide-react';
import {
  getSavedServers,
  saveServers,
  pingMcpServer,
  fetchMcpTools,
  callMcpTool,
  generateConfigSnippet,
  DEFAULT_PRESET_SERVERS,
} from '../lib/mcpClient.js';
import { BASE_URL } from '../api.js';

export default function MCPConnectorModal({ isOpen, onClose, onToolsUpdated }) {
  const [activeTab, setActiveTab] = useState('servers'); // 'servers' | 'tools' | 'export'
  const [servers, setServers] = useState([]);
  const [serverTools, setServerTools] = useState({}); // { [serverId]: Tool[] }
  const [serverStatus, setServerStatus] = useState({}); // { [serverId]: { online, latency, checking, error } }

  // New server form state
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newAuth, setNewAuth] = useState('');
  const [newType, setNewType] = useState('custom'); // 'native' | 'supabase' | 'custom'
  const [isAdding, setIsAdding] = useState(false);
  const [addFeedback, setAddFeedback] = useState(null); // { type: 'success' | 'error', message }

  // Tool explorer state
  const [toolSearch, setToolSearch] = useState('');
  const [selectedTool, setSelectedTool] = useState(null);
  const [toolArgs, setToolArgs] = useState({});
  const [toolExecuting, setToolExecuting] = useState(false);
  const [toolResult, setToolResult] = useState(null);

  // Copy state
  const [copiedKey, setCopiedKey] = useState(null);

  // Load saved servers on mount/open
  useEffect(() => {
    if (isOpen) {
      const loaded = getSavedServers();
      setServers(loaded);
      // Automatically ping and load tools for active servers
      loaded.forEach((server) => {
        if (server.enabled) {
          refreshServer(server);
        }
      });
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Ping server and fetch tools
  const refreshServer = async (server) => {
    setServerStatus((prev) => ({
      ...prev,
      [server.id]: { ...(prev[server.id] || {}), checking: true, error: null },
    }));

    try {
      const pingRes = await pingMcpServer(server);
      if (pingRes.success) {
        const toolsRes = await fetchMcpTools(server);
        const tools = toolsRes.tools || [];

        setServerTools((prev) => ({
          ...prev,
          [server.id]: tools,
        }));

        setServerStatus((prev) => ({
          ...prev,
          [server.id]: {
            online: true,
            checking: false,
            latency: pingRes.latencyMs,
            serverInfo: pingRes.serverInfo,
            error: null,
          },
        }));

        // Update stored server tools count
        setServers((prevList) => {
          const updated = prevList.map((s) =>
            s.id === server.id ? { ...s, toolsCount: tools.length, lastPing: Date.now() } : s
          );
          saveServers(updated);
          return updated;
        });

        if (onToolsUpdated) {
          onToolsUpdated();
        }
      } else {
        setServerStatus((prev) => ({
          ...prev,
          [server.id]: {
            online: false,
            checking: false,
            latency: pingRes.latencyMs,
            error: pingRes.error || 'Connection failed',
          },
        }));
      }
    } catch (err) {
      setServerStatus((prev) => ({
        ...prev,
        [server.id]: {
          online: false,
          checking: false,
          error: err.message,
        },
      }));
    }
  };

  // Toggle server active/inactive
  const handleToggleServer = (serverId) => {
    setServers((prevList) => {
      const updated = prevList.map((s) => (s.id === serverId ? { ...s, enabled: !s.enabled } : s));
      saveServers(updated);
      const target = updated.find((s) => s.id === serverId);
      if (target?.enabled) {
        refreshServer(target);
      }
      return updated;
    });
  };

  // Delete server
  const handleDeleteServer = (serverId) => {
    if (serverId === 'waguri-native') {
      alert('The Waguri Native MCP server cannot be removed.');
      return;
    }
    const confirmed = window.confirm('Are you sure you want to disconnect this MCP server?');
    if (!confirmed) return;

    setServers((prevList) => {
      const updated = prevList.filter((s) => s.id !== serverId);
      saveServers(updated);
      return updated;
    });

    setServerTools((prev) => {
      const next = { ...prev };
      delete next[serverId];
      return next;
    });

    setServerStatus((prev) => {
      const next = { ...prev };
      delete next[serverId];
      return next;
    });
  };

  // Quick preset selector
  const handleSelectPreset = (type) => {
    setNewType(type);
    if (type === 'supabase') {
      setNewName('Supabase Database MCP');
      setNewUrl('https://mcp.supabase.com/mcp?project_ref=enyzrcbnlfhsndfrefbv');
      setNewAuth('');
    } else if (type === 'native') {
      setNewName('Waguri AI Core (Native)');
      setNewUrl(`${BASE_URL || ''}/api/mcp`);
      setNewAuth('');
    } else {
      setNewName('');
      setNewUrl('');
      setNewAuth('');
    }
  };

  // Add / Connect new server
  const handleAddServer = async (e) => {
    e.preventDefault();
    if (!newName.trim() || !newUrl.trim()) {
      setAddFeedback({ type: 'error', message: 'Server Name and URL are required.' });
      return;
    }

    const cleanUrl = newUrl.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://') && !cleanUrl.startsWith('/')) {
      setAddFeedback({ type: 'error', message: 'URL must start with http://, https://, or /' });
      return;
    }

    setIsAdding(true);
    setAddFeedback(null);

    const tempServer = {
      id: `mcp-${Date.now()}`,
      name: newName.trim(),
      url: cleanUrl,
      authHeader: newAuth.trim(),
      type: newType,
      enabled: true,
      description: `${newType === 'supabase' ? 'Supabase cloud' : 'External'} MCP tool server`,
      toolsCount: 0,
      lastPing: Date.now(),
    };

    try {
      // Test handshake first
      const pingRes = await pingMcpServer(tempServer);
      if (!pingRes.success) {
        throw new Error(pingRes.error || 'Server did not respond to MCP initialize handshake.');
      }

      // Discover tools
      const toolsRes = await fetchMcpTools(tempServer);
      const tools = toolsRes.tools || [];
      tempServer.toolsCount = tools.length;

      const updatedServers = [...servers, tempServer];
      setServers(updatedServers);
      saveServers(updatedServers);

      setServerTools((prev) => ({
        ...prev,
        [tempServer.id]: tools,
      }));

      setServerStatus((prev) => ({
        ...prev,
        [tempServer.id]: {
          online: true,
          checking: false,
          latency: pingRes.latencyMs,
          serverInfo: pingRes.serverInfo,
        },
      }));

      setAddFeedback({
        type: 'success',
        message: `Connected successfully! Discovered ${tools.length} active MCP tools.`,
      });

      // Clear form
      setNewName('');
      setNewUrl('');
      setNewAuth('');
    } catch (err) {
      setAddFeedback({
        type: 'error',
        message: `Connection failed: ${err.message}`,
      });
    } finally {
      setIsAdding(false);
    }
  };

  // Flat list of all tools from active servers
  const allDiscoveredTools = useMemo(() => {
    const list = [];
    servers.forEach((server) => {
      if (server.enabled && serverTools[server.id]) {
        serverTools[server.id].forEach((tool) => {
          list.push({
            ...tool,
            serverId: server.id,
            serverName: server.name,
          });
        });
      }
    });
    return list;
  }, [servers, serverTools]);

  const filteredTools = useMemo(() => {
    if (!toolSearch.trim()) return allDiscoveredTools;
    const q = toolSearch.toLowerCase();
    return allDiscoveredTools.filter(
      (t) =>
        t.name?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.serverName?.toLowerCase().includes(q)
    );
  }, [allDiscoveredTools, toolSearch]);

  // Execute selected tool
  const handleExecuteTool = async () => {
    if (!selectedTool) return;
    setToolExecuting(true);
    setToolResult(null);

    const targetServer = servers.find((s) => s.id === selectedTool.serverId);
    if (!targetServer) {
      setToolResult({ success: false, output: 'Server not found or disabled.' });
      setToolExecuting(false);
      return;
    }

    try {
      const res = await callMcpTool(targetServer, selectedTool.name, toolArgs);
      setToolResult(res);
    } catch (err) {
      setToolResult({ success: false, output: err.message });
    } finally {
      setToolExecuting(false);
    }
  };

  const handleCopy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (!isOpen) return null;

  const currentHost = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  const nativeMcpUrl = `${currentHost}/api/mcp`;

  return (
    <div className="mcp-modal-backdrop" onClick={onClose}>
      <div className="mcp-modal" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="mcp-modal-header">
          <div className="mcp-header-title-row">
            <div className="mcp-header-icon-badge">
              <PlugZap size={22} className="mcp-plug-icon" />
            </div>
            <div>
              <h2 className="mcp-modal-title">Model Context Protocol (MCP) Link</h2>
              <p className="mcp-modal-subtitle">
                Connect external MCP servers to Waguri or use Waguri's live MCP link in your webapps & AI agents.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="mcp-close-btn"
            onClick={onClose}
            aria-label="Close MCP Connector"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="mcp-tabs">
          <button
            type="button"
            className={`mcp-tab-btn ${activeTab === 'servers' ? 'active' : ''}`}
            onClick={() => setActiveTab('servers')}
          >
            <Network size={16} />
            <span>Connected Servers ({servers.filter((s) => s.enabled).length})</span>
          </button>
          <button
            type="button"
            className={`mcp-tab-btn ${activeTab === 'tools' ? 'active' : ''}`}
            onClick={() => setActiveTab('tools')}
          >
            <Layers size={16} />
            <span>Tools Explorer ({allDiscoveredTools.length})</span>
          </button>
          <button
            type="button"
            className={`mcp-tab-btn ${activeTab === 'export' ? 'active' : ''}`}
            onClick={() => setActiveTab('export')}
          >
            <ExternalLink size={16} />
            <span>Waguri MCP Link</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="mcp-modal-body">
          {/* TAB 1: CONNECTED SERVERS & ADD SERVER */}
          {activeTab === 'servers' && (
            <div className="mcp-tab-content">
              {/* Presets Quickbar */}
              <div className="mcp-presets-bar">
                <span className="mcp-presets-label">Quick Connect Template:</span>
                <button
                  type="button"
                  className={`mcp-preset-chip ${newType === 'native' ? 'active' : ''}`}
                  onClick={() => handleSelectPreset('native')}
                >
                  <Sparkles size={14} />
                  <span>Waguri Native Core</span>
                </button>
                <button
                  type="button"
                  className={`mcp-preset-chip ${newType === 'supabase' ? 'active' : ''}`}
                  onClick={() => handleSelectPreset('supabase')}
                >
                  <Shield size={14} />
                  <span>Supabase Project MCP</span>
                </button>
                <button
                  type="button"
                  className={`mcp-preset-chip ${newType === 'custom' ? 'active' : ''}`}
                  onClick={() => handleSelectPreset('custom')}
                >
                  <Plus size={14} />
                  <span>Custom HTTP/SSE Server</span>
                </button>
              </div>

              {/* Add Server Card */}
              <form className="mcp-add-card" onSubmit={handleAddServer}>
                <div className="mcp-add-card-header">
                  <h4 className="mcp-card-title">Add & Link New MCP Server</h4>
                </div>

                <div className="mcp-form-row">
                  <div className="mcp-input-group flex-1">
                    <label className="mcp-label">Server Name</label>
                    <input
                      type="text"
                      className="mcp-input"
                      placeholder="e.g. Production Database or Custom Agent"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                  </div>
                  <div className="mcp-input-group flex-2">
                    <label className="mcp-label">MCP Server URL / Endpoint</label>
                    <input
                      type="text"
                      className="mcp-input font-mono"
                      placeholder="https://mcp.example.com/mcp or /api/mcp"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                    />
                  </div>
                </div>

                <div className="mcp-form-row">
                  <div className="mcp-input-group flex-1">
                    <label className="mcp-label">
                      Authorization Token <span className="mcp-muted">(Optional for protected servers)</span>
                    </label>
                    <input
                      type="password"
                      className="mcp-input font-mono"
                      placeholder="Bearer token or API key"
                      value={newAuth}
                      onChange={(e) => setNewAuth(e.target.value)}
                    />
                  </div>
                  <div className="mcp-add-action-wrapper">
                    <button
                      type="submit"
                      className="mcp-primary-btn"
                      disabled={isAdding || !newName || !newUrl}
                    >
                      {isAdding ? (
                        <>
                          <RefreshCw size={16} className="spin" />
                          <span>Connecting & Handshaking...</span>
                        </>
                      ) : (
                        <>
                          <PlugZap size={16} />
                          <span>Connect & Discover Tools</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {addFeedback && (
                  <div className={`mcp-feedback-banner ${addFeedback.type}`}>
                    {addFeedback.type === 'success' ? (
                      <CheckCircle2 size={16} />
                    ) : (
                      <AlertCircle size={16} />
                    )}
                    <span>{addFeedback.message}</span>
                  </div>
                )}
              </form>

              {/* List of Connected Servers */}
              <div className="mcp-servers-list-section">
                <div className="mcp-list-header">
                  <h4 className="mcp-card-title">Configured MCP Servers ({servers.length})</h4>
                  <button
                    type="button"
                    className="mcp-refresh-all-btn"
                    onClick={() => servers.forEach((s) => s.enabled && refreshServer(s))}
                    title="Ping and refresh all servers"
                  >
                    <RefreshCw size={14} />
                    <span>Ping All</span>
                  </button>
                </div>

                <div className="mcp-servers-grid">
                  {servers.map((server) => {
                    const status = serverStatus[server.id] || {};
                    const isOnline = status.online;
                    const isChecking = status.checking;
                    const toolsCount = serverTools[server.id]?.length ?? server.toolsCount ?? 0;

                    return (
                      <div
                        key={server.id}
                        className={`mcp-server-card ${server.enabled ? 'enabled' : 'disabled'}`}
                      >
                        <div className="mcp-card-top-row">
                          <div className="mcp-server-meta">
                            <div className="mcp-server-name-row">
                              <span className="mcp-server-name">{server.name}</span>
                              <span className={`mcp-server-badge ${server.type}`}>
                                {server.type}
                              </span>
                            </div>
                            <span className="mcp-server-url" title={server.url}>
                              {server.url}
                            </span>
                          </div>

                          <div className="mcp-server-actions">
                            <label className="mcp-switch-label" title="Enable or disable server">
                              <input
                                type="checkbox"
                                checked={server.enabled}
                                onChange={() => handleToggleServer(server.id)}
                              />
                              <span className="mcp-switch-slider" />
                            </label>
                            {server.id !== 'waguri-native' && (
                              <button
                                type="button"
                                className="mcp-icon-action-btn delete"
                                onClick={() => handleDeleteServer(server.id)}
                                title="Disconnect server"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="mcp-card-bottom-row">
                          <div className="mcp-status-pill">
                            {isChecking ? (
                              <>
                                <RefreshCw size={13} className="spin text-cyan" />
                                <span>Pinging...</span>
                              </>
                            ) : isOnline ? (
                              <>
                                <span className="mcp-status-dot online" />
                                <span className="text-emerald">Online ({status.latency}ms)</span>
                              </>
                            ) : status.error ? (
                              <>
                                <span className="mcp-status-dot offline" />
                                <span className="text-rose" title={status.error}>
                                  Offline
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="mcp-status-dot neutral" />
                                <span>Unverified</span>
                              </>
                            )}
                          </div>

                          <div className="mcp-card-tools-info">
                            <span className="mcp-tools-pill">
                              <Layers size={13} />
                              <span>{toolsCount} {toolsCount === 1 ? 'tool' : 'tools'}</span>
                            </span>
                            <button
                              type="button"
                              className="mcp-reping-btn"
                              onClick={() => refreshServer(server)}
                              disabled={isChecking}
                              title="Re-check server status"
                            >
                              <RefreshCw size={12} className={isChecking ? 'spin' : ''} />
                            </button>
                          </div>
                        </div>

                        {status.error && (
                          <div className="mcp-card-error-text" title={status.error}>
                            ⚠️ {status.error}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ACTIVE TOOLS EXPLORER */}
          {activeTab === 'tools' && (
            <div className="mcp-tab-content">
              {/* Search & Stats Bar */}
              <div className="mcp-tools-search-bar">
                <div className="mcp-search-input-wrapper">
                  <Search size={16} className="mcp-search-icon" />
                  <input
                    type="text"
                    className="mcp-search-input"
                    placeholder="Search discovered MCP tools by name, description, or server..."
                    value={toolSearch}
                    onChange={(e) => setToolSearch(e.target.value)}
                  />
                  {toolSearch && (
                    <button
                      type="button"
                      className="mcp-search-clear"
                      onClick={() => setToolSearch('')}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="mcp-tools-stat-badge">
                  {filteredTools.length} {filteredTools.length === 1 ? 'Tool Available' : 'Tools Available'}
                </div>
              </div>

              {/* Main Tools View (Split list & interactive tester) */}
              <div className="mcp-tools-split-layout">
                {/* Tools List */}
                <div className="mcp-tools-list-pane">
                  {filteredTools.length === 0 ? (
                    <div className="mcp-empty-tools">
                      <Layers size={36} className="mcp-empty-icon" />
                      <p className="mcp-empty-title">No tools found</p>
                      <p className="mcp-empty-sub">
                        {allDiscoveredTools.length === 0
                          ? 'Make sure at least one configured MCP server is online and enabled.'
                          : 'Try changing your search keywords.'}
                      </p>
                    </div>
                  ) : (
                    filteredTools.map((tool) => {
                      const isSelected = selectedTool?.name === tool.name && selectedTool?.serverId === tool.serverId;
                      const propCount = Object.keys(tool.inputSchema?.properties || {}).length;

                      return (
                        <div
                          key={`${tool.serverId}-${tool.name}`}
                          className={`mcp-tool-item ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedTool(tool);
                            setToolArgs({});
                            setToolResult(null);
                          }}
                        >
                          <div className="mcp-tool-item-header">
                            <div className="mcp-tool-title-row">
                              <Code2 size={16} className="mcp-tool-icon" />
                              <span className="mcp-tool-name">{tool.name}</span>
                            </div>
                            <span className="mcp-tool-server-badge">{tool.serverName}</span>
                          </div>

                          <p className="mcp-tool-description">
                            {tool.description || 'No description provided.'}
                          </p>

                          <div className="mcp-tool-props-meta">
                            <span className="mcp-prop-count">
                              {propCount} {propCount === 1 ? 'parameter' : 'parameters'}
                            </span>
                            <span className="mcp-select-prompt">
                              Test Tool <ChevronRight size={14} />
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Tool Runner / Tester Pane */}
                <div className="mcp-tool-runner-pane">
                  {selectedTool ? (
                    <div className="mcp-runner-card">
                      <div className="mcp-runner-header">
                        <div>
                          <span className="mcp-runner-server-tag">
                            Server: {selectedTool.serverName}
                          </span>
                          <h3 className="mcp-runner-tool-name">{selectedTool.name}</h3>
                          <p className="mcp-runner-description">{selectedTool.description}</p>
                        </div>
                      </div>

                      {/* Arguments Form */}
                      <div className="mcp-runner-arguments-section">
                        <h5 className="mcp-section-mini-title">Input Parameters</h5>

                        {Object.keys(selectedTool.inputSchema?.properties || {}).length === 0 ? (
                          <div className="mcp-no-args-notice">
                            This tool requires no parameters. Click <strong>Execute Tool</strong> to run.
                          </div>
                        ) : (
                          <div className="mcp-args-form">
                            {Object.entries(selectedTool.inputSchema?.properties || {}).map(
                              ([propName, propDef]) => {
                                const isRequired = selectedTool.inputSchema?.required?.includes(propName);
                                return (
                                  <div key={propName} className="mcp-arg-field">
                                    <div className="mcp-arg-header">
                                      <span className="mcp-arg-name font-mono">{propName}</span>
                                      <span className="mcp-arg-type font-mono">{propDef.type || 'string'}</span>
                                      {isRequired && <span className="mcp-required-badge">required</span>}
                                    </div>
                                    {propDef.description && (
                                      <p className="mcp-arg-desc">{propDef.description}</p>
                                    )}

                                    {propDef.enum ? (
                                      <select
                                        className="mcp-input mcp-select font-mono"
                                        value={toolArgs[propName] || ''}
                                        onChange={(e) =>
                                          setToolArgs((prev) => ({ ...prev, [propName]: e.target.value }))
                                        }
                                      >
                                        <option value="">Select an option...</option>
                                        {propDef.enum.map((opt) => (
                                          <option key={opt} value={opt}>
                                            {opt}
                                          </option>
                                        ))}
                                      </select>
                                    ) : propDef.type === 'number' || propDef.type === 'integer' ? (
                                      <input
                                        type="number"
                                        className="mcp-input font-mono"
                                        placeholder={`Enter ${propName}...`}
                                        value={toolArgs[propName] ?? ''}
                                        onChange={(e) =>
                                          setToolArgs((prev) => ({
                                            ...prev,
                                            [propName]: parseFloat(e.target.value) || 0,
                                          }))
                                        }
                                      />
                                    ) : (
                                      <input
                                        type="text"
                                        className="mcp-input font-mono"
                                        placeholder={`Enter ${propName}...`}
                                        value={toolArgs[propName] || ''}
                                        onChange={(e) =>
                                          setToolArgs((prev) => ({ ...prev, [propName]: e.target.value }))
                                        }
                                      />
                                    )}
                                  </div>
                                );
                              }
                            )}
                          </div>
                        )}
                      </div>

                      {/* Run Action */}
                      <div className="mcp-runner-actions">
                        <button
                          type="button"
                          className="mcp-primary-btn w-full"
                          onClick={handleExecuteTool}
                          disabled={toolExecuting}
                        >
                          {toolExecuting ? (
                            <>
                              <RefreshCw size={16} className="spin" />
                              <span>Executing Tool via MCP...</span>
                            </>
                          ) : (
                            <>
                              <Play size={16} />
                              <span>Execute Tool</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Results Box */}
                      {toolResult && (
                        <div
                          className={`mcp-runner-result-box ${toolResult.success ? 'success' : 'error'}`}
                        >
                          <div className="mcp-result-box-header">
                            <span className="mcp-result-status-title">
                              {toolResult.success ? (
                                <>
                                  <CheckCircle2 size={15} />
                                  <span>Output Result</span>
                                </>
                              ) : (
                                <>
                                  <AlertCircle size={15} />
                                  <span>Execution Error</span>
                                </>
                              )}
                            </span>
                            <button
                              type="button"
                              className="mcp-copy-btn"
                              onClick={() => handleCopy(toolResult.output, 'result')}
                              title="Copy output"
                            >
                              <Copy size={13} />
                              <span>{copiedKey === 'result' ? 'Copied!' : 'Copy Output'}</span>
                            </button>
                          </div>
                          <pre className="mcp-output-code">{toolResult.output}</pre>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mcp-no-tool-selected">
                      <Terminal size={40} className="mcp-terminal-icon" />
                      <p className="mcp-select-help-title">Select a tool to test</p>
                      <p className="mcp-select-help-sub">
                        Click on any discovered tool from the left pane to view its arguments and run interactive calls directly from the webapp.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: WAGURI MCP LINK & EXTERNAL APP INTEGRATION */}
          {activeTab === 'export' && (
            <div className="mcp-tab-content">
              <div className="mcp-export-hero">
                <div className="mcp-export-badge">Live HTTP / SSE Endpoint</div>
                <h3 className="mcp-export-title">Waguri Model Context Protocol Endpoint</h3>
                <p className="mcp-export-sub">
                  Connect your Waguri Persona-Twin to external AI clients, Claude Desktop, Cursor, LibreChat, or custom web applications with this single link.
                </p>

                {/* Live URL Card */}
                <div className="mcp-link-display-box">
                  <div className="mcp-link-label-row">
                    <span className="mcp-link-tag">Live MCP Link</span>
                    <button
                      type="button"
                      className="mcp-link-copy-btn"
                      onClick={() => handleCopy(nativeMcpUrl, 'native-url')}
                    >
                      <Copy size={14} />
                      <span>{copiedKey === 'native-url' ? 'Copied Link!' : 'Copy MCP Link'}</span>
                    </button>
                  </div>
                  <div className="mcp-link-url-text font-mono">{nativeMcpUrl}</div>
                </div>
              </div>

              {/* Ready-made Config Snippets */}
              <div className="mcp-snippets-section">
                <h4 className="mcp-card-title">Connect with External AI Assistants</h4>

                {/* 1. Cursor IDE Config */}
                <div className="mcp-snippet-card">
                  <div className="mcp-snippet-header">
                    <div className="mcp-snippet-title-row">
                      <span className="mcp-app-tag">Cursor IDE</span>
                      <span className="mcp-file-hint">Settings &gt; Cursor Settings &gt; Tools & MCP</span>
                    </div>
                    <button
                      type="button"
                      className="mcp-copy-snippet-btn"
                      onClick={() =>
                        handleCopy(
                          generateConfigSnippet({ url: nativeMcpUrl, name: 'waguri' }, 'cursor'),
                          'cursor-config'
                        )
                      }
                    >
                      <Copy size={13} />
                      <span>{copiedKey === 'cursor-config' ? 'Copied!' : 'Copy JSON'}</span>
                    </button>
                  </div>
                  <pre className="mcp-snippet-code">
                    {generateConfigSnippet({ url: nativeMcpUrl, name: 'waguri' }, 'cursor')}
                  </pre>
                </div>

                {/* 2. Claude Desktop Config */}
                <div className="mcp-snippet-card">
                  <div className="mcp-snippet-header">
                    <div className="mcp-snippet-title-row">
                      <span className="mcp-app-tag">Claude Desktop</span>
                      <span className="mcp-file-hint">claude_desktop_config.json</span>
                    </div>
                    <button
                      type="button"
                      className="mcp-copy-snippet-btn"
                      onClick={() =>
                        handleCopy(
                          generateConfigSnippet({ url: nativeMcpUrl, name: 'waguri' }, 'claude-desktop'),
                          'claude-config'
                        )
                      }
                    >
                      <Copy size={13} />
                      <span>{copiedKey === 'claude-config' ? 'Copied!' : 'Copy JSON'}</span>
                    </button>
                  </div>
                  <pre className="mcp-snippet-code">
                    {generateConfigSnippet({ url: nativeMcpUrl, name: 'waguri' }, 'claude-desktop')}
                  </pre>
                </div>

                {/* 3. Claude Code CLI */}
                <div className="mcp-snippet-card">
                  <div className="mcp-snippet-header">
                    <div className="mcp-snippet-title-row">
                      <span className="mcp-app-tag">Claude Code (Terminal)</span>
                      <span className="mcp-file-hint">One-line terminal command</span>
                    </div>
                    <button
                      type="button"
                      className="mcp-copy-snippet-btn"
                      onClick={() =>
                        handleCopy(
                          generateConfigSnippet({ url: nativeMcpUrl, name: 'waguri' }, 'claude-code'),
                          'cli-cmd'
                        )
                      }
                    >
                      <Copy size={13} />
                      <span>{copiedKey === 'cli-cmd' ? 'Copied!' : 'Copy Command'}</span>
                    </button>
                  </div>
                  <pre className="mcp-snippet-code">
                    {generateConfigSnippet({ url: nativeMcpUrl, name: 'waguri' }, 'claude-code')}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
