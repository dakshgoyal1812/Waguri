import * as THREE from 'three';

// Storage key prefix
const STORAGE_PREFIX = 'waguri_vrm_custom_';

export const OUTFIT_PRESETS = [
  {
    id: 'original',
    name: 'Original Classic',
    desc: 'Default authored outfit & appearance',
    icon: '🌸',
    config: {
      topsColor: null,
      bottomsColor: null,
      shoesColor: null,
      hairColor: null,
      eyeColor: null,
      eyeHighlightColor: null,
      outfitGlow: false,
    },
  },
  {
    id: 'sakura_kawaii',
    name: 'Sakura Kawaii',
    desc: 'Soft pastel cherry blossom aesthetic',
    icon: '🌸',
    config: {
      topsColor: '#fff1f5',
      bottomsColor: '#f472b6',
      shoesColor: '#fb7185',
      hairColor: '#fba1b7',
      eyeColor: '#3b82f6',
      eyeHighlightColor: '#ffffff',
      outfitGlow: false,
    },
  },
  {
    id: 'midnight_gothic',
    name: 'Midnight Gothic',
    desc: 'Dark noir elegance with crimson ruby gaze',
    icon: '🖤',
    config: {
      topsColor: '#18181b',
      bottomsColor: '#27272a',
      shoesColor: '#09090b',
      hairColor: '#1c1917',
      eyeColor: '#e11d48',
      eyeHighlightColor: '#fda4af',
      outfitGlow: true,
      outfitGlowColor: '#7c3aed',
      outfitGlowIntensity: 0.35,
    },
  },
  {
    id: 'cyber_synthwave',
    name: 'Cyber Synthwave',
    desc: 'Futuristic neon cyan & hot pink glow',
    icon: '⚡',
    config: {
      topsColor: '#0f172a',
      bottomsColor: '#1e1b4b',
      shoesColor: '#06b6d4',
      hairColor: '#06b6d4',
      eyeColor: '#ec4899',
      eyeHighlightColor: '#67e8f9',
      outfitGlow: true,
      outfitGlowColor: '#06b6d4',
      outfitGlowIntensity: 0.6,
    },
  },
  {
    id: 'golden_royalty',
    name: 'Golden Royalty',
    desc: 'Regal ivory, amber gold and emerald eyes',
    icon: '👑',
    config: {
      topsColor: '#fef3c7',
      bottomsColor: '#d97706',
      shoesColor: '#b45309',
      hairColor: '#fde047',
      eyeColor: '#10b981',
      eyeHighlightColor: '#fef08a',
      outfitGlow: false,
    },
  },
  {
    id: 'ocean_sailor',
    name: 'Ocean Sailor',
    desc: 'Crisp maritime white & deep ocean navy',
    icon: '🌊',
    config: {
      topsColor: '#ffffff',
      bottomsColor: '#1e3a8a',
      shoesColor: '#0f172a',
      hairColor: '#38bdf8',
      eyeColor: '#0284c7',
      eyeHighlightColor: '#bae6fd',
      outfitGlow: false,
    },
  },
  {
    id: 'mystic_lavender',
    name: 'Mystic Lavender',
    desc: 'Dreamy lilac witchcraft with amber gaze',
    icon: '🔮',
    config: {
      topsColor: '#581c87',
      bottomsColor: '#3b0764',
      shoesColor: '#2e1065',
      hairColor: '#c084fc',
      eyeColor: '#f59e0b',
      eyeHighlightColor: '#fde68a',
      outfitGlow: true,
      outfitGlowColor: '#a855f7',
      outfitGlowIntensity: 0.3,
    },
  },
  {
    id: 'pure_angel',
    name: 'Pure Angel',
    desc: 'Silvery pearl & ethereal lilac aura',
    icon: '🕊️',
    config: {
      topsColor: '#ffffff',
      bottomsColor: '#f8fafc',
      shoesColor: '#e2e8f0',
      hairColor: '#f1f5f9',
      eyeColor: '#818cf8',
      eyeHighlightColor: '#ffffff',
      outfitGlow: false,
    },
  },
  {
    id: 'crimson_rogue',
    name: 'Crimson Rogue',
    desc: 'Bold fiery scarlet & obsidian edge',
    icon: '🔥',
    config: {
      topsColor: '#7f1d1d',
      bottomsColor: '#18181b',
      shoesColor: '#991b1b',
      hairColor: '#dc2626',
      eyeColor: '#fbbf24',
      eyeHighlightColor: '#fef08a',
      outfitGlow: true,
      outfitGlowColor: '#ef4444',
      outfitGlowIntensity: 0.4,
    },
  },
];

