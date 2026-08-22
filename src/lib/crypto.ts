/**
 * Authenticated encryption for user-supplied AI provider keys. Server-only.
 *
 * Envelope format:  `v1.<iv-b64url>.<ciphertext-b64url>.<tag-b64url>`
 *
 * Key rotation: `ENCRYPTION_KEY` may hold several comma-separated keys. The
 * FIRST is used to encrypt; every key is tried when decrypting, so you can add
 * a new key, re-encrypt in the background, then drop the old one - without
 * downtime and without ever storing a plaintext key.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';

export class EncryptionNotConfiguredError extends Error {
  constructor() {
    super(
      'ENCRYPTION_KEY is not set. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
    this.name = 'EncryptionNotConfiguredError';
  }
}

export class DecryptionError extends Error {
  constructor(message = 'Stored value could not be decrypted with any configured key.') {
    super(message);
    this.name = 'DecryptionError';
  }
}

/** Parse a single key (base64 or hex) into exactly 32 bytes. */
function parseKey(raw: string): Buffer {
  const s = raw.trim();
  if (!s) throw new EncryptionNotConfiguredError();
  if (/^[0-9a-f]{64}$/i.test(s)) return Buffer.from(s, 'hex');
  const buf = Buffer.from(s, 'base64');
  if (buf.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes (base64 of 32 random bytes, or 64 hex chars).');
  }
  return buf;
}

function keyRing(): Buffer[] {
  const raw = env().ENCRYPTION_KEY;
  if (!raw) throw new EncryptionNotConfiguredError();
  const keys = raw.split(',').map((k) => k.trim()).filter(Boolean).map(parseKey);
  if (keys.length === 0) throw new EncryptionNotConfiguredError();
  return keys;
}

export function isEncryptionConfigured(): boolean {
  try {
    keyRing();
    return true;
  } catch {
    return false;
  }
}

const b64u = (b: Buffer) => b.toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');

/** Encrypt a secret with the active (first) key. */
export function encryptSecret(plaintext: string, aad = 'careerpilot360:provider-key'): string {
  const key = keyRing()[0]!;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64u(iv), b64u(ct), b64u(tag)].join('.');
}

/** Decrypt an envelope, trying every configured key (supports rotation). */
export function decryptSecret(envelope: string, aad = 'careerpilot360:provider-key'): string {
  const parts = (envelope ?? '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new DecryptionError('Unrecognised ciphertext envelope.');
  const [, ivB64, ctB64, tagB64] = parts as [string, string, string, string];
  const iv = fromB64u(ivB64);
  const ct = fromB64u(ctB64);
  const tag = fromB64u(tagB64);

  for (const key of keyRing()) {
    try {
      const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    } catch {
      // try the next key in the ring
    }
  }
  throw new DecryptionError();
}

/** True when `envelope` was produced by the CURRENT active key. */
export function isEncryptedWithActiveKey(envelope: string, aad = 'careerpilot360:provider-key'): boolean {
  const parts = (envelope ?? '').split('.');
  if (parts.length !== 4) return false;
  const key = keyRing()[0]!;
  try {
    const decipher = createDecipheriv(ALGO, key, fromB64u(parts[1]!), { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(fromB64u(parts[3]!));
    decipher.update(fromB64u(parts[2]!));
    decipher.final();
    return true;
  } catch {
    return false;
  }
}

/** Hash a token (email verification, password reset) for storage at rest. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token) as unknown as ArrayBuffer);
  return Buffer.from(digest).toString('hex');
}

/** Cryptographically random, URL-safe token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Non-reversible hash of an IP address for audit logs (PII minimisation). */
export async function hashIp(ip: string | null | undefined): Promise<string | null> {
  if (!ip) return null;
  const salt = env().AUTH_SECRET ?? 'careerpilot360';
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${salt}:${ip}`) as unknown as ArrayBuffer,
  );
  return Buffer.from(digest).toString('hex').slice(0, 32);
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a ?? '', 'utf8');
  const bb = Buffer.from(b ?? '', 'utf8');
  if (ab.length !== bb.length) return false;
  return nodeTimingSafeEqual(ab, bb);
}
