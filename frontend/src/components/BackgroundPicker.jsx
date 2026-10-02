import React, { useRef, useState, useEffect } from 'react';
import { X, ImagePlus, UserRound, Upload, Trash2, Check } from 'lucide-react';
import {
  BUNDLED_AVATARS,
  listCustomVrms,
  saveCustomVrm,
  deleteCustomVrm,
} from '../lib/vrmStore.js';

const PRESETS = [
  { id: 'room', name: '3D Room Stage', desc: 'Cozy baked interior sitting room with warm lighting' },
  { id: 'sunset', name: 'Sunset Glow', desc: 'Warm radiant sunset & twilight gradient' },
  { id: 'paper', name: 'Textured Paper', desc: 'Light geometric woven paper pattern' },
  { id: 'wave', name: 'Colorful Wave', desc: 'Animated wave on cross grid' },
  { id: 'midnight', name: 'Midnight Sky', desc: 'Dark starry sky with moon & shooting meteors' },
  { id: 'transparent', name: 'Transparent', desc: 'Reveal the plain stage backdrop' },
];

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

export default function BackgroundPicker({
  isOpen,
  onClose,
  background,
  onApply,
  activeVrmId = 'waguri',
  onSelectVrm = () => {},
  initialTab = 'background',
}) {
  const [activeTab, setActiveTab] = useState(initialTab); // 'background' | 'avatar'
  const [draftId, setDraftId] = useState(background?.id || 'wave');
  const [draftCustom, setDraftCustom] = useState(background?.custom || '');
  const [customVrms, setCustomVrms] = useState([]);
  const [addingVrm, setAddingVrm] = useState(false);
  const fileRef = useRef(null);
  const vrmFileRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab);
    setDraftId(background?.id || 'wave');
    setDraftCustom(background?.custom || '');
    listCustomVrms().then(setCustomVrms).catch(() => setCustomVrms([]));
  }, [isOpen, background, initialTab]);

  if (!isOpen) return null;

  const applyDraft = (id, custom) => {
    setDraftId(id);
    if (custom !== undefined) setDraftCustom(custom);
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      alert('Custom background image is larger than 4 MB — pick a smaller one.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => applyDraft('custom', String(reader.result));
    reader.readAsDataURL(file);
  };

  const onVrmFile = async (e) => {
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
    setAddingVrm(true);
    try {
      const meta = await saveCustomVrm(file);
      setCustomVrms((c) => [...c, meta]);
      onSelectVrm(meta.id);
    } catch (err) {
      console.error('[waguri] VRM save failed:', err);
      alert(`Could not save that VRM: ${err.message}`);
    } finally {
      setAddingVrm(false);
    }
  };

  const removeCustom = async (id) => {
    if (!window.confirm('Remove this avatar from your saved avatars?')) return;
    try {
      await deleteCustomVrm(id);
      setCustomVrms((c) => c.filter((a) => a.id !== id));
      if (id === activeVrmId) onSelectVrm('waguri');
    } catch (err) {
      alert(`Could not remove that avatar: ${err.message}`);
    }
  };

  const avatarEntries = [
    ...BUNDLED_AVATARS.map((a) => ({ ...a, bundled: true })),
    ...customVrms.map((c) => ({ ...c, bundled: false })),
  ];

  const thumbFor = (id) => {
    if (id === 'room') {
      return (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 45%, #7c2d12 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '2px',
        }}>
          <span style={{ fontSize: '20px' }}>🛋️</span>
          <span style={{ fontSize: '9px', fontWeight: 800, color: '#fef3c7', letterSpacing: '0.6px' }}>3D ROOM</span>
        </div>
      );
    }
    if (id === 'sunset') {
      return (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(125% 125% at -2% 101%, rgba(245, 87, 2, 1) 10.5%, rgba(245, 120, 2, 1) 16%, rgba(245, 140, 2, 1) 17.5%, rgba(245, 170, 100, 1) 25%, rgba(238, 174, 202, 1) 40%, rgba(202, 179, 214, 1) 70%, rgba(202, 179, 214, 1) 100%)',
        }} />
      );
    }
    if (id === 'paper') {
      return (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle, #777 1px, transparent 1px), linear-gradient(45deg, #eee 0%, #ddd 100%)',
          backgroundSize: '16px 16px',
        }} />
      );
    }
    if (id === 'wave') return <div className="cross-grid" style={{ position: 'absolute', inset: 0 }} />;
    if (id === 'midnight') {
      return (
        <div style={{ position: 'absolute', inset: 0, background: '#050505', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: '15%', left: '15%', width: 18, height: 18, borderRadius: '50%', boxShadow: '3px 3px 0 0 #fdfbd3' }} />
          <div style={{ position: 'absolute', top: '35%', left: '55%', width: 2, height: 2, background: '#fff', borderRadius: '50%', boxShadow: '0 0 3px #fff' }} />
          <div style={{ position: 'absolute', top: '65%', left: '70%', width: 2, height: 2, background: '#fff', borderRadius: '50%', boxShadow: '0 0 3px #fff' }} />
        </div>
      );
    }
    if (id === 'custom' && draftCustom) return <div style={{ position: 'absolute', inset: 0, background: `url(${draftCustom}) center/cover` }} />;
    return <div className="checker" style={{ position: 'relative', display: 'grid', placeItems: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>Transparent</div>;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="bg-picker-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header with Switcher Tabs */}
        <div className="modal-header">
          <div className="bg-avatar-tabs">
            <button
              type="button"
              className={`bg-avatar-tab ${activeTab === 'background' ? 'active' : ''}`}
              onClick={() => setActiveTab('background')}
            >
              🖼️ Background
            </button>
            <button
              type="button"
              className={`bg-avatar-tab ${activeTab === 'avatar' ? 'active' : ''}`}
              onClick={() => setActiveTab('avatar')}
            >
              👤 Avatar
            </button>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close modal"><X size={18} /></button>
        </div>

        {/* Background Tab Content (Image 2 style) */}
        {activeTab === 'background' && (
          <>
            <div className="bg-picker-body">
              <div className="bg-options">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`bg-option ${draftId === p.id ? 'selected' : ''}`}
                    onClick={() => applyDraft(p.id)}
                  >
                    <div className="bg-thumb">{thumbFor(p.id)}</div>
                    <span className="bg-name">{p.name}</span>
                    <span className="bg-desc">{p.desc}</span>
                  </button>
                ))}
                {draftCustom && (
                  <button
                    key="custom"
                    type="button"
                    className={`bg-option ${draftId === 'custom' ? 'selected' : ''}`}
                    onClick={() => applyDraft('custom')}
                  >
                    <div className="bg-thumb">{thumbFor('custom')}</div>
                    <span className="bg-name">Custom image</span>
                    <span className="bg-desc">Your uploaded background</span>
                  </button>
                )}
              </div>

              <button
                type="button"
                className="quick-pill"
                style={{ alignSelf: 'flex-start', touchAction: 'manipulation' }}
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                Add custom background
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />

              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: 4 }}>Preview</div>
              <div style={{ height: 110, borderRadius: 12, overflow: 'hidden', position: 'relative', border: '1px solid var(--border-glass)', flexShrink: 0 }}>
                {draftId === 'sunset' && (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'radial-gradient(125% 125% at -2% 101%, rgba(245, 87, 2, 1) 10.5%, rgba(245, 120, 2, 1) 16%, rgba(245, 140, 2, 1) 17.5%, rgba(245, 170, 100, 1) 25%, rgba(238, 174, 202, 1) 40%, rgba(202, 179, 214, 1) 70%, rgba(202, 179, 214, 1) 100%)',
                  }} />
                )}
                {draftId === 'paper' && (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'radial-gradient(circle, #777 1.5px, transparent 1.5px), linear-gradient(45deg, #f5f5f5 0%, #e5e5e5 50%, #f5f5f5 100%)',
                    backgroundSize: '24px 24px',
                  }} />
                )}
                {draftId === 'wave' && <div className="cross-grid" style={{ position: 'absolute', inset: 0 }} />}
                {draftId === 'midnight' && (
                  <div style={{ position: 'absolute', inset: 0, background: '#050505', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: '15%', left: '15%', width: 28, height: 28, borderRadius: '50%', boxShadow: '6px 6px 0 0 #fdfbd3' }} />
                    <div style={{ position: 'absolute', top: '25%', left: '45%', width: 3, height: 3, background: '#fff', borderRadius: '50%', boxShadow: '0 0 5px #fff' }} />
                    <div style={{ position: 'absolute', top: '60%', left: '65%', width: 2, height: 2, background: '#fff', borderRadius: '50%', boxShadow: '0 0 4px #fff' }} />
                    <div style={{ position: 'absolute', top: '40%', left: '80%', width: 2, height: 2, background: '#fff', borderRadius: '50%', boxShadow: '0 0 4px #fff' }} />
                  </div>
                )}
                {draftId === 'custom' && draftCustom && <div style={{ position: 'absolute', inset: 0, background: `url(${draftCustom}) center/cover` }} />}
                {(draftId === 'transparent') && <div className="checker" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: '0.74rem', color: 'var(--text-muted)' }}>Transparent</div>}
              </div>
            </div>

            <div className="bg-picker-footer">
              <button
                type="button"
                className="btn-primary"
                style={{ padding: '9px 18px', touchAction: 'manipulation' }}
                onClick={() => { onApply({ id: draftId, custom: draftId === 'custom' ? draftCustom : '' }); onClose(); }}
              >
                Use this background
              </button>
            </div>
          </>
        )}

        {/* Avatar Tab Content */}
        {activeTab === 'avatar' && (
          <div className="bg-picker-body">
            <p style={{ margin: '0 0 6px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              Choose your 3D avatar companion or upload a custom .VRM model.
            </p>

            <div className="bg-options">
              {avatarEntries.map((a, i) => (
                <div
                  key={a.id}
                  className={`bg-option vrm-option ${activeVrmId === a.id ? 'selected' : ''}`}
                  onClick={() => onSelectVrm(a.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {activeVrmId === a.id && (
                    <span className="vrm-active-badge">
                      <Check size={10} strokeWidth={3} /> Selected
                    </span>
                  )}
                  {!a.bundled && (
                    <button
                      type="button"
                      className="vrm-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCustom(a.id);
                      }}
                      title="Delete this custom avatar"
                      aria-label="Delete avatar"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                  <div className="vrm-thumb">
                    {a.thumb ? (
                      <img src={a.thumb} alt={a.name} className="vrm-thumb-img" />
                    ) : (
                      <div
                        className="vrm-thumb-placeholder"
                        style={{ background: THUMB_GRADIENTS[i % THUMB_GRADIENTS.length] }}
                      >
                        <UserRound size={32} />
                      </div>
                    )}
                  </div>
                  <span className="bg-name">{a.name}</span>
                  <span className="bg-desc">{a.desc || formatSize(a.size)}</span>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="quick-pill"
              style={{ alignSelf: 'flex-start', touchAction: 'manipulation' }}
              disabled={addingVrm}
              onClick={() => vrmFileRef.current?.click()}
            >
              <Upload size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              {addingVrm ? 'Saving avatar…' : 'Add custom VRM avatar (.vrm)'}
            </button>
            <input ref={vrmFileRef} type="file" accept=".vrm" hidden onChange={onVrmFile} />
          </div>
        )}
      </div>
    </div>
  );
}
