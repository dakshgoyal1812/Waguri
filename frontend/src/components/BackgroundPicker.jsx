import React, { useRef, useState } from 'react';
import { X, ImagePlus } from 'lucide-react';

// AIRI-style background picker: presets + custom upload, live preview, apply.
const PRESETS = [
  { id: 'wave', name: 'Colorful Wave', desc: 'Animated wave on cross grid' },
  { id: 'transparent', name: 'Transparent', desc: 'Reveal the plain stage backdrop' },
];

export default function BackgroundPicker({ isOpen, onClose, background, onApply }) {
  const [draftId, setDraftId] = useState(background.id);
  const [draftCustom, setDraftCustom] = useState(background.custom || '');
  const fileRef = useRef(null);
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

  const thumbFor = (id) => {
    if (id === 'wave') return <div className="cross-grid" style={{ position: 'absolute', inset: 0 }} />;
    if (id === 'custom' && draftCustom) return <div style={{ position: 'absolute', inset: 0, background: `url(${draftCustom}) center/cover` }} />;
    return <div className="checker" style={{ position: 'relative', display: 'grid', placeItems: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>Transparent</div>;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ width: 'min(680px, calc(100vw - 32px))' }}>
        <div className="modal-header">
          <h3>Stage background</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close modal"><X size={18} /></button>
        </div>

        <div className="bg-options">
          {PRESETS.map((p) => (
            <button
              key={p.id}
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
              className={`bg-option ${draftId === 'custom' ? 'selected' : ''}`}
              onClick={() => applyDraft('custom')}
            >
              <div className="bg-thumb">{thumbFor('custom')}</div>
              <span className="bg-name">Custom image</span>
              <span className="bg-desc">Your uploaded background</span>
            </button>
          )}
        </div>

        <button className="quick-pill" style={{ marginBottom: 14 }} onClick={() => fileRef.current?.click()}>
          <ImagePlus size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
          Add custom background
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />

        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', margin: '6px 0' }}>Preview</div>
        <div style={{ height: 120, borderRadius: 12, overflow: 'hidden', position: 'relative', border: '1px solid var(--border-glass)' }}>
          {draftId === 'wave' && <div className="cross-grid" style={{ position: 'absolute', inset: 0 }} />}
          {draftId === 'custom' && draftCustom && <div style={{ position: 'absolute', inset: 0, background: `url(${draftCustom}) center/cover` }} />}
          {(draftId === 'transparent') && <div className="checker" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: '0.74rem', color: 'var(--text-muted)' }}>Transparent</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button
            className="btn-primary"
            onClick={() => { onApply({ id: draftId, custom: draftId === 'custom' ? draftCustom : '' }); onClose(); }}
          >
            Use this background
          </button>
        </div>
      </div>
    </div>
  );
}
