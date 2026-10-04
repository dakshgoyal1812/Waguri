import React, { useEffect, useRef, useState } from 'react';
import { X, Upload, Trash2, Check, UserRound, Volume2, Loader2 } from 'lucide-react';
import {
  BUNDLED_AVATARS,
  listCustomVrms,
  saveCustomVrm,
  deleteCustomVrm,
} from '../lib/vrmStore.js';
import { synthesizeToUrl } from '../api.js';

const THUMB_GRADIENTS = [
  'linear-gradient(135deg, #a78bfa, #f472b6)',
  'linear-gradient(135deg, #22b8cf, #8b5cf6)',
  'linear-gradient(135deg, #fb923c, #f472b6)',
  'linear-gradient(135deg, #34d399, #22b8cf)',
];

const formatSize = (bytes) => {
  if (!Number.isFinite(bytes)) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

// Dedicated Avatar companion picker: bundled 3D models + user custom .vrm files.
// Every avatar talks, emotes, blinks and tracks the cursor seamlessly.
export default function VRMPicker({
  isOpen,
  onClose,
  activeId,
  activeVrmId,
  onSelect,
  onSelectVrm,
  onOpenStudio,
}) {
  const currentActiveId = activeId || activeVrmId || 'waguri';
  const handleSelect = onSelect || onSelectVrm || (() => {});

  const [customs, setCustoms] = useState([]);
  const [adding, setAdding] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState(null);
  const fileRef = useRef(null);
  const audioPreviewRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    listCustomVrms().then(setCustoms).catch(() => setCustoms([]));
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
        audioPreviewRef.current = null;
      }
    };
  }, []);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handlePreviewVoice = async (e, a) => {
    e.stopPropagation();
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
      audioPreviewRef.current = null;
    }
    if (playingVoiceId === a.id) {
      setPlayingVoiceId(null);
      return;
    }
    setPlayingVoiceId(a.id);
    try {
      const text = a.voiceGreeting || `Konnichiwa! Main ${a.name} hoon!`;
      const res = await synthesizeToUrl(text, 'happy', a.id);
      if (res?.audio_url) {
        const audio = new Audio(res.audio_url);
        audioPreviewRef.current = audio;
        audio.onended = () => setPlayingVoiceId(null);
        audio.onerror = () => setPlayingVoiceId(null);
        await audio.play();
      } else {
        setPlayingVoiceId(null);
      }
    } catch (err) {
      console.warn('Voice preview error:', err);
      setPlayingVoiceId(null);
    }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.vrm$/i.test(file.name)) {
      alert('Please pick a .vrm file (VRM 0.x or 1.0 models both work).');
      return;
    }
    if (file.size > 150 * 1024 * 1024) {
      alert('That VRM is larger than 150 MB — please use a smaller file.');
      return;
    }
    setAdding(true);
    try {
      const meta = await saveCustomVrm(file);
      setCustoms((c) => [...c, meta]);
      handleSelect(meta.id); // wear new avatar right away
      onClose();
    } catch (err) {
      console.error('[waguri] VRM save failed:', err);
      alert(`Could not save that VRM: ${err.message}`);
    } finally {
      setAdding(false);
    }
  };

  const removeCustom = async (id) => {
    if (!window.confirm('Remove this avatar from your saved avatars?')) return;
    try {
      await deleteCustomVrm(id);
      setCustoms((c) => c.filter((a) => a.id !== id));
      if (id === currentActiveId) handleSelect('waguri');
    } catch (err) {
      alert(`Could not remove that avatar: ${err.message}`);
    }
  };

  const entries = [
    ...BUNDLED_AVATARS.map((a) => ({ ...a, bundled: true })),
    ...customs.map((c) => ({ ...c, bundled: false })),
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="bg-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ padding: '16px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <UserRound size={20} style={{ color: '#8b5cf6' }} />
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>3D Avatar Companion</h3>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className="bg-picker-body">
          <p style={{ margin: '0 0 6px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            Choose your 3D avatar companion or upload a custom .VRM model. Each avatar speaks with their own unique voice and emotes naturally.
          </p>

          {onOpenStudio && (
            <div
              style={{
                margin: '8px 0 14px',
                padding: '10px 14px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.15), rgba(245, 158, 11, 0.15))',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
              }}
            >
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f59e0b' }}>
                  👗 3D Wardrobe & Avatar Customizer
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                  Change clothes, eyes, hair & neon glow on your current avatar in real-time!
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenStudio();
                }}
                style={{
                  padding: '6px 14px',
                  borderRadius: '9999px',
                  background: 'linear-gradient(135deg, #ec4899, #f59e0b)',
                  border: 'none',
                  color: '#fff',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Customize Look
              </button>
            </div>
          )}

          <div className="bg-options">
            {entries.map((a, i) => (
              <div
                key={a.id}
                className={`bg-option vrm-option ${currentActiveId === a.id ? 'selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  handleSelect(a.id);
                  onClose();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    handleSelect(a.id);
                    onClose();
                  }
                }}
              >
                <div
                  className="bg-thumb vrm-thumb"
                  style={{
                    background: a.thumb
                      ? '#2a2b36'
                      : (a.bundled
                          ? THUMB_GRADIENTS[i % THUMB_GRADIENTS.length]
                          : THUMB_GRADIENTS[(i + 1) % THUMB_GRADIENTS.length]),
                  }}
                >
                  {a.thumb ? (
                    <img
                      src={a.thumb}
                      alt={a.name}
                      className="vrm-thumb-img"
                      loading="lazy"
                    />
                  ) : (
                    <div className="vrm-thumb-placeholder">
                      <UserRound size={30} />
                    </div>
                  )}
                </div>

                <span className="bg-name">{a.name}</span>
                <span className="bg-desc">{a.bundled ? a.desc : formatSize(a.size)}</span>

                {currentActiveId === a.id && (
                  <span className="vrm-active-badge">
                    <Check size={11} strokeWidth={3} /> Selected
                  </span>
                )}

                {a.voiceLabel && (
                  <span className="vrm-voice-tag" title="Character voice pitch & tone">
                    🎵 {a.voiceLabel}
                  </span>
                )}

                {a.bundled && (
                  <button
                    type="button"
                    className={`vrm-preview-btn ${playingVoiceId === a.id ? 'playing' : ''}`}
                    onClick={(e) => handlePreviewVoice(e, a)}
                    title={`Listen to ${a.name}'s voice tone`}
                  >
                    {playingVoiceId === a.id ? (
                      <>
                        <Loader2 size={12} className="spin" /> Playing voice...
                      </>
                    ) : (
                      <>
                        <Volume2 size={12} /> Preview voice
                      </>
                    )}
                  </button>
                )}

                {!a.bundled && (
                  <button
                    type="button"
                    className="vrm-delete"
                    title="Remove this avatar"
                    aria-label={`Remove ${a.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCustom(a.id);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            className="quick-pill"
            style={{ alignSelf: 'flex-start', touchAction: 'manipulation' }}
            disabled={adding}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            {adding ? 'Saving avatar…' : 'Add custom VRM avatar (.vrm)'}
          </button>
          <input ref={fileRef} type="file" accept=".vrm" hidden onChange={onFile} />
        </div>
      </div>
    </div>
  );
}
