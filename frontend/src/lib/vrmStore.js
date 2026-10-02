// Avatar (VRM) registry.
//
// Bundled avatars ship in /public and are referenced by URL; user-added .vrm
// files are 10-100MB binaries that blow past localStorage limits, so they
// persist as Blobs in IndexedDB and are served to three.js via object URLs.
const DB_NAME = 'waguri-avatars';
const DB_VERSION = 1;
const STORE = 'vrms';

export const BUNDLED_AVATARS = [
  { id: 'waguri', name: 'Waguri', url: '/waguri.vrm', desc: 'Default companion', thumb: '/avatars/waguri.png' },
  { id: 'zero', name: 'Zero', url: '/Zero.vrm', desc: 'Bundled VRoid avatar', thumb: '/avatars/zero.png' },
  { id: 'vrm3', name: 'VRM 3 (Sample B)', url: '/vrm3.vrm', desc: 'Pixiv VRoid Avatar B', thumb: '/avatars/vrm3.png' },
  { id: 'vrm4', name: 'VRM 4 (Sample E)', url: '/vrm4.vrm', desc: 'Pixiv VRoid Avatar E', thumb: '/avatars/vrm4.png' },
  { id: 'vrm6', name: 'VRM 6 (Sample Y)', url: '/vrm6.vrm', desc: 'Pixiv VRoid Avatar Y', thumb: '/avatars/vrm6.png' },
  { id: 'vrm7', name: 'VRM 7 (Sample K)', url: '/vrm7.vrm', desc: 'Pixiv VRoid Avatar K', thumb: '/avatars/vrm7.png' },
  { id: 'vrm8', name: 'VRM 8 (Sample W)', url: '/vrm8.vrm', desc: 'Pixiv VRoid Avatar W', thumb: '/avatars/vrm8.png' },
  { id: 'vrm9', name: 'VRM 9 (Sample Q)', url: '/vrm9.vrm', desc: 'Pixiv VRoid Avatar Q', thumb: '/avatars/vrm9.png' },
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