export const EYE_SWATCHES = [
  { name: 'Sapphire Blue', color: '#2563eb' },
  { name: 'Ruby Crimson', color: '#dc2626' },
  { name: 'Emerald Green', color: '#10b981' },
  { name: 'Amethyst Violet', color: '#9333ea' },
  { name: 'Topaz Amber', color: '#f59e0b' },
  { name: 'Cyber Cyan', color: '#06b6d4' },
  { name: 'Sakura Pink', color: '#ec4899' },
  { name: 'Warm Hazel', color: '#854d0e' },
  { name: 'Silver Mist', color: '#94a3b8' },
  { name: 'Obsidian Void', color: '#18181b' },
];

export const HAIR_SWATCHES = [
  { name: 'Natural Brown', color: '#573318' },
  { name: 'Raven Black', color: '#18181b' },
  { name: 'Platinum White', color: '#f1f5f9' },
  { name: 'Golden Blonde', color: '#fde047' },
  { name: 'Sakura Pink', color: '#fba1b7' },
  { name: 'Electric Cyan', color: '#06b6d4' },
  { name: 'Lavender Purple', color: '#c084fc' },
  { name: 'Crimson Red', color: '#ef4444' },
  { name: 'Mint Green', color: '#34d399' },
  { name: 'Navy Midnight', color: '#1e3a8a' },
];

export const CLOTH_SWATCHES = [
  { name: 'Pure White', color: '#ffffff' },
  { name: 'Midnight Black', color: '#18181b' },
  { name: 'Sakura Pink', color: '#f472b6' },
  { name: 'Navy Blue', color: '#1e3a8a' },
  { name: 'Crimson Red', color: '#dc2626' },
  { name: 'Royal Purple', color: '#7c3aed' },
  { name: 'Emerald Green', color: '#059669' },
  { name: 'Amber Gold', color: '#d97706' },
  { name: 'Cyber Cyan', color: '#06b6d4' },
  { name: 'Charcoal Grey', color: '#4b5563' },
];

export const SKIN_SWATCHES = [
  { name: 'Default Anime', color: null },
  { name: 'Porcelain Pale', color: '#fff5eb' },
  { name: 'Rosy Peach', color: '#fce7dc' },
  { name: 'Honey Beige', color: '#fad4bb' },
  { name: 'Sun Tan', color: '#e4b693' },
];

export function getCustomizationStorageKey(avatarId) {
  return `${STORAGE_PREFIX}${avatarId || 'waguri'}`;
}

export function loadAvatarCustomization(avatarId) {
  try {
    const raw = localStorage.getItem(getCustomizationStorageKey(avatarId));
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    presetId: 'original',
    topsColor: null,
    bottomsColor: null,
    shoesColor: null,
    outfitGlow: false,
    outfitGlowColor: '#00f0ff',
    outfitGlowIntensity: 0.5,
    eyeColor: null,
    eyeHighlightColor: null,
    hairColor: null,
    skinTone: null,
  };
}

export function saveAvatarCustomization(avatarId, config) {
  try {
    localStorage.setItem(getCustomizationStorageKey(avatarId), JSON.stringify(config));
  } catch {}
}

