import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Brain,
  Search,
  Trash2,
  Edit3,
  Check,
  X,
  RefreshCw,
  Download,
  ArrowLeft,
  Key,
  Lock,
  Sparkles,
  AlertCircle,
  Clock,
  MessageSquare,
  CheckSquare,
  Square,
  ShieldAlert,
  Save,
  CheckCircle2,
  Plus,
  Tag,
  ArrowUpDown,
  User,
  Heart,
  Coffee,
  Info,
  Calendar,
} from 'lucide-react';
import { BASE_URL } from '../api.js';

// Predefined categories for customizing memories
const MEMORY_CATEGORIES = [
  { id: 'all', label: 'All Memories', icon: Brain },
  { id: 'preference', label: 'Preferences', icon: Heart },
  { id: 'fact', label: 'Facts', icon: Info },
  { id: 'habit', label: 'Habits', icon: Coffee },
  { id: 'relationship', label: 'Relationship', icon: Sparkles },
  { id: 'conversation', label: 'Conversations', icon: MessageSquare },
];

const PRESET_IDEAS = [
  { category: 'preference', text: '[Preference] I love strawberry shortcake and iced matcha latte.' },
  { category: 'fact', text: '[Fact] My birthday is celebrated on December 18.' },
  { category: 'habit', text: '[Habit] I usually study or code late at night around 2 AM.' },
  { category: 'relationship', text: '[Relationship] Daksh loves it when Waguri calls him Daksh-kun and supports his goals.' },
  { category: 'fact', text: '[Fact] I work in software engineering and love building intelligent AI companions.' },
];

function detectCategory(text, conversationId) {
  const lower = String(text || '').toLowerCase();
  if (lower.startsWith('[preference]') || lower.includes('#preference')) return 'preference';
  if (lower.startsWith('[fact]') || lower.includes('#fact')) return 'fact';
  if (lower.startsWith('[habit]') || lower.includes('#habit')) return 'habit';
  if (lower.startsWith('[relationship]') || lower.includes('#relationship')) return 'relationship';
  if (lower.startsWith('[note]') || lower.startsWith('[custom]')) return 'custom';

  if (lower.includes('user said:') || lower.includes('replied:') || lower.includes('waguri replied:')) {
    return 'conversation';
  }
  if (lower.includes('love') || lower.includes('favorite') || lower.includes('prefer') || lower.includes('likes') || lower.includes('dislikes')) {
    return 'preference';
  }
  if (lower.includes('birthday') || lower.includes('age') || lower.includes('lives in') || lower.includes('works') || lower.includes('study')) {
    return 'fact';
  }
  if (lower.includes('sleep') || lower.includes('wake') || lower.includes('routine') || lower.includes('drink') || lower.includes('daily')) {
    return 'habit';
  }
  return 'custom';
}

