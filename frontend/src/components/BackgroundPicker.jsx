import React, { useRef, useState } from 'react';
import { X, ImagePlus } from 'lucide-react';

// AIRI-style background picker: presets + custom upload, live preview, apply.
const PRESETS = [
  { id: 'sunset', name: 'Sunset Glow', desc: 'Warm radiant sunset & twilight gradient' },
  { id: 'paper', name: 'Textured Paper', desc: 'Light geometric woven paper pattern' },
  { id: 'wave', name: 'Colorful Wave', desc: 'Animated wave on cross grid' },
  { id: 'midnight', name: 'Midnight Sky', desc: 'Dark starry sky with moon & shooting meteors' },
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
