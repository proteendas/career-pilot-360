'use server';

/**
 * Authentication server actions.
 *
 * Every action returns a plain serialisable result rather than throwing, so the
 * client can render an inline error without a boundary. Rate limits are applied
 * before any database work.
 */
import { AuthError } from 'next-auth';
import { headers } from 'next/headers';
import { z } from 'zod';
import { signIn, signOut } from '@/lib/auth';
import {
  requestPasswordReset,
  resetPassword,
  signupWithPassword,
  verifyEmailToken,
} from '@/lib/auth/service';
import { checkRateLimit } from '@/lib/rate-limit';
import { isDatabaseConfigured } from '@/lib/db';
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/password';

export interface ActionResult {
  ok: boolean;
  error?: string;
  field?: string;
  /** Set when the action succeeded but the UI should show a follow-up message. */
  notice?: string;
}

/** Best-effort client identifier for rate limiting. */
async function clientKey(): Promise<string> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  return (fwd?.split(',')[0] ?? h.get('x-real-ip') ?? 'unknown').trim();
}

const DB_MISSING =
  'The database is not configured yet. Set DATABASE_URL in your environment and run `npm run db:migrate`.';

/* ------------------------------------------------------------------ signup */

const signupSchema = z.object({
  name: z.string().trim().min(1, 'Tell us your name.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`).max(200),
  acceptedTerms: z.literal(true, { message: 'You must accept the Terms and Privacy Policy.' }),
});

export async function signupAction(raw: unknown): Promise<ActionResult> {
  if (!isDatabaseConfigured()) return { ok: false, error: DB_MISSING };

  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? 'Check the form and try again.', field: String(first?.path[0] ?? '') };
  }

  const rl = await checkRateLimit('signup', await clientKey());
  if (!rl.allowed) {
    return { ok: false, error: `Too many sign-up attempts. Try again in ${rl.retryAfterSeconds}s.` };
  }

  const result = await signupWithPassword({
    name: parsed.data.name,
    email: parsed.data.email,
    password: parsed.data.password,
    acceptedTerms: parsed.data.acceptedTerms,
  });

  if (!result.ok) return { ok: false, error: result.error, field: result.field };

  return {
    ok: true,
    notice: result.verificationSent
      ? 'Account created. Check your email for the verification link.'
      : 'Account created. We could not send the verification email — check the server log for the link.',
  };
}

/* ------------------------------------------------------------------- login */

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
  next: z.string().optional(),
});

export async function loginAction(raw: unknown): Promise<ActionResult> {
  if (!isDatabaseConfigured()) return { ok: false, error: DB_MISSING };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? 'Check the form.', field: String(first?.path[0] ?? '') };
  }

  try {
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthError) {
      const cause = (err.cause as { err?: Error } | undefined)?.err?.message ?? err.message;
      if (cause.includes('RATE_LIMITED')) {
        return { ok: false, error: 'Too many attempts for this account. Please wait a few minutes.' };
      }
      if (cause.includes('DATABASE_NOT_CONFIGURED')) return { ok: false, error: DB_MISSING };
      // Deliberately identical for "no such user" and "wrong password".
      return { ok: false, error: 'That email and password combination is not correct.' };
    }
    throw err;
  }
}

export async function loginWithLinkedInAction(next?: string): Promise<void> {
  await signIn('linkedin', { redirectTo: next && next.startsWith('/') ? next : '/dashboard' });
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: '/' });
}

/* --------------------------------------------------------- password reset */

const emailOnly = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email address.') });

export async function requestPasswordResetAction(raw: unknown): Promise<ActionResult> {
  if (!isDatabaseConfigured()) return { ok: false, error: DB_MISSING };

  const parsed = emailOnly.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Enter a valid email address.', field: 'email' };

  const rl = await checkRateLimit('passwordReset', await clientKey());
  if (!rl.allowed) return { ok: false, error: `Too many requests. Try again in ${rl.retryAfterSeconds}s.` };

  await requestPasswordReset(parsed.data.email);
  // Always the same answer, whether or not the address is registered.
  return {
    ok: true,
    notice: 'If an account exists for that address, a reset link is on its way. The link expires in 60 minutes.',
  };
}

const resetSchema = z
  .object({
    token: z.string().min(1, 'This reset link is not valid.'),
    password: z.string().min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`).max(200),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Both passwords must match.',
    path: ['confirmPassword'],
  });

export async function resetPasswordAction(raw: unknown): Promise<ActionResult> {
  if (!isDatabaseConfigured()) return { ok: false, error: DB_MISSING };

  const parsed = resetSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? 'Check the form.', field: String(first?.path[0] ?? '') };
  }

  const res = await resetPassword(parsed.data.token, parsed.data.password);
  if (!res.ok) return { ok: false, error: res.error ?? 'Could not reset the password.' };
  return { ok: true, notice: 'Password updated. You can sign in now.' };
}

/* ------------------------------------------------------ email verification */

export async function verifyEmailAction(token: string): Promise<ActionResult> {
  if (!isDatabaseConfigured()) return { ok: false, error: DB_MISSING };
  const res = await verifyEmailToken(token);
  if (!res.ok) return { ok: false, error: res.error ?? 'Could not verify this link.' };
  return { ok: true, notice: 'Your email address is verified.' };
}
