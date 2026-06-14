import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Field-level encryption for Restricted / Highly-Restricted values stored at
// rest (spec §10): Netsuite IDs, MFA secrets, password-reset tokens, partner
// payment metadata. AES-256-GCM (authenticated) — tampering is detectable on
// decrypt. No external dependency (node:crypto).
//
// Key: FIELD_ENCRYPTION_KEY = 32 bytes, hex (64 chars) or base64. Keep it in the
// secret manager, SEPARATE from the database. Rotate by decrypting with the old
// key and re-encrypting with the new (out-of-band migration).
//
// Stored format:  v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';

function loadKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) throw new Error('FIELD_ENCRYPTION_KEY is not set — cannot encrypt/decrypt restricted fields.');
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64).');
  return key;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}:`);
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12); // 96-bit nonce for GCM
  const cipher = createCipheriv(ALGO, loadKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptField(stored: string): string {
  if (!isEncrypted(stored)) return stored; // tolerate legacy plaintext during migration
  const [, ivB64, tagB64, ctB64] = stored.split(':');
  const decipher = createDecipheriv(ALGO, loadKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

// Optional helpers for nullable columns.
export const encryptNullable = (v?: string | null): string | null => (v == null || v === '' ? null : encryptField(v));
export const decryptNullable = (v?: string | null): string | null => (v == null ? null : decryptField(v));
