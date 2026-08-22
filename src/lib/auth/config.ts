/**
 * Auth.js (NextAuth v5) configuration.
 *
 * Design notes:
 *  - JWT session strategy: required by the Credentials provider and the right
 *    fit for Vercel Functions (no session round-trip per request).
 *  - No database adapter. OAuth identities are reconciled explicitly in the
 *    `signIn` callback so we control exactly which tokens are stored - we keep
 *    the minimum (provider + account id + granted scopes), not access tokens,
 *    because CareerPilot360 never calls LinkedIn on the user's behalf.
 *  - LinkedIn uses the official OIDC flow. We never ask for a portal password.
 */
import NextAuth, { type NextAuthConfig, type User as AuthUser } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import LinkedIn from 'next-auth/providers/linkedin';
import { and, eq, isNull } from 'drizzle-orm';
import { env, featureFlags } from '@/lib/env';
import { getDb, isDatabaseConfigured, oauthAccounts, users } from '@/lib/db';
import { verifyPassword } from './password';
import { recordAudit } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';

function authSecret(): string {
  const s = env().AUTH_SECRET;
  if (s) return s;
  if (env().NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET must be set in production.');
  }
  console.warn('[auth] AUTH_SECRET is not set - using an insecure development-only fallback.');
  return 'dev-only-insecure-secret-change-me-0123456789';
}

export interface SessionUserShape {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
  onboarded: boolean;
}

const credentialsProvider = Credentials({
  id: 'credentials',
  name: 'Email and password',
  credentials: {
    email: { label: 'Email', type: 'email' },
    password: { label: 'Password', type: 'password' },
  },
  async authorize(raw): Promise<AuthUser | null> {
    const email = String(raw?.email ?? '').trim().toLowerCase();
    const password = String(raw?.password ?? '');
    if (!email || !password) return null;
    if (!isDatabaseConfigured()) throw new Error('DATABASE_NOT_CONFIGURED');

    // Rate limit per email so credential stuffing cannot brute-force one account.
    const rl = await checkRateLimit('login', email);
    if (!rl.allowed) throw new Error('RATE_LIMITED');

    const db = getDb();
    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    const user = rows[0];

    const ok = await verifyPassword(password, user?.passwordHash);
    if (!user || !ok) {
      await recordAudit({ userId: user?.id ?? null, action: 'auth.login_failed', metadata: { email } });
      return null;
    }

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await recordAudit({ userId: user.id, action: 'auth.login', metadata: { method: 'credentials' } });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    };
  },
});

function providers() {
  const list: NextAuthConfig['providers'] = [credentialsProvider];
  if (featureFlags().linkedinOAuth) {
    list.push(
      LinkedIn({
        clientId: env().LINKEDIN_CLIENT_ID!,
        clientSecret: env().LINKEDIN_CLIENT_SECRET!,
        // Minimum scopes for sign-in only. We never request messaging,
        // connections or posting permissions.
        authorization: { params: { scope: 'openid profile email' } },
      }),
    );
  }
  return list;
}

export const authConfig: NextAuthConfig = {
  secret: authSecret(),
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
  pages: { signIn: '/login', error: '/login', newUser: '/onboarding' },
  providers: providers(),
  cookies: {
    sessionToken: {
      name: env().NODE_ENV === 'production' ? '__Secure-careerpilot.session' : 'careerpilot.session',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: env().NODE_ENV === 'production',
      },
    },
  },
  callbacks: {
    /**
     * For OAuth, reconcile the external identity with our own `users` row.
     * Runs before `jwt`, and returning false aborts sign-in.
     */
    async signIn({ user, account, profile }) {
      if (!account || account.provider === 'credentials') return true;
      if (!isDatabaseConfigured()) return false;

      const email = (user.email ?? (profile?.email as string | undefined) ?? '').trim().toLowerCase();
      if (!email) return false;

      const db = getDb();
      const existing = await db
        .select()
        .from(users)
        .where(and(eq(users.email, email), isNull(users.deletedAt)))
        .limit(1);

      let userId = existing[0]?.id;
      if (!userId) {
        const inserted = await db
          .insert(users)
          .values({
            email,
            name: user.name ?? null,
            image: user.image ?? null,
            // The provider asserted the address, so treat it as verified.
            emailVerifiedAt: new Date(),
            lastLoginAt: new Date(),
          })
          .returning({ id: users.id });
        userId = inserted[0]!.id;
        await recordAudit({ userId, action: 'auth.signup', metadata: { method: account.provider } });
      } else {
        await db
          .update(users)
          .set({
            lastLoginAt: new Date(),
            name: existing[0]!.name ?? user.name ?? null,
            image: existing[0]!.image ?? user.image ?? null,
            emailVerifiedAt: existing[0]!.emailVerifiedAt ?? new Date(),
          })
          .where(eq(users.id, userId));
      }

      // Store the identity link and granted scopes only. No access tokens:
      // nothing in CareerPilot360 calls LinkedIn on the user's behalf.
      const link = await db
        .select({ id: oauthAccounts.id })
        .from(oauthAccounts)
        .where(
          and(
            eq(oauthAccounts.provider, account.provider),
            eq(oauthAccounts.providerAccountId, String(account.providerAccountId)),
          ),
        )
        .limit(1);

      if (link[0]) {
        await db
          .update(oauthAccounts)
          .set({ scopes: account.scope ?? null, updatedAt: new Date() })
          .where(eq(oauthAccounts.id, link[0].id));
      } else {
        await db.insert(oauthAccounts).values({
          userId,
          provider: account.provider,
          providerAccountId: String(account.providerAccountId),
          tokenType: account.token_type ?? null,
          scopes: account.scope ?? null,
        });
        await recordAudit({
          userId,
          action: 'auth.oauth_connected',
          entityType: 'oauth_account',
          metadata: { provider: account.provider, scopes: account.scope ?? null },
        });
      }

      await recordAudit({ userId, action: 'auth.login', metadata: { method: account.provider } });
      // Hand our internal id to the jwt callback.
      (user as { id?: string }).id = userId;
      return true;
    },

    async jwt({ token, user, trigger }) {
      if (user) {
        token.sub = (user as { id?: string }).id ?? token.sub;
        token.email = user.email ?? token.email;
        token.name = user.name ?? token.name;
        token.picture = user.image ?? token.picture;
      }

      // Refresh the cheap flags on sign-in and on explicit session updates.
      if ((user || trigger === 'update') && token.sub && isDatabaseConfigured()) {
        const rows = await getDb()
          .select({
            emailVerifiedAt: users.emailVerifiedAt,
            onboardingCompletedAt: users.onboardingCompletedAt,
            deletedAt: users.deletedAt,
            name: users.name,
            image: users.image,
          })
          .from(users)
          .where(eq(users.id, token.sub))
          .limit(1);
        const row = rows[0];
        if (!row || row.deletedAt) return null;
        token.emailVerified = Boolean(row.emailVerifiedAt);
        token.onboarded = Boolean(row.onboardingCompletedAt);
        token.name = row.name ?? token.name;
        token.picture = row.image ?? token.picture;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user && token.sub) {
        const u = session.user as unknown as SessionUserShape;
        u.id = token.sub;
        u.email = (token.email as string) ?? '';
        u.name = (token.name as string) ?? null;
        u.image = (token.picture as string) ?? null;
        u.emailVerified = Boolean(token.emailVerified);
        u.onboarded = Boolean(token.onboarded);
      }
      return session;
    },
  },
  events: {
    async signOut(message) {
      const token = 'token' in message ? message.token : null;
      if (token?.sub) await recordAudit({ userId: token.sub, action: 'auth.logout' });
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
