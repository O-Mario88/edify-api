import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptField, decryptField, isEncrypted, encryptNullable, decryptNullable } from './field-crypto';

beforeAll(() => {
  process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString('hex');
});

describe('field-crypto (AES-256-GCM)', () => {
  it('round-trips a value', () => {
    const enc = encryptField('NETSUITE-998877');
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain('NETSUITE-998877');
    expect(decryptField(enc)).toBe('NETSUITE-998877');
  });

  it('produces a fresh ciphertext each time (random IV)', () => {
    expect(encryptField('same')).not.toBe(encryptField('same'));
  });

  it('detects tampering (auth tag)', () => {
    const enc = encryptField('secret');
    const parts = enc.split(':');
    parts[3] = Buffer.from('tampered-bytes').toString('base64');
    expect(() => decryptField(parts.join(':'))).toThrow();
  });

  it('tolerates legacy plaintext on decrypt (migration-safe)', () => {
    expect(decryptField('plain-legacy')).toBe('plain-legacy');
  });

  it('nullable helpers pass null/empty through', () => {
    expect(encryptNullable(null)).toBeNull();
    expect(encryptNullable('')).toBeNull();
    expect(decryptNullable(null)).toBeNull();
    const enc = encryptNullable('x');
    expect(decryptNullable(enc)).toBe('x');
  });
});
