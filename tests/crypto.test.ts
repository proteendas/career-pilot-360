import { afterEach, describe, expect, it } from 'vitest';
import {
  DecryptionError,
  decryptSecret,
  encryptSecret,
  hashToken,
  isEncryptedWithActiveKey,
  randomToken,
} from '@/lib/crypto';
import { __resetEnvCache } from '@/lib/env';

const KEY_A = Buffer.alloc(32, 7).toString('base64');
const KEY_B = Buffer.alloc(32, 9).toString('base64');
const original = process.env.ENCRYPTION_KEY;

function useKeys(...keys: string[]) {
  process.env.ENCRYPTION_KEY = keys.join(',');
  __resetEnvCache();
}

afterEach(() => {
  process.env.ENCRYPTION_KEY = original;
  __resetEnvCache();
});

describe('provider key encryption', () => {
  it('round-trips a secret', () => {
    useKeys(KEY_A);
    const secret = 'sk-proj-abcdef1234567890';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    useKeys(KEY_A);
    const a = encryptSecret('same-secret');
    const b = encryptSecret('same-secret');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('uses a versioned four-part envelope', () => {
    useKeys(KEY_A);
    const parts = encryptSecret('x').split('.');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
  });

  it('never leaves the plaintext visible in the envelope', () => {
    useKeys(KEY_A);
    const secret = 'sk-live-DO-NOT-LEAK-42';
    expect(encryptSecret(secret)).not.toContain('DO-NOT-LEAK');
  });

  it('detects tampering with the ciphertext', () => {
    useKeys(KEY_A);
    const env = encryptSecret('sensitive');
    const parts = env.split('.');
    // Flip a character in the ciphertext segment.
    const ct = parts[2]!;
    parts[2] = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1);
    expect(() => decryptSecret(parts.join('.'))).toThrow(DecryptionError);
  });

  it('detects tampering with the auth tag', () => {
    useKeys(KEY_A);
    const parts = encryptSecret('sensitive').split('.');
    const tag = parts[3]!;
    parts[3] = (tag[0] === 'A' ? 'B' : 'A') + tag.slice(1);
    expect(() => decryptSecret(parts.join('.'))).toThrow(DecryptionError);
  });

  it('rejects an envelope encrypted under an unrelated key', () => {
    useKeys(KEY_A);
    const env = encryptSecret('sensitive');
    useKeys(KEY_B);
    expect(() => decryptSecret(env)).toThrow(DecryptionError);
  });

  it('rejects a malformed envelope', () => {
    useKeys(KEY_A);
    expect(() => decryptSecret('nonsense')).toThrow(DecryptionError);
    expect(() => decryptSecret('v2.a.b.c')).toThrow(DecryptionError);
  });

  it('refuses to decrypt with a different AAD than it was sealed with', () => {
    useKeys(KEY_A);
    const env = encryptSecret('sensitive', 'purpose:a');
    expect(() => decryptSecret(env, 'purpose:b')).toThrow(DecryptionError);
    expect(decryptSecret(env, 'purpose:a')).toBe('sensitive');
  });

  it('rejects a key that does not decode to 32 bytes', () => {
    useKeys(Buffer.alloc(16, 1).toString('base64'));
    expect(() => encryptSecret('x')).toThrow(/32 bytes/);
  });

  it('accepts a 64-character hex key as well as base64', () => {
    useKeys('a'.repeat(64));
    expect(decryptSecret(encryptSecret('hex-key-secret'))).toBe('hex-key-secret');
  });
});

describe('key rotation', () => {
  it('decrypts old ciphertext after a new key is prepended', () => {
    useKeys(KEY_A);
    const sealedWithOld = encryptSecret('legacy-secret');

    // Operator adds a new key first, keeps the old one for decrypt-only.
    useKeys(KEY_B, KEY_A);
    expect(decryptSecret(sealedWithOld)).toBe('legacy-secret');
  });

  it('encrypts new secrets with the first key only', () => {
    useKeys(KEY_B, KEY_A);
    const fresh = encryptSecret('new-secret');

    // Dropping the retired key must not break the freshly-sealed value.
    useKeys(KEY_B);
    expect(decryptSecret(fresh)).toBe('new-secret');
  });

  it('reports which envelopes still need re-encryption', () => {
    useKeys(KEY_A);
    const old = encryptSecret('legacy');

    useKeys(KEY_B, KEY_A);
    const fresh = encryptSecret('current');

    expect(isEncryptedWithActiveKey(old)).toBe(false);
    expect(isEncryptedWithActiveKey(fresh)).toBe(true);
  });
});

describe('tokens', () => {
  it('hashes a token to a stable hex digest', async () => {
    const a = await hashToken('abc');
    const b = await hashToken('abc');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('abc');
  });

  it('generates unique URL-safe tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken(32)));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
