/**
 * Session guards. Every authenticated route handler, server action and page
 * starts with one of these; they are the only sanctioned way to learn who the
 * caller is.
 */
import { redirect } from 'next/navigation';
import { auth } from './config';

export interface AuthedUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
  onboarded: boolean;
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = 'You must be signed in to do that.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/** Returns the session user, or null. Never redirects. */
export async function getCurrentUser(): Promise<AuthedUser | null> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id) return null;
  return {
    id: u.id,
    email: u.email ?? '',
    name: u.name ?? null,
    image: u.image ?? null,
    emailVerified: Boolean(u.emailVerified),
    onboarded: Boolean(u.onboarded),
  };
}

/** For route handlers and server actions: throws instead of redirecting. */
export async function requireUser(): Promise<AuthedUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** For pages: redirects to /login preserving the intended destination. */
export async function requireUserPage(returnTo?: string): Promise<AuthedUser> {
  const user = await getCurrentUser();
  if (!user) {
    const qs = returnTo ? `?next=${encodeURIComponent(returnTo)}` : '';
    redirect(`/login${qs}`);
  }
  return user;
}

/**
 * Pages inside the product shell: signed in AND past onboarding.
 * Onboarding itself uses `requireUserPage` so it stays reachable.
 */
export async function requireOnboardedUser(returnTo?: string): Promise<AuthedUser> {
  const user = await requireUserPage(returnTo);
  if (!user.onboarded) redirect('/onboarding');
  return user;
}
