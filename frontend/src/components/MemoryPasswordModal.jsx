import React, { useState, useEffect, useRef } from 'react';
import { X, Lock, Eye, EyeOff, Brain, KeyRound, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';
import { getAuthHeaders } from '../supabaseClient.js';
import { BASE_URL } from '../lib/apiBase.js';

export default function MemoryPasswordModal({ isOpen, onClose, onSuccess }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isShake, setIsShake] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setError('');
      setShowPassword(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // SECURITY: the passcode is verified SERVER-SIDE (constant-time compare +
  // brute-force rate limiting). Unlocking mints a short-lived vault token the
  // Memory Inspector presents on every /api/memory call. The old client-side
  // hardcoded password was readable by anyone in the JS bundle.
  const handleSubmit = async (e) => {
    e.preventDefault();
    const clean = password.trim();

    if (!clean) {
      setError('Please enter the security password.');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${BASE_URL}/api/memory/unlock`, {
        method: 'POST',
        headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ password: clean }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 401 ? (data.error || 'Incorrect password! Access denied.') : (data.error || `Unlock failed (HTTP ${res.status})`));
        setIsShake(true);
        setTimeout(() => setIsShake(false), 500);
        try {
          if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
        } catch {}
        return;
      }
      try {
        sessionStorage.setItem('waguri_vault_token', data.vault_token);
        // UI-only convenience flag (skip re-typing the password this session).
        // The real credential is the server-issued vault token above.
        sessionStorage.setItem('waguri_memory_unlocked', 'true');
      } catch {}
      onSuccess();
    } catch (err) {
      setError(err.message || 'Could not reach the server to verify the password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="memory-lock-backdrop" onClick={onClose}>
      <div
        className={`memory-lock-modal ${isShake ? 'shake' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="memory-lock-close"
          onClick={onClose}
          aria-label="Close password prompt"
        >
          <X size={18} />
        </button>

        <div className="memory-lock-content">
          <div className="memory-lock-icon-badge">
            <Brain size={28} className="memory-lock-brain-icon" />
            <div className="memory-lock-sub-badge">
              <Lock size={12} />
            </div>
          </div>

          <h3 className="memory-lock-title">Memory Brain Vault</h3>
          <p className="memory-lock-subtitle">
            Enter the master security password to access and inspect Waguri's RAG long-term memories.
          </p>

          <form className="memory-lock-form" onSubmit={handleSubmit}>
            <div className="memory-lock-input-wrapper">
              <KeyRound size={17} className="memory-lock-input-icon" />
              <input
                ref={inputRef}
                type={showPassword ? 'text' : 'password'}
                className="memory-lock-input font-mono"
                placeholder="Enter password..."
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="memory-lock-eye-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                title={showPassword ? 'Hide password' : 'Show password'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {error && (
              <div className="memory-lock-error-banner">
                <AlertCircle size={15} />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className="memory-lock-submit-btn" disabled={isSubmitting}>
              <span>{isSubmitting ? 'Verifying...' : 'Unlock Memory Inspector'}</span>
              <ArrowRight size={16} />
            </button>
          </form>

          <div className="memory-lock-footer-hint">
            <ShieldCheck size={14} className="text-emerald" />
            <span>Protected by server-side verification & AES-256 RAG encryption</span>
          </div>
        </div>
      </div>
    </div>
  );
}
