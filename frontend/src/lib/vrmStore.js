// Avatar (VRM) registry.
//
// Bundled avatars ship in /public and are referenced by URL; user-added .vrm
// files are 10-100MB binaries that blow past localStorage limits, so they
// persist as Blobs in IndexedDB and are served to three.js via object URLs.
const DB_NAME = 'waguri-avatars';
const DB_VERSION = 1;
const STORE = 'vrms';

export const BUNDLED_AVATARS = [
  { id: 'waguri', name: 'Waguri', url: '/waguri.vrm', desc: 'Default companion', thumb: '/avatars/waguri.webp', voiceLabel: 'Sweet & Warm (+8Hz)', voiceGreeting: 'Konnichiwa! Main Waguri hoon, tumhari loving anime companion!' },
  { id: 'zero', name: 'Zero', url: '/Zero.vrm', desc: 'Cyberpunk heroine', thumb: '/avatars/zero.webp', voiceLabel: 'Cool & Confident (-4Hz)', voiceGreeting: 'Hey Darling... ready for our mission together today?' },
  { id: 'vrm3', name: 'Aoi', url: '/vrm3.vrm', desc: 'Cheerful high school girl', thumb: '/avatars/vrm3.webp', voiceLabel: 'High & Peppy (+18Hz)', voiceGreeting: 'Yahallo! Aaj ka din kitna energetic aur fun hai na!' },
  { id: 'vrm4', name: 'Elysia', url: '/vrm4.vrm', desc: 'Graceful forest elf', thumb: '/avatars/vrm4.webp', voiceLabel: 'Soft & Ethereal (+4Hz)', voiceGreeting: 'Namaste... kya tumhe thoda shant aur pyara waqt bitana hai?' },
  { id: 'vrm6', name: 'Yuna', url: '/vrm6.vrm', desc: 'Bright sunshine idol', thumb: '/avatars/vrm6.webp', voiceLabel: 'Radiant Idol (+14Hz)', voiceGreeting: 'Minna-san! Yuna tumhare liye pure dil se sing karegi!' },
  { id: 'vrm7', name: 'Kuroha', url: '/vrm7.vrm', desc: 'Mysterious gothic beauty', thumb: '/avatars/vrm7.webp', voiceLabel: 'Sultry & Calm (-8Hz)', voiceGreeting: 'Khamoshi bhi kitni khoobsurat hoti hai... kya kehte ho?' },
  { id: 'vrm8', name: 'Hikari', url: '/vrm8.vrm', desc: 'Gentle pastel dreamer', thumb: '/avatars/vrm8.webp', voiceLabel: 'Gentle Melody (+6Hz)', voiceGreeting: 'Aapka din bohot accha guzre, hamesha muskurate rahiye...' },
  { id: 'vrm9', name: 'Chiyo', url: '/vrm9.vrm', desc: 'Sweet & bubbly cutie', thumb: '/avatars/vrm9.webp', voiceLabel: 'Cute Anime (+24Hz)', voiceGreeting: 'Ehehe! Chiyo ke sath masti karne ke liye ready ho na?' },
];

export const DEFAULT_VRM_URL = '/waguri.vrm';

// Extracts embedded thumbnail image from a VRM (glTF binary) file
async function extractVrmThumbnail(file) {
  try {
    const headerBuffer = await file.slice(0, 12).arrayBuffer();
    const header = new DataView(headerBuffer);
    const magic = header.getUint32(0, true);
    if (magic !== 0x46546c67) return null; // 'glTF'

    const chunk0HeaderBuffer = await file.slice(12, 20).arrayBuffer();
    const chunk0Header = new DataView(chunk0HeaderBuffer);
    const jsonLen = chunk0Header.getUint32(0, true);

    const jsonBuffer = await file.slice(20, 20 + jsonLen).arrayBuffer();
    const jsonStr = new TextDecoder('utf-8').decode(jsonBuffer);
    const gltf = JSON.parse(jsonStr);

    let imgIdx = gltf.extensions?.VRMC_vrm?.meta?.thumbnailImage;
    if (imgIdx === undefined) {
      const texIdx = gltf.extensions?.VRM?.meta?.texture;
      if (texIdx !== undefined && gltf.textures?.[texIdx]) {
        imgIdx = gltf.textures[texIdx].source;
      }
    }
    if (imgIdx === undefined || !gltf.images?.[imgIdx]) return null;

    const imgInfo = gltf.images[imgIdx];
    const mime = imgInfo.mimeType || 'image/png';
    const bv = gltf.bufferViews?.[imgInfo.bufferView];
    if (!bv) return null;

    const binOffset = 20 + jsonLen + 8;
    const byteOffset = bv.byteOffset || 0;
    const byteLength = bv.byteLength;

    const imgBlob = file.slice(binOffset + byteOffset, binOffset + byteOffset + byteLength, mime);
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(imgBlob);
    });
  } catch (err) {
    console.warn('[waguri] Could not extract thumbnail from VRM:', err);
    return null;
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

// Metadata only (no blobs) — safe to render straight into a list.
export async function listCustomVrms() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).map(({ blob, ...meta }) => meta));
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[waguri] avatar store unavailable:', err.message);
    return [];
  }
}

export async function saveCustomVrm(file) {
  const db = await openDb();
  const thumb = await extractVrmThumbnail(file);
  const meta = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name.replace(/\.vrm$/i, ''),
    size: file.size,
    thumb: thumb || null,
    addedAt: Date.now(),
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...meta, blob: file });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Could not store the VRM file'));
  });
  return meta;
}

export async function getCustomVrmBlob(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCustomVrm(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
