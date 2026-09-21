// Avatar (VRM) registry.
//
// Bundled avatars ship in /public and are referenced by URL; user-added .vrm
// files are 10-100MB binaries that blow past localStorage limits, so they
// persist as Blobs in IndexedDB and are served to three.js via object URLs.
const DB_NAME = 'waguri-avatars';
const DB_VERSION = 1;
const STORE = 'vrms';

export const BUNDLED_AVATARS = [
  { id: 'waguri', name: 'Waguri', url: '/waguri.vrm', desc: 'Default companion' },
  { id: 'zero', name: 'Zero', url: '/Zero.vrm', desc: 'Bundled VRoid avatar' },
];

export const DEFAULT_VRM_URL = '/waguri.vrm';

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
  const meta = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name.replace(/\.vrm$/i, ''),
    size: file.size,
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
