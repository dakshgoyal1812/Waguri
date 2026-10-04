import React, { useState } from 'react';
import {
  X,
  Sparkles,
  Shirt,
  Eye,
  Scissors,
  RotateCcw,
  Shuffle,
  Check,
  Zap,
} from 'lucide-react';
import {
  OUTFIT_PRESETS,
  EYE_SWATCHES,
  HAIR_SWATCHES,
  CLOTH_SWATCHES,
  SKIN_SWATCHES,
} from '../lib/avatarCustomization.js';

export default function AvatarStudioModal({
  isOpen,
  onClose,
  activeAvatarName = 'Waguri',
  customization,
  onChangeCustomization,
  onReset,
}) {
  const [activeTab, setActiveTab] = useState('presets'); // 'presets' | 'clothes' | 'eyes' | 'hair'

  if (!isOpen) return null;

  const current = customization || {};

  const update = (patch) => {
    onChangeCustomization({ ...current, ...patch });
  };

  const handleApplyPreset = (preset) => {
    update({
      presetId: preset.id,
      ...preset.config,
    });
  };

  const handleRandomize = () => {
    // Pick a random preset or a coordinated aesthetic
    const randomPreset = OUTFIT_PRESETS[Math.floor(Math.random() * OUTFIT_PRESETS.length)];
    if (randomPreset) {
      handleApplyPreset(randomPreset);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="avatar-studio-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="avatar-studio-header">
          <div className="avatar-studio-header-title">
            <div className="avatar-studio-icon-badge">
              <Sparkles size={20} className="text-pink-400" />
            </div>
            <div>
              <div className="avatar-studio-title-row">
                <h2>3D Wardrobe & Avatar Studio</h2>
                <span className="avatar-studio-model-badge">{activeAvatarName}</span>
              </div>
              <p className="avatar-studio-subtitle">
                Customize clothes, eyes, hair & outfit styles in real-time 3D
              </p>
            </div>
          </div>
          <button
            type="button"
            className="avatar-studio-close-btn"
            onClick={onClose}
            aria-label="Close studio"
          >
            <X size={18} />
          </button>
        </div>

        {/* Quick Toolbar */}
        <div className="avatar-studio-toolbar">
          <div className="avatar-studio-tabs">
            <button
              type="button"
              className={`avatar-studio-tab ${activeTab === 'presets' ? 'active' : ''}`}
              onClick={() => setActiveTab('presets')}
            >
              <Sparkles size={15} />
              <span>Style Presets</span>
            </button>
            <button
              type="button"
              className={`avatar-studio-tab ${activeTab === 'clothes' ? 'active' : ''}`}
              onClick={() => setActiveTab('clothes')}
            >
              <Shirt size={15} />
              <span>Clothes & Outfit</span>
            </button>
            <button
              type="button"
              className={`avatar-studio-tab ${activeTab === 'eyes' ? 'active' : ''}`}
              onClick={() => setActiveTab('eyes')}
            >
              <Eye size={15} />
              <span>Eyes & Sparkle</span>
            </button>
            <button
              type="button"
              className={`avatar-studio-tab ${activeTab === 'hair' ? 'active' : ''}`}
              onClick={() => setActiveTab('hair')}
            >
              <Scissors size={15} />
              <span>Hair & Skin</span>
            </button>
          </div>

          <div className="avatar-studio-actions">
            <button
              type="button"
              className="avatar-studio-tool-btn"
              onClick={handleRandomize}
              title="Pick a random coordinated aesthetic"
            >
              <Shuffle size={14} />
              <span className="tool-btn-text">Randomize</span>
            </button>
            <button
              type="button"
              className="avatar-studio-tool-btn danger"
              onClick={onReset}
              title="Reset model to original authored look"
            >
              <RotateCcw size={14} />
              <span className="tool-btn-text">Reset</span>
            </button>
          </div>
        </div>

        {/* Tab Content Body */}
        <div className="avatar-studio-body">
          {/* TAB 1: PRESETS */}
          {activeTab === 'presets' && (
            <div className="studio-section">
              <div className="studio-section-header">
                <h3>Curated Anime Aesthetic Presets</h3>
                <p>One-click complete style transformations tailored for {activeAvatarName}</p>
              </div>

              <div className="studio-presets-grid">
                {OUTFIT_PRESETS.map((preset) => {
                  const isSelected = current.presetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`studio-preset-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleApplyPreset(preset)}
                    >
                      <div className="preset-card-top">
                        <span className="preset-icon">{preset.icon}</span>
                        {isSelected && (
                          <span className="preset-active-pill">
                            <Check size={12} /> Active
                          </span>
                        )}
                      </div>
                      <div className="preset-card-info">
                        <div className="preset-name">{preset.name}</div>
                        <div className="preset-desc">{preset.desc}</div>
                      </div>
                      <div className="preset-color-dots">
                        {preset.config.hairColor && (
                          <span
                            className="color-dot"
                            style={{ background: preset.config.hairColor }}
                            title="Hair"
                          />
                        )}
                        {preset.config.eyeColor && (
                          <span
                            className="color-dot"
                            style={{ background: preset.config.eyeColor }}
                            title="Eyes"
                          />
                        )}
                        {preset.config.topsColor && (
                          <span
                            className="color-dot"
                            style={{ background: preset.config.topsColor }}
                            title="Tops"
                          />
                        )}
                        {preset.config.bottomsColor && (
                          <span
                            className="color-dot"
                            style={{ background: preset.config.bottomsColor }}
                            title="Bottoms"
                          />
                        )}
                        {preset.config.shoesColor && (
                          <span
                            className="color-dot"
                            style={{ background: preset.config.shoesColor }}
                            title="Shoes"
                          />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: CLOTHES & WARDROBE */}
          {activeTab === 'clothes' && (
            <div className="studio-section">
              {/* Tops & Dresses */}
              <div className="studio-control-group">
                <div className="studio-group-label">
                  <span>👗 Tops / Dress / Onepiece Color</span>
                  {current.topsColor && (
                    <button
                      type="button"
                      className="studio-clear-btn"
                      onClick={() => update({ topsColor: null, presetId: 'custom' })}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="studio-swatches-row">
                  {CLOTH_SWATCHES.map((swatch) => (
                    <button
                      key={swatch.color}
                      type="button"
                      className={`studio-swatch ${current.topsColor === swatch.color ? 'active' : ''}`}
                      style={{ background: swatch.color }}
                      onClick={() => update({ topsColor: swatch.color, presetId: 'custom' })}
                      title={swatch.name}
                    />
                  ))}
                  <label className="studio-custom-color-picker" title="Pick any custom color">
                    <input
                      type="color"
                      value={current.topsColor || '#ffffff'}
                      onChange={(e) => update({ topsColor: e.target.value, presetId: 'custom' })}
                    />
                    <span>Custom</span>
                  </label>
                </div>
              </div>

              {/* Skirts & Bottoms */}
              <div className="studio-control-group">
                <div className="studio-group-label">
                  <span>🩳 Skirt / Bottoms Color</span>
                  {current.bottomsColor && (
                    <button
                      type="button"
                      className="studio-clear-btn"
                      onClick={() => update({ bottomsColor: null, presetId: 'custom' })}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="studio-swatches-row">
                  {CLOTH_SWATCHES.map((swatch) => (
                    <button
                      key={swatch.color}
                      type="button"
                      className={`studio-swatch ${current.bottomsColor === swatch.color ? 'active' : ''}`}
                      style={{ background: swatch.color }}
                      onClick={() => update({ bottomsColor: swatch.color, presetId: 'custom' })}
                      title={swatch.name}
                    />
                  ))}
                  <label className="studio-custom-color-picker" title="Pick any custom color">
                    <input
                      type="color"
                      value={current.bottomsColor || '#ffffff'}
                      onChange={(e) => update({ bottomsColor: e.target.value, presetId: 'custom' })}
                    />
                    <span>Custom</span>
                  </label>
                </div>
              </div>

              {/* Shoes */}
              <div className="studio-control-group">
                <div className="studio-group-label">
                  <span>👠 Shoes & Footwear Color</span>
                  {current.shoesColor && (
                    <button
                      type="button"
                      className="studio-clear-btn"
                      onClick={() => update({ shoesColor: null, presetId: 'custom' })}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="studio-swatches-row">
                  {CLOTH_SWATCHES.map((swatch) => (
                    <button
                      key={swatch.color}
                      type="button"
                      className={`studio-swatch ${current.shoesColor === swatch.color ? 'active' : ''}`}
                      style={{ background: swatch.color }}
                      onClick={() => update({ shoesColor: swatch.color, presetId: 'custom' })}
                      title={swatch.name}
                    />
                  ))}
                  <label className="studio-custom-color-picker" title="Pick any custom color">
                    <input
                      type="color"
                      value={current.shoesColor || '#ffffff'}
                      onChange={(e) => update({ shoesColor: e.target.value, presetId: 'custom' })}
                    />
                    <span>Custom</span>
                  </label>
                </div>
              </div>

              {/* Cyber Glow Accent */}
              <div className="studio-control-group glow-box">
                <div className="studio-group-label">
                  <div className="flex items-center gap-2">
                    <Zap size={15} className="text-yellow-400" />
                    <span>Cyberpunk Outfit Neon Glow</span>
                  </div>
                  <label className="studio-switch">
                    <input
                      type="checkbox"
                      checked={Boolean(current.outfitGlow)}
                      onChange={(e) => update({ outfitGlow: e.target.checked, presetId: 'custom' })}
                    />
                    <span className="slider round"></span>
                  </label>
                </div>
                {current.outfitGlow && (
                  <div className="glow-controls">
                    <div className="glow-color-pickers">
                      <span>Glow Color:</span>
                      <input
                        type="color"
                        value={current.outfitGlowColor || '#00f0ff'}
                        onChange={(e) => update({ outfitGlowColor: e.target.value, presetId: 'custom' })}
                      />
                      <span className="glow-hex">{current.outfitGlowColor || '#00f0ff'}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: EYES & SPARKLE */}
          {activeTab === 'eyes' && (
            <div className="studio-section">
              {/* Eye Iris Color */}
              <div className="studio-control-group">
                <div className="studio-group-label">
                  <span>👁️ Eye Iris Color (Gaze)</span>
                  {current.eyeColor && (
                    <button
                      type="button"
                      className="studio-clear-btn"
                      onClick={() => update({ eyeColor: null, presetId: 'custom' })}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="studio-swatches-row">
                  {EYE_SWATCHES.map((swatch) => (
                    <button
                      key={swatch.color}
                      type="button"
                      className={`studio-swatch eye ${current.eyeColor === swatch.color ? 'active' : ''}`}
                      style={{ background: swatch.color }}
                      onClick={() => update({ eyeColor: swatch.color, presetId: 'custom' })}
                      title={swatch.name}
                    />
                  ))}
                  <label className="studio-custom-color-picker" title="Pick any custom color">
                    <input
                      type="color"
                      value={current.eyeColor || '#2563eb'}
                      onChange={(e) => update({ eyeColor: e.target.value, presetId: 'custom' })}
                    />
                    <span>Custom</span>
                  </label>
                </div>
              </div>

              {/* Eye Sparkle / Highlight */}
              <div className="studio-control-group">
                <div className="studio-group-label">
                  <span>✨ Eye Sparkle / Highlight Tint</span>
                  {current.eyeHighlightColor && (
                    <button
                      type="button"
                      className="studio-clear-btn"
                      onClick={() => update({ eyeHighlightColor: null, presetId: 'custom' })}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="studio-swatches-row">
                  {[
                    { name: 'Pure White Sparkle', color: '#ffffff' },
                    { name: 'Golden Sparkle', color: '#fef08a' },
                    { name: 'Cyan Shimmer', color: '#67e8f9' },
                    { name: 'Rose Sparkle', color: '#fda4af' },
                    { name: 'Lilac Magic', color: '#e9d5ff' },
                  ].map((swatch) => (
                    <button
                      key={swatch.color}
                      type="button"
                      className={`studio-swatch ${current.eyeHighlightColor === swatch.color ? 'active' : ''}`}
                      style={{ background: swatch.color }}
                      onClick={() => update({ eyeHighlightColor: swatch.color, presetId: 'custom' })}
                      title={swatch.name}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: HAIR & SKIN */}
          {activeTab === 'hair' && (
            <div className="studio-section">
              {/* Hair Color */}
              <div className="studio-control-group">
                <div className="studio-group-label">
                  <span>💇‍♀️ Hair Color & Tint</span>
                  {current.hairColor && (
                    <button
                      type="button"
                      className="studio-clear-btn"
                      onClick={() => update({ hairColor: null, presetId: 'custom' })}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="studio-swatches-row">
                  {HAIR_SWATCHES.map((swatch) => (
                    <button
                      key={swatch.color}
                      type="button"
                      className={`studio-swatch ${current.hairColor === swatch.color ? 'active' : ''}`}
                      style={{ background: swatch.color }}
                      onClick={() => update({ hairColor: swatch.color, presetId: 'custom' })}
                      title={swatch.name}
                    />
                  ))}
                  <label className="studio-custom-color-picker" title="Pick any custom color">
                    <input
                      type="color"
                      value={current.hairColor || '#fba1b7'}
                      onChange={(e) => update({ hairColor: e.target.value, presetId: 'custom' })}
                    />
                    <span>Custom</span>
                  </label>
                </div>
              </div>

              {/* Skin Complexion */}
              <div className="studio-control-group">
                <div className="studio-group-label">
                  <span>🌸 Skin Complexion / Blush Tone</span>
                  {current.skinTone && (
                    <button
                      type="button"
                      className="studio-clear-btn"
                      onClick={() => update({ skinTone: null, presetId: 'custom' })}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="studio-skin-options">
                  {SKIN_SWATCHES.map((swatch) => (
                    <button
                      key={swatch.name}
                      type="button"
                      className={`studio-skin-btn ${current.skinTone === swatch.color ? 'active' : ''}`}
                      onClick={() => update({ skinTone: swatch.color, presetId: 'custom' })}
                    >
                      {swatch.color ? (
                        <span className="skin-dot" style={{ background: swatch.color }} />
                      ) : (
                        <span className="skin-dot default-anime-dot" />
                      )}
                      <span>{swatch.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="avatar-studio-footer">
          <div className="avatar-studio-footer-hint">
            <span>✨ Live changes apply instantly to the 3D model</span>
          </div>
          <button
            type="button"
            className="avatar-studio-done-btn"
            onClick={onClose}
          >
            <Check size={16} />
            <span>Apply & Done</span>
          </button>
        </div>
      </div>
    </div>
  );
}
