import React, { useRef, useState, useEffect } from 'react';
import { X, ImagePlus, Check, Image as ImageIcon } from 'lucide-react';

const PRESETS = [
  { id: 'room', name: 'Cozy Room', desc: 'Anime wallpaper on phone / 3D room on laptop' },
  { id: 'sunset', name: 'Sunset Glow', desc: 'Warm radiant sunset & twilight gradient' },
  { id: 'paper', name: 'Textured Paper', desc: 'Light geometric woven paper pattern' },
  { id: 'wave', name: 'Colorful Wave', desc: 'Animated wave on cross grid' },
  { id: 'midnight', name: 'Midnight Sky', desc: 'Dark starry sky with moon & shooting meteors' },
  { id: 'transparent', name: 'Transparent', desc: 'Reveal the plain stage backdrop' },
];

export default function BackgroundPicker({
  isOpen,
  onClose,
  background,
  onApply,
}) {
  const [draftId, setDraftId] = useState(background?.id || 'room');
  const [draftCustom, setDraftCustom] = useState(background?.custom || '');
  const fileRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setDraftId(background?.id || 'room');
    setDraftCustom(background?.custom || '');
  }, [isOpen, background]);

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

  const applyDraft = (id, custom) => {
    setDraftId(id);
    if (custom !== undefined) setDraftCustom(custom);
  };

  const handleSelectBackground = (id, custom = '') => {
    applyDraft(id, custom);
    onApply({ id, custom });
    onClose();
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      alert('Custom background image is larger than 4 MB — please pick a smaller one.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      applyDraft('custom', dataUrl);
      onApply({ id: 'custom', custom: dataUrl });
      onClose();
    };
    reader.readAsDataURL(file);
  };

  const thumbFor = (id) => {
    if (id === 'room') {
      return (
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: "url('/room-phone.webp')",
          backgroundPosition: 'center 40%',
          backgroundSize: 'cover',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingBottom: '3px',
        }}>
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, transparent 30%, rgba(15, 10, 25, 0.85) 100%)',
          }} />
          <span style={{ position: 'relative', fontSize: '9px', fontWeight: 800, color: '#fef3c7', letterSpacing: '0.6px', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
            🛋️ COZY ROOM
          </span>
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
        {/* Header */}
        <div className="modal-header" style={{ padding: '16px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ImageIcon size={20} style={{ color: '#3b82f6' }} />
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>Stage Wallpaper</h3>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className="bg-picker-body">
          <p style={{ margin: '0 0 4px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            Choose an anime room, radiant gradient or custom photo for Waguri's backdrop.
          </p>

          <div className="bg-options">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`bg-option ${draftId === p.id ? 'selected' : ''}`}
                onClick={() => handleSelectBackground(p.id)}
              >
                <div className="bg-thumb">{thumbFor(p.id)}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span className="bg-name">{p.name}</span>
                  {draftId === p.id && <Check size={13} style={{ color: 'var(--accent-purple)' }} />}
                </div>
                <span className="bg-desc">{p.desc}</span>
              </button>
            ))}
            {draftCustom && (
              <button
                key="custom"
                type="button"
                className={`bg-option ${draftId === 'custom' ? 'selected' : ''}`}
                onClick={() => handleSelectBackground('custom', draftCustom)}
              >
                <div className="bg-thumb">{thumbFor('custom')}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span className="bg-name">Custom image</span>
                  {draftId === 'custom' && <Check size={13} style={{ color: 'var(--accent-purple)' }} />}
                </div>
                <span className="bg-desc">Your uploaded photo</span>
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
            Add custom background photo
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />

          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: 4 }}>Preview</div>
          <div style={{ height: 110, borderRadius: 12, overflow: 'hidden', position: 'relative', border: '1px solid var(--border-glass)', flexShrink: 0 }}>
            {draftId === 'room' && (
              <div style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: "url('/room-phone.webp')",
                backgroundPosition: 'center 45%',
                backgroundSize: 'cover',
              }}>
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.6) 100%)',
                  display: 'flex',
                  alignItems: 'flex-end',
                  padding: '8px 12px',
                }}>
                  <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#fef3c7', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                    Cozy Room (Anime Wallpaper on Phone, 3D Room on Laptop)
                  </span>
                </div>
              </div>
            )}
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
            onClick={() => {
              onApply({ id: draftId, custom: draftId === 'custom' ? draftCustom : '' });
              onClose();
            }}
          >
            Apply wallpaper
          </button>
        </div>
      </div>
    </div>
  );
}
