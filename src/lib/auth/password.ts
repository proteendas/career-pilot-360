/**
 * Password hashing.
 *
 * bcryptjs is chosen over a native argon2 binding deliberately: it is pure
 * JavaScript, so it needs no platform-specific binary and runs identically in
 * local dev, Vercel Functions and CI. Cost factor 12 (~250ms) is the current
 * OWASP-aligned setting; raise `BCRYPT_COST` and existing hashes keep working
 * because the cost is embedded in each hash.
 */
import bcrypt from 'bcryptjs';

export const BCRYPT_COST = 12;

/** Minimum policy. Deliberately length-first rather than symbol-soup. */
export const PASSWORD_MIN_LENGTH = 10;

export interface PasswordStrength {
  ok: boolean;
  score: 0 | 1 | 2 | 3 | 4;
  problems: string[];
}

const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', 'qwerty123',
  'letmein123', 'welcome123', 'iloveyou', 'admin123', 'careerpilot', 'changeme',
]);

export function assessPassword(password: string, context: { email?: string; name?: string } = {}): PasswordStrength {
  const pw = password ?? '';
  const problems: string[] = [];

  if (pw.length < PASSWORD_MIN_LENGTH) problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (pw.length > 200) problems.push('Passwords must be 200 characters or fewer.');
  if (COMMON.has(pw.toLowerCase())) problems.push('That password is too common.');
  if (/^(.)\1+$/.test(pw)) problems.push('Avoid repeating a single character.');

  // Compare against a punctuation-stripped form, so "priya-sharma-1" is caught
  // just as "priyasharma1" would be. Checking the raw string alone lets any
  // separator defeat the rule.
  const flattened = pw.toLowerCase().replace(/[^a-z0-9]/g, '');

  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length > 2) {
    const flatLocal = local.replace(/[^a-z0-9]/g, '');
    if (pw.toLowerCase().includes(local) || (flatLocal.length > 2 && flattened.includes(flatLocal))) {
      problems.push('Do not include your email address in your password.');
    }
  }

  // Each name token is checked separately: a password containing just the
  // surname is as guessable as one containing the full name.
  if (context.name) {
    const tokens = context.name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2);
    if (tokens.some((t) => flattened.includes(t))) {
      problems.push('Do not include your name in your password.');
    }
  }

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length < 14 && classes < 2) problems.push('Mix letters with numbers or symbols, or use a longer passphrase.');

  const lengthPoints = pw.length >= 20 ? 3 : pw.length >= 14 ? 2 : pw.length >= PASSWORD_MIN_LENGTH ? 1 : 0;
  const raw = Math.min(4, lengthPoints + Math.max(0, classes - 1));
  const score = (problems.length > 0 ? Math.min(raw, 1) : raw) as PasswordStrength['score'];

  return { ok: problems.length === 0, score, problems };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    // Still burn comparable time so a missing-password account is not detectable
    // by response timing.
    await bcrypt.compare(password ?? '', '$2a$12$0000000000000000000000000000000000000000000000000000');
    return false;
  }
  try {
    return await bcrypt.compare(password ?? '', hash);
  } catch {
    return false;
  }
}
