import React, { useEffect, useRef, useState } from 'react';
import { X, Upload, Trash2, Check, UserRound } from 'lucide-react';
import {
  BUNDLED_AVATARS,
  listCustomVrms,
  saveCustomVrm,
  deleteCustomVrm,
} from '../lib/vrmStore.js';

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

// Avatar picker: bundled models + user-added .vrm files (stored in IndexedDB).
// Selecting one swaps the 3D stage onto it — talking, emotions, gaze and all
// other capabilities carry over because the animation rig is model-agnostic.
export default function VRMPicker({ isOpen, onClose, activeId, onSelect }) {
  const [customs, setCustoms] = useState([]);
  const [adding, setAdding] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    listCustomVrms().then(setCustoms).catch(() => setCustoms([]));
  }, [isOpen]);

  if (!isOpen) return null;

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file after a fix-up
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
      onSelect(meta.id); // wear the new avatar right away
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
      if (id === activeId) onSelect('waguri'); // deleted the worn one → back to default
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
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <UserRound size={20} style={{ color: '#8b5cf6' }} />
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>Avatar</h3>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close modal"><X size={18} /></button>
        </div>

        <div className="bg-picker-body">
          <p style={{ margin: '0 0 4px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            Every avatar talks, emotes, blinks and follows your cursor exactly like Waguri —
            pick one below or add your own .vrm file.
          </p>

          <div className="bg-options">
            {entries.map((a, i) => (
              <div
                key={a.id}
                className={`bg-option vrm-option ${activeId === a.id ? 'selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(a.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(a.id); }}
              >
                <div className="bg-thumb vrm-thumb" style={{ background: a.bundled ? THUMB_GRADIENTS[i % THUMB_GRADIENTS.length] : THUMB_GRADIENTS[(i + 1) % THUMB_GRADIENTS.length] }}>
                  {a.name.charAt(0).toUpperCase()}
                </div>
                <span className="bg-name">{a.name}</span>
                <span className="bg-desc">{a.bundled ? a.desc : formatSize(a.size)}</span>
                {activeId === a.id && (
                  <span className="vrm-active-badge"><Check size={11} /> Worn</span>
                )}
                {!a.bundled && (
                  <button
                    type="button"
                    className="vrm-delete"
                    title="Remove this avatar"
                    aria-label={`Remove ${a.name}`}
                    onClick={(e) => { e.stopPropagation(); removeCustom(a.id); }}
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
            {adding ? 'Adding avatar…' : 'Add your own VRM'}
          </button>
          <input ref={fileRef} type="file" accept=".vrm" hidden onChange={onFile} />
        </div>
      </div>
    </div>
  );
}
