import React, { useState, useEffect, useMemo } from 'react';
import { X, ShieldAlert, UserPlus, Trash2, Mail, CheckCircle2, AlertCircle, RefreshCw, Users, ShieldCheck, Brain, Sparkles } from 'lucide-react';
import { fetchAllowedUsers, addAllowedUser, removeAllowedUser } from '../api.js';
import { ADMIN_EMAILS } from '../supabaseClient.js';
import { CURRENT_APP_VERSION } from './UpdateModal.jsx';

export default function AdminPortal({ isOpen, onClose, adminEmail, onOpenMemory, onCheckUpdate, isCheckingUpdate }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [statusMessage, setStatusMessage] = useState(null); // { type: 'success' | 'error', text: '' }

  const cleanAdminEmail = (adminEmail || '').trim().toLowerCase();
  const isAdmin = ADMIN_EMAILS.some((adm) => adm.toLowerCase() === cleanAdminEmail);

  // Load allowed users whenever modal opens (only if admin)
  const loadUsers = async () => {
    if (!isAdmin) {
      setStatusMessage({ type: 'error', text: 'Access Denied: Only primary admin accounts can view the allowed users list.' });
      return;
    }
    setLoading(true);
    setStatusMessage(null);
    try {
      const data = await fetchAllowedUsers();
      if (data?.users) {
        setUsers(data.users);
      }
    } catch (err) {
      console.error('Failed to load allowed users:', err);
      setStatusMessage({ type: 'error', text: `Failed to load users: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadUsers();
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

  const handleAddEmail = async (e) => {
    e.preventDefault();
    const clean = newEmail.trim().toLowerCase();
    if (!clean || !clean.includes('@') || !clean.includes('.')) {
      setStatusMessage({ type: 'error', text: 'Please enter a valid email address.' });
      return;
    }

    setSubmitting(true);
    setStatusMessage(null);
    try {
      const res = await addAllowedUser(clean);
      if (res?.users) {
        setUsers(res.users);
      }
      setNewEmail('');
      setStatusMessage({
        type: 'success',
        text: `Success! ${clean} can now sign in using direct Email or Google Auth with full access.`,
      });
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to add user.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveEmail = async (userToRemove) => {
    const emailStr = typeof userToRemove === 'string' ? userToRemove : userToRemove.email;
    const clean = emailStr.trim().toLowerCase();

    if (ADMIN_EMAILS.some((adm) => adm.toLowerCase() === clean)) {
      setStatusMessage({ type: 'error', text: 'Primary admin accounts cannot be removed.' });
      return;
    }

    const confirmRemove = window.confirm(
      `Are you sure you want to remove "${clean}"? They will no longer be able to access Waguri and will receive "Access Denied".`
    );
    if (!confirmRemove) return;

    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await removeAllowedUser(clean);
      if (res?.users) {
        setUsers(res.users);
      }
      setStatusMessage({
        type: 'success',
        text: `Removed ${clean}. Their access has been revoked.`,
      });
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to remove user.' });
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const email = (typeof u === 'string' ? u : u.email).toLowerCase();
      return email.includes(search.trim().toLowerCase());
    });
  }, [users, search]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card admin-portal-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="admin-portal-title"
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className="admin-portal-icon-badge">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h3 id="admin-portal-title" className="modal-title">Admin Access Portal</h3>
              <p className="admin-portal-subtitle">
                Logged in as: <strong>{cleanAdminEmail}</strong>
              </p>
            </div>
          </div>
          <button className="icon-btn modal-close-btn" onClick={onClose} aria-label="Close admin portal">
            <X size={18} />
          </button>
        </div>

        {/* Status Alerts */}
        {statusMessage && (
          <div className={`admin-status-banner ${statusMessage.type}`}>
            {statusMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Memory Inspector Quick Access */}
        {onOpenMemory && (
          <div style={{ padding: '12px 22px', background: 'rgba(167, 139, 250, 0.08)', borderBottom: '1px solid var(--border-glass)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Brain size={18} style={{ color: '#a78bfa' }} />
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>RAG Memory Inspector</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Browse, edit and manage long-term pgvector memories</div>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenMemory}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #a78bfa, #f472b6)',
                color: '#ffffff',
                border: 'none',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <span>Open /memory</span>
            </button>
          </div>
        )}

        {/* App Version & In-App Update Checker */}
        {onCheckUpdate && (
          <div style={{ padding: '10px 22px', background: 'rgba(244, 114, 182, 0.07)', borderBottom: '1px solid var(--border-glass)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Sparkles size={17} style={{ color: '#f472b6' }} />
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>App Version: v{CURRENT_APP_VERSION}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Tap to check GitHub for new APK releases</div>
              </div>
            </div>
            <button
              type="button"
              onClick={onCheckUpdate}
              disabled={isCheckingUpdate}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #ec4899, #8b5cf6)',
                color: '#ffffff',
                border: 'none',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: isCheckingUpdate ? 'wait' : 'pointer',
              }}
            >
              <RefreshCw size={13} className={isCheckingUpdate ? 'animate-spin' : ''} />
              <span>{isCheckingUpdate ? 'Checking...' : 'Check for Updates'}</span>
            </button>
          </div>
        )}

        {/* Add Email Form */}
        <div className="admin-add-section">
          <label className="admin-section-label" htmlFor="new-user-email">
            Grant Full Access (Email or Google Login)
          </label>
          <p className="admin-section-hint" style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '4px 0 10px' }}>
            Users added here can sign in via <strong>direct Email</strong> or <strong>Google Sign-In</strong> with full access to all Waguri features.
          </p>
          <form onSubmit={handleAddEmail} className="admin-add-form">
            <div className="admin-input-wrapper">
              <Mail size={16} className="admin-input-icon" />
              <input
                id="new-user-email"
                type="email"
                placeholder="Enter user's email address (e.g. friend@gmail.com)"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="admin-input"
                disabled={submitting}
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="admin-add-btn"
              disabled={submitting || !newEmail.trim()}
            >
              {submitting ? (
                <RefreshCw size={15} className="spin-icon" />
              ) : (
                <UserPlus size={15} />
              )}
              <span>{submitting ? 'Adding...' : 'Grant Access'}</span>
            </button>
          </form>
        </div>

        {/* Whitelist List Section */}
        <div className="admin-list-section">
          <div className="admin-list-header">
            <div className="admin-list-title">
              <Users size={16} />
              <span>Allowed Users ({users.length})</span>
            </div>
            <div className="admin-list-tools">
              <input
                type="text"
                placeholder="Search email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="admin-search-input"
              />
              <button
                type="button"
                className="icon-btn admin-refresh-btn"
                onClick={loadUsers}
                disabled={loading}
                title="Refresh whitelist"
              >
                <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
              </button>
            </div>
          </div>

          <div className="admin-users-scroll">
            {loading && users.length === 0 ? (
              <div className="admin-empty-state">Loading allowed users list...</div>
            ) : filteredUsers.length === 0 ? (
              <div className="admin-empty-state">
                {search ? `No accounts match "${search}"` : 'No users in allowed list.'}
              </div>
            ) : (
              <ul className="admin-users-list">
                {filteredUsers.map((item) => {
                  const email = (typeof item === 'string' ? item : item.email).toLowerCase();
                  const isPrimaryAdmin = ADMIN_EMAILS.some((adm) => adm.toLowerCase() === email);
                  const addedBy = item.added_by || 'admin';
                  const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString() : '';

                  return (
                    <li key={email} className={`admin-user-item ${isPrimaryAdmin ? 'is-admin' : ''}`}>
                      <div className="admin-user-info">
                        <div className="admin-user-avatar">
                          {email.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="admin-user-details">
                          <span className="admin-user-email">{email}</span>
                          <span className="admin-user-meta">
                            {isPrimaryAdmin ? 'Permanent Primary Administrator' : `Added by: ${addedBy}${dateStr ? ` on ${dateStr}` : ''}`}
                          </span>
                        </div>
                      </div>

                      <div className="admin-user-actions">
                        {isPrimaryAdmin ? (
                          <span className="admin-badge-protected" title="Admin account cannot be removed">
                            <ShieldCheck size={13} />
                            <span>Primary Admin</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="admin-remove-btn"
                            onClick={() => handleRemoveEmail(item)}
                            title={`Revoke access for ${email}`}
                          >
                            <Trash2 size={14} />
                            <span>Remove</span>
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
