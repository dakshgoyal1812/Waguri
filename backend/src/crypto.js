// AES-256-GCM encryption for api_keys.key_value (PRD section 7: key_value is
// stored encrypted). Format: iv(12) | tag(16) | ciphertext, base64-encoded.
import crypto from 'node:crypto';
import { config } from './config.js';

function key() {
  if (!config.encryptionKey) {
    throw new Error('APP_ENCRYPTION_KEY is not set (32-byte hex). Required to store api_keys.');
  }
  const k = Buffer.from(config.encryptionKey, 'hex');
  if (k.length !== 32) throw new Error('APP_ENCRYPTION_KEY must decode to 32 bytes (64 hex chars)');
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