export default function MemoryInspector({ onBack, currentUserId = 'local-user' }) {
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(null);
  const [q, setQ] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [sortOrder, setSortOrder] = useState('desc'); // 'desc' | 'asc'
  const [editing, setEditing] = useState(null); // { id, text }
  const [savingId, setSavingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Custom Memory Creation Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newMemoryCategory, setNewMemoryCategory] = useState('preference');
  const [newMemoryText, setNewMemoryText] = useState('');
  const [isCreatingMemory, setIsCreatingMemory] = useState(false);

  // Admin token state
  const [token, setToken] = useState(
    () => localStorage.getItem('adminToken') || localStorage.getItem('waguri_admin_token') || 'waguri-admin-secret-2026'
  );
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [tempToken, setTempToken] = useState(token);

  const getHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'x-admin-token': token.trim(),
    'x-user-id': currentUserId,
  }), [token, currentUserId]);

  const load = useCallback(async (before = null) => {
    if (!token.trim()) {
      setError('Admin token required. Click "Set Admin Token" to authorize access.');
      return;
    }

    if (before) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setError('');
    }

    try {
      const params = new URLSearchParams({ limit: '50' });
      if (q.trim()) params.set('q', q.trim());
      if (before) params.set('before', before);
      if (currentUserId) params.set('user_id', currentUserId);

      const res = await fetch(`${BASE_URL}/api/memory?${params.toString()}`, {
        headers: getHeaders(),
      });

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Not authorised: Invalid admin token. Please configure your ADMIN_TOKEN.');
        } else if (res.status === 403) {
          throw new Error('Forbidden: ADMIN_TOKEN is not configured on the backend.');
        } else {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Could not load memories (HTTP ${res.status})`);
        }
      }

      const data = await res.json();
      setError('');
      setItems((prev) => (before ? [...prev, ...data.items] : data.items));
      setNext(data.next);
    } catch (err) {
      setError(err.message || 'Could not load memories');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [token, q, currentUserId, getHeaders]);

  // Debounced search & reload when user or query changes
  useEffect(() => {
    const t = setTimeout(() => {
      load(null);
    }, 250);
    return () => clearTimeout(t);
  }, [q, token, currentUserId, load]);

  const handleSaveToken = (e) => {
    e.preventDefault();
    const clean = tempToken.trim();
    localStorage.setItem('adminToken', clean);
    localStorage.setItem('waguri_admin_token', clean);
    setToken(clean);
    setIsTokenModalOpen(false);
    setSuccessMsg('Admin token saved!');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  // Create a Custom Memory
  const handleCreateCustomMemory = async (e) => {
    e?.preventDefault();
    const raw = newMemoryText.trim();
    if (!raw) {
      setError('Memory content cannot be empty.');
      return;
    }
    if (raw.length > 2000) {
      setError('Memory content cannot exceed 2000 characters.');
      return;
    }

    setIsCreatingMemory(true);
    setError('');

    // Prepend category prefix if not already present
    let formattedText = raw;
    const catUpper = newMemoryCategory.toUpperCase();
    if (!raw.startsWith('[') && newMemoryCategory !== 'custom') {
      formattedText = `[${newMemoryCategory.charAt(0).toUpperCase() + newMemoryCategory.slice(1)}] ${raw}`;
    }

    try {
      const res = await fetch(`${BASE_URL}/api/memory`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          content_chunk: formattedText,
          user_id: currentUserId,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to create custom memory');
      }

      const created = await res.json();
      setItems((prev) => [created, ...prev]);
      setIsAddModalOpen(false);
      setNewMemoryText('');
      setSuccessMsg('Custom memory embedded into Waguri\'s brain! ✨');
      setTimeout(() => setSuccessMsg(''), 3500);
    } catch (err) {
      setError(err.message || 'Could not add custom memory');
    } finally {
      setIsCreatingMemory(false);
    }
  };

  const save = async () => {
    if (!editing || !editing.id) return;
    const clean = editing.text.trim();
    if (!clean) {
      setError('Memory text cannot be empty.');
      return;
    }
    if (clean.length > 2000) {
      setError('Memory text exceeds 2000 characters maximum.');
      return;
    }

    setSavingId(editing.id);
    setError('');
    try {
      const res = await fetch(`${BASE_URL}/api/memory/${editing.id}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ content_chunk: clean }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Could not save memory');
      }

      const updated = await res.json();
      setItems((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      setEditing(null);
      setSuccessMsg('Memory updated & re-embedded successfully! ✨');
      setTimeout(() => setSuccessMsg(''), 3500);
    } catch (err) {
      setError(err.message || 'Could not save');
    } finally {
      setSavingId(null);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this memory permanently from Waguri\'s brain?')) return;
    try {
      const res = await fetch(`${BASE_URL}/api/memory/${id}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      if (!res.ok) {
        throw new Error('Could not delete memory');
      }
      setItems((prev) => prev.filter((m) => m.id !== id));
      setSelectedIds((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(id);
        return nextSet;
      });
      setSuccessMsg('Memory permanently deleted.');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      setError(err.message || 'Could not delete');
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} selected memories permanently?`)) return;

    setBulkDeleting(true);
    setError('');
    try {
      const res = await fetch(`${BASE_URL}/api/memory/bulk-delete`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Could not bulk delete');
      }
      const data = await res.json();
      setItems((prev) => prev.filter((m) => !selectedIds.has(m.id)));
      setSelectedIds(new Set());
      setSuccessMsg(`Successfully deleted ${data.deleted} memories.`);
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      setError(err.message || 'Bulk delete failed');
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });
  };

  const toggleSelectAll = (filteredItems) => {
    if (selectedIds.size === filteredItems.length && filteredItems.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map((m) => m.id)));
    }
  };

  const handleExport = async () => {
    try {
      const url = `${BASE_URL}/api/memory/export?user_id=${encodeURIComponent(currentUserId)}`;
      const res = await fetch(url, { headers: getHeaders() });
      if (!res.ok) throw new Error('Failed to export memories');
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `waguri-memories-${currentUserId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      setSuccessMsg('Memories exported successfully! 📁');
      setTimeout(() => setSuccessMsg(''), 3500);
    } catch (err) {
      setError(err.message || 'Export failed');
    }
  };

  const handleGoBack = () => {
    if (onBack) {
      onBack();
    } else {
      window.history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  // Filter and sort items locally for fluid UI interactions
  const displayedItems = useMemo(() => {
    let filtered = items;
    if (activeCategory !== 'all') {
      filtered = filtered.filter((m) => {
        const cat = detectCategory(m.content_chunk, m.conversation_id);
        return cat === activeCategory;
      });
    }

    return [...filtered].sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sortOrder === 'desc' ? tb - ta : ta - tb;
    });
  }, [items, activeCategory, sortOrder]);

  return (
    <div className="memory-inspector-overlay">
      <main className="memory-inspector-card" role="region" aria-label="Memory Inspector">
        {/* Top Navbar Header */}
        <header className="memory-inspector-header">
          <div className="memory-inspector-header-left">
            <button
              type="button"
              className="memory-back-btn"
              onClick={handleGoBack}
              title="Return to companion view"
              aria-label="Back to Waguri companion"
            >
              <ArrowLeft size={18} />
              <span>Back</span>
            </button>
            <div className="memory-title-wrap">
              <div className="memory-brain-badge">
                <Brain size={20} />
              </div>
              <div>
                <h1 className="memory-title">Waguri's Memory Inspector</h1>
                <p className="memory-subtitle">
                  RAG pgvector memories • Account: <strong title={currentUserId} className="memory-user-badge"><User size={11} /> {currentUserId}</strong>
                </p>
              </div>
            </div>
          </div>

          <div className="memory-inspector-header-right">
            {/* Custom Memory Creation Button */}
            <button
              type="button"
              className="memory-add-custom-btn"
              onClick={() => setIsAddModalOpen(true)}
              title="Add a custom memory to Waguri's knowledge base"
            >
              <Plus size={16} />
              <span>Add Memory</span>
            </button>

            <button
              type="button"
              className={`memory-token-pill ${token ? 'configured' : 'missing'}`}
              onClick={() => {
                setTempToken(token);
                setIsTokenModalOpen(true);
              }}
              title="Configure Admin Token"
            >
              <Key size={14} />
              <span>{token ? 'Token Set' : 'Auth Required'}</span>
            </button>

            <button
              type="button"
              className="memory-action-btn"
              onClick={handleExport}
              disabled={loading || items.length === 0}
              title="Export all memories for this account as JSON"
            >
              <Download size={15} />
              <span className="hide-on-mobile">Export</span>
            </button>

            <button
              type="button"
              className="memory-action-btn refresh"
              onClick={() => load(null)}
              disabled={loading}
              title="Refresh memories list"
            >
              <RefreshCw size={15} className={loading ? 'spin-icon' : ''} />
              <span className="hide-on-mobile">Refresh</span>
            </button>
          </div>
        </header>

        {/* Category Navigation & Sort Controls */}
        <div className="memory-categories-bar">
          <div className="memory-categories-list">
            {MEMORY_CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`memory-category-chip ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  <Icon size={13} />
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="memory-sort-btn"
            onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
            title={sortOrder === 'desc' ? 'Showing newest first' : 'Showing oldest first'}
          >
            <ArrowUpDown size={13} />
            <span>{sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}</span>
          </button>
        </div>

        {/* Status / Alert Messages */}
        {error && (
          <div className="memory-alert-banner error" role="alert">
            <AlertCircle size={16} />
            <div className="memory-alert-text">
              <span>{error}</span>
              {!token && (
                <button
                  type="button"
                  className="memory-alert-action-btn"
                  onClick={() => setIsTokenModalOpen(true)}
                >
                  Enter Admin Token
                </button>
              )}
            </div>
          </div>
        )}

        {successMsg && (
          <div className="memory-alert-banner success" role="status">
            <CheckCircle2 size={16} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Search & Bulk Control Bar */}
        <div className="memory-controls-bar">
          <div className="memory-search-wrapper">
            <Search size={16} className="memory-search-icon" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search memories (e.g. coffee, bakery, favorite, birthday, job)..."
              className="memory-search-input"
              aria-label="Search memories"
            />
            {q && (
              <button
                type="button"
                className="memory-search-clear"
                onClick={() => setQ('')}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {displayedItems.length > 0 && (
            <div className="memory-bulk-controls">
              <button
                type="button"
                className="memory-select-all-btn"
                onClick={() => toggleSelectAll(displayedItems)}
                title={selectedIds.size === displayedItems.length ? 'Deselect all' : 'Select all'}
              >
                {selectedIds.size === displayedItems.length && displayedItems.length > 0 ? (
                  <CheckSquare size={16} />
                ) : (
                  <Square size={16} />
                )}
                <span>Select All</span>
              </button>

              {selectedIds.size > 0 && (
                <button
                  type="button"
                  className="memory-bulk-delete-btn"
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                >
                  <Trash2 size={14} />
                  <span>Delete Selected ({selectedIds.size})</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Memories Content List */}
        <div className="memory-list-container">
          {loading && items.length === 0 ? (
            <div className="memory-empty-state">
              <RefreshCw size={28} className="spin-icon memory-empty-icon" />
              <h3>Retrieving memory vectors...</h3>
              <p>Fetching memories strictly for account {currentUserId}</p>
            </div>
          ) : displayedItems.length === 0 && !error ? (
            <div className="memory-empty-state">
              <Brain size={36} className="memory-empty-icon" />
              <h3>No memories found</h3>
              <p>
                {q
                  ? `No memory chunks matching "${q}". Try another keyword.`
                  : activeCategory !== 'all'
                  ? `No memories under the "${activeCategory}" category. Click "+ Add Memory" to create one!`
                  : `Start chatting with Waguri or click "+ Add Memory" to add custom memories!`}
              </p>
            </div>
          ) : (
            <ul className="memory-cards-grid">
              {displayedItems.map((m) => {
                const isSelected = selectedIds.has(m.id);
                const isEditingThis = editing?.id === m.id;
                const category = detectCategory(m.content_chunk, m.conversation_id);
                const formattedDate = new Date(m.created_at).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <li
                    key={m.id}
                    className={`memory-item-card ${isSelected ? 'selected' : ''} ${isEditingThis ? 'editing' : ''}`}
                  >
                    {/* Card Top Meta */}
                    <div className="memory-item-meta">
                      <div className="memory-item-meta-left">
                        <button
                          type="button"
                          className="memory-checkbox-btn"
                          onClick={() => toggleSelect(m.id)}
                          aria-label={`Select memory ${m.id}`}
                        >
                          {isSelected ? (
                            <CheckSquare size={16} className="checked" />
                          ) : (
                            <Square size={16} />
                          )}
                        </button>

                        <span className={`memory-category-badge ${category}`}>
                          <Tag size={10} />
                          {category}
                        </span>

                        <span className="memory-date-tag">
                          <Clock size={12} />
                          {formattedDate}
                        </span>

                        {m.conversation_id && (
                          <span className="memory-conv-tag hide-on-mobile" title={`Conversation ID: ${m.conversation_id}`}>
                            <MessageSquare size={11} />
                            {m.conversation_id.slice(0, 8)}…
                          </span>
                        )}
                      </div>

                      <div className="memory-item-actions">
                        {!isEditingThis && (
                          <>
                            <button
                              type="button"
                              className="memory-card-action-btn edit"
                              onClick={() => setEditing({ id: m.id, text: m.content_chunk })}
                              title="Edit and re-embed memory"
                            >
                              <Edit3 size={14} />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              className="memory-card-action-btn delete"
                              onClick={() => remove(m.id)}
                              title="Permanently delete memory"
                            >
                              <Trash2 size={14} />
                              <span>Delete</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className="memory-item-body">
                      {isEditingThis ? (
                        <div className="memory-edit-box">
                          <textarea
                            value={editing.text}
                            maxLength={2000}
                            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                            className="memory-edit-textarea"
                            rows={4}
                            autoFocus
                            placeholder="Enter memory content (max 2000 characters)..."
                          />
                          <div className="memory-edit-footer">
                            <span
                              className={`memory-char-count ${
                                (editing.text?.length || 0) > 1800 ? 'near-limit' : ''
                              }`}
                            >
                              {editing.text?.length || 0} / 2000 characters
                            </span>
                            <div className="memory-edit-buttons">
                              <button
                                type="button"
                                className="memory-btn cancel"
                                onClick={() => setEditing(null)}
                                disabled={savingId === m.id}
                              >
                                <X size={14} />
                                <span>Cancel</span>
                              </button>
                              <button
                                type="button"
                                className="memory-btn save"
                                onClick={save}
                                disabled={savingId === m.id || !editing.text.trim()}
                              >
                                {savingId === m.id ? (
                                  <RefreshCw size={14} className="spin-icon" />
                                ) : (
                                  <Save size={14} />
                                )}
                                <span>{savingId === m.id ? 'Re-embedding…' : 'Save & Re-embed'}</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="memory-content-text">{m.content_chunk}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Load More Button */}
          {next && (
            <div className="memory-load-more-wrap">
              <button
                type="button"
                className="memory-load-more-btn"
                onClick={() => load(next)}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <>
                    <RefreshCw size={14} className="spin-icon" />
                    <span>Loading more memories...</span>
                  </>
                ) : (
                  <span>Load More Memories</span>
                )}
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Custom Memory Creation Modal */}
      {isAddModalOpen && (
        <div className="custom-memory-modal-overlay" onClick={() => setIsAddModalOpen(false)}>
          <div className="custom-memory-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="custom-memory-modal-header">
              <div className="custom-memory-modal-title">
                <Sparkles size={18} color="#c084fc" />
                <span>Add Custom Memory</span>
              </div>
              <button
                type="button"
                className="memory-token-close"
                onClick={() => setIsAddModalOpen(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ margin: 0, fontSize: '0.84rem', color: '#94a3b8', lineHeight: 1.5 }}>
              Teach Waguri personal facts, habits, or preferences. These are vector-embedded and retrieved organically whenever you chat with her!
            </p>

            {/* Category Select Pills */}
            <div className="custom-memory-category-grid">
              {[
                { id: 'preference', label: 'Preference', icon: Heart },
                { id: 'fact', label: 'Fact', icon: Info },
                { id: 'habit', label: 'Habit', icon: Coffee },
                { id: 'relationship', label: 'Relationship', icon: Sparkles },
                { id: 'custom', label: 'Custom Note', icon: Tag },
              ].map((c) => {
                const Icon = c.icon;
                const isSelected = newMemoryCategory === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`custom-category-select-pill ${isSelected ? 'active' : ''}`}
                    onClick={() => setNewMemoryCategory(c.id)}
                  >
                    <Icon size={14} />
                    <span>{c.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Quick Inspiration Presets */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '0.74rem', color: '#94a3b8', fontWeight: 600 }}>Quick Ideas:</span>
              <div className="custom-memory-preset-chips">
                {PRESET_IDEAS.filter((p) => p.category === newMemoryCategory || newMemoryCategory === 'custom').slice(0, 3).map((idea, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="custom-preset-btn"
                    onClick={() => setNewMemoryText(idea.text.replace(/^\[.*?\]\s*/, ''))}
                  >
                    + {idea.text.slice(0, 42)}…
                  </button>
                ))}
              </div>
            </div>

            {/* Input Textarea */}
            <textarea
              value={newMemoryText}
              onChange={(e) => setNewMemoryText(e.target.value)}
              placeholder="e.g. I prefer cold brew with vanilla cream, and my birthday is on October 15..."
              className="custom-memory-textarea"
              rows={4}
              maxLength={2000}
              autoFocus
            />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
                {newMemoryText.length} / 2000 characters
              </span>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="memory-btn cancel"
                  onClick={() => setIsAddModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="memory-btn save"
                  onClick={handleCreateCustomMemory}
                  disabled={isCreatingMemory || !newMemoryText.trim()}
                >
                  {isCreatingMemory ? (
                    <>
                      <RefreshCw size={14} className="spin-icon" />
                      <span>Embedding…</span>
                    </>
                  ) : (
                    <>
                      <Save size={14} />
                      <span>Save & Embed</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin Token Modal */}
      {isTokenModalOpen && (
        <div className="memory-token-modal-overlay" onClick={() => setIsTokenModalOpen(false)}>
          <div className="memory-token-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="memory-token-modal-header">
              <div className="memory-token-modal-title">
                <Lock size={18} />
                <span>Admin Authorization Token</span>
              </div>
              <button
                type="button"
                className="memory-token-close"
                onClick={() => setIsTokenModalOpen(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <p className="memory-token-desc">
              Memories are sensitive personal data. Please provide your backend's <code>ADMIN_TOKEN</code> to access this inspector.
            </p>

            <form onSubmit={handleSaveToken} className="memory-token-form">
              <div className="memory-token-input-wrap">
                <Key size={16} className="memory-token-input-icon" />
                <input
                  type="password"
                  value={tempToken}
                  onChange={(e) => setTempToken(e.target.value)}
                  placeholder="Enter ADMIN_TOKEN from .env..."
                  className="memory-token-input"
                  autoFocus
                />
              </div>

              <div className="memory-token-actions">
                <button
                  type="button"
                  className="memory-btn cancel"
                  onClick={() => setIsTokenModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="memory-btn save"
                  disabled={!tempToken.trim()}
                >
                  Save Token
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
