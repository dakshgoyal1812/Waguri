// AES-256-GCM encryption for api_keys.key_value and messages at rest.
// Format: iv(12) | tag(16) | ciphertext, base64-encoded.
import crypto from 'node:crypto';
import { config } from './config.js';

const MSG_PREFIX = 'enc:v1:';

function getEncryptionKey() {
  if (config.encryptionKey && typeof config.encryptionKey === 'string' && config.encryptionKey.length === 64) {
    try {
      const k = Buffer.from(config.encryptionKey, 'hex');
      if (k.length === 32) return k;
    } catch {
      // fallback below
    }
  }
  // Safe deterministic key derivation for test / dev / fallback environments
  const secret = config.encryptionKey || config.adminToken || 'waguri-aes256gcm-fallback-key-2026';
  return crypto.createHash('sha256').update(secret).digest();
}

function key() {
  if (!config.encryptionKey) {
    return getEncryptionKey();
  }
  const k = Buffer.from(config.encryptionKey, 'hex');
  if (k.length !== 32) return getEncryptionKey();
  return k;
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decryptSecret(enc) {
  const buf = Buffer.from(String(enc), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * Encrypt chat message or memory chunk at rest.
 * Uses AES-256-GCM with fresh random 12-byte IV per record.
 */
export function encryptMessage(plain) {
  if (plain === null || plain === undefined) return plain;
  const str = String(plain);
  // Do not double-encrypt
  if (str.startsWith(MSG_PREFIX)) return str;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(str, 'utf8'), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
  return MSG_PREFIX + payload;
}

/**
 * Decrypt chat message or memory chunk.
 * If data is not encrypted (legacy plain text), returns plain text as-is.
 */
export function decryptMessage(encOrPlain) {
  if (!encOrPlain || typeof encOrPlain !== 'string' || !encOrPlain.startsWith(MSG_PREFIX)) {
    return encOrPlain;
  }
  try {
    const raw = encOrPlain.slice(MSG_PREFIX.length);
    const buf = Buffer.from(raw, 'base64');
    if (buf.length < 28) return encOrPlain; // corrupted envelope
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (err) {
    console.warn('[crypto] Failed to decrypt message payload, returning fallback:', err.message);
    return encOrPlain;
  }
}