export function applyAvatarCustomization(vrm, config = {}) {
  if (!vrm?.scene) return;

  vrm.scene.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];

    for (const mat of mats) {
      if (!mat) continue;
      const name = (mat.name || '').toLowerCase();

      // Snapshot original baseline values once
      if (!mat.userData.__waguriOriginal) {
        mat.userData.__waguriOriginal = {
          color: mat.color ? mat.color.clone() : null,
          shadeColorFactor: mat.shadeColorFactor ? mat.shadeColorFactor.clone() : null,
          emissive: mat.emissive ? mat.emissive.clone() : null,
          emissiveIntensity: mat.emissiveIntensity || 0,
        };
      }
      const orig = mat.userData.__waguriOriginal;

      // Always restore base original state before applying requested customizations
      if (orig.color && mat.color) mat.color.copy(orig.color);
      if (orig.shadeColorFactor && mat.shadeColorFactor) mat.shadeColorFactor.copy(orig.shadeColorFactor);
      if (orig.emissive && mat.emissive) mat.emissive.copy(orig.emissive);
      if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = orig.emissiveIntensity;

      // 1. CLOTHES & WARDROBE (Tops, Bottoms, Shoes, Onepiece, Accessory)
      const isCloth = /cloth|tops|bottoms|shoes|dress|onepiece|skirt|suit|shirt|jacket|coat|accessory/i.test(name);
      if (isCloth) {
        const isTops = /top|shirt|jacket|coat|hoodie|onepiece|dress/i.test(name);
        const isBottoms = /bottom|skirt|pants|trouser|shorts/i.test(name);
        const isShoes = /shoe|boot|foot|sneaker|sock/i.test(name);

        let targetColor = null;
        if (isTops && config.topsColor) {
          targetColor = config.topsColor;
        } else if (isBottoms && config.bottomsColor) {
          targetColor = config.bottomsColor;
        } else if (isShoes && config.shoesColor) {
          targetColor = config.shoesColor;
        } else if (config.outfitColor) {
          targetColor = config.outfitColor;
        }

        if (targetColor && mat.color) {
          mat.color.set(targetColor);
          if (mat.shadeColorFactor) {
            const shade = new THREE.Color(targetColor).multiplyScalar(0.68);
            mat.shadeColorFactor.copy(shade);
          }
        }

        // Cyber / Neon glow for outfit
        if (config.outfitGlow && config.outfitGlowColor && mat.emissive) {
          mat.emissive.set(config.outfitGlowColor);
          if (mat.emissiveIntensity !== undefined) {
            mat.emissiveIntensity = config.outfitGlowIntensity || 0.45;
          }
        }
      }

      // 2. EYE IRIS & HIGHLIGHT
      const isEyeIris = /eyeiris|eye_iris/i.test(name) ||
        (name.includes('eye') && !name.includes('white') && !name.includes('line') && !name.includes('lash') && !name.includes('brow') && !name.includes('highlight'));

      if (isEyeIris) {
        if (config.eyeColor && mat.color) {
          mat.color.set(config.eyeColor);
          if (mat.shadeColorFactor) {
            const eyeShade = new THREE.Color(config.eyeColor).multiplyScalar(0.6);
            mat.shadeColorFactor.copy(eyeShade);
          }
        }
      }

      const isEyeHighlight = /eyehighlight|eye_highlight/i.test(name);
      if (isEyeHighlight && config.eyeHighlightColor && mat.color) {
        mat.color.set(config.eyeHighlightColor);
      }

      // 3. HAIR (Front, Back, Strands)
      const isHair = /hair/i.test(name);
      if (isHair && config.hairColor && mat.color) {
        mat.color.set(config.hairColor);
        if (mat.shadeColorFactor) {
          const hairShade = new THREE.Color(config.hairColor).multiplyScalar(0.72);
          mat.shadeColorFactor.copy(hairShade);
        }
      }

      // 4. SKIN / COMPLEXION
      const isSkin = /skin/i.test(name);
      if (isSkin && config.skinTone && mat.color) {
        mat.color.set(config.skinTone);
        if (mat.shadeColorFactor) {
          const skinShade = new THREE.Color(config.skinTone).multiplyScalar(0.85);
          mat.shadeColorFactor.copy(skinShade);
        }
      }

      mat.needsUpdate = true;
    }
  });
}
