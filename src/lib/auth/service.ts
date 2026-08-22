/**
 * Account lifecycle: signup, email verification, password reset, data export
 * and deletion. Server-only.
 *
 * Enumeration policy: every "did that email exist?" path returns the same
 * shape whether or not the account exists.
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import {
  aiProviderKeys,
  applications,
  applicationPackets,
  auditEvents,
  authTokens,
  consents,
  conversations,
  generatedDocuments,
  getDb,
  jobMatches,
  jobs,
  messages,
  oauthAccounts,
  outreachContacts,
  outreachDrafts,
  outreachSends,
  profiles,
  resumeDocuments,
  resumeVersions,
  schedules,
  users,
} from '@/lib/db';
import { hashPassword, assessPassword } from './password';
import { hashToken, randomToken } from '@/lib/crypto';
import { recordAudit } from '@/lib/audit';
import { isValidEmail, sendPasswordResetEmail, sendVerificationEmail } from '@/lib/email';
import { publicEnv } from '@/lib/env';
import { getStorage } from '@/lib/storage';

export const CONSENT_VERSION = '2026-08-01';

export interface SignupInput {
  email: string;
  password: string;
  name: string;
  acceptedTerms: boolean;
}

export type SignupResult =
  | { ok: true; userId: string; verificationSent: boolean }
  | { ok: false; error: string; field?: 'email' | 'password' | 'name' | 'acceptedTerms' };

export async function signupWithPassword(input: SignupInput): Promise<SignupResult> {
  const email = (input.email ?? '').trim().toLowerCase();
  const name = (input.name ?? '').trim().slice(0, 120);

  if (!isValidEmail(email)) return { ok: false, error: 'Enter a valid email address.', field: 'email' };
  if (!name) return { ok: false, error: 'Tell us your name.', field: 'name' };
  if (!input.acceptedTerms) {
    return { ok: false, error: 'You must accept the Terms and Privacy Policy.', field: 'acceptedTerms' };
  }

  const strength = assessPassword(input.password, { email, name });
  if (!strength.ok) return { ok: false, error: strength.problems[0]!, field: 'password' };

  const db = getDb();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) {
    // Do not confirm that the address is taken.
    return { ok: false, error: 'That email cannot be used to sign up. Try signing in instead.', field: 'email' };
  }

  const passwordHash = await hashPassword(input.password);
  const inserted = await db.insert(users).values({ email, name, passwordHash }).returning({ id: users.id });
  const userId = inserted[0]!.id;

  await db.insert(profiles).values({
    userId,
    personal: { fullName: name, email },
    professional: {},
    jobPreferences: {},
    applicationProfile: {},
  });

  await db.insert(consents).values([
    { userId, consentType: 'terms_of_service', version: CONSENT_VERSION, acceptedAt: new Date() },
    { userId, consentType: 'privacy_policy', version: CONSENT_VERSION, acceptedAt: new Date() },
    { userId, consentType: 'ai_human_review', version: CONSENT_VERSION, acceptedAt: new Date() },
  ]);

  await recordAudit({ userId, action: 'auth.signup', metadata: { method: 'credentials' } });
  await recordAudit({
    userId,
    action: 'consent.accepted',
    metadata: { version: CONSENT_VERSION, types: ['terms_of_service', 'privacy_policy', 'ai_human_review'] },
  });

  const sent = await issueEmailVerification(userId, email);
  return { ok: true, userId, verificationSent: sent };
}

/* ------------------------------------------------------ email verification */

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

async function createToken(userId: string, purpose: string, ttlMs: number): Promise<string> {
  const db = getDb();
  const token = randomToken(32);
  await db.insert(authTokens).values({
    userId,
    purpose,
    tokenHash: await hashToken(token),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return token;
}

export async function issueEmailVerification(userId: string, email: string): Promise<boolean> {
  const token = await createToken(userId, 'email_verification', VERIFICATION_TTL_MS);
  const url = `${publicEnv.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  const res = await sendVerificationEmail(email, url);
  return res.ok;
}

export async function verifyEmailToken(token: string): Promise<{ ok: boolean; error?: string }> {
  if (!token) return { ok: false, error: 'This verification link is not valid.' };
  const db = getDb();
  const hash = await hashToken(token);
  const rows = await db
    .select()
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, hash),
        eq(authTokens.purpose, 'email_verification'),
        isNull(authTokens.consumedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: 'This verification link has expired or has already been used.' };

  await db.update(authTokens).set({ consumedAt: new Date() }).where(eq(authTokens.id, row.id));
  await db.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, row.userId));
  await recordAudit({ userId: row.userId, action: 'auth.email_verified' });
  return { ok: true };
}

/* -------------------------------------------------------- password reset -- */

/** Always resolves the same way, whether or not the address is registered. */
export async function requestPasswordReset(emailRaw: string): Promise<{ ok: true }> {
  const email = (emailRaw ?? '').trim().toLowerCase();
  if (!isValidEmail(email)) return { ok: true };

  const db = getDb();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  const user = rows[0];
  if (!user) return { ok: true };

  const token = await createToken(user.id, 'password_reset', RESET_TTL_MS);
  const url = `${publicEnv.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  await sendPasswordResetEmail(email, url);
  await recordAudit({ userId: user.id, action: 'auth.password_reset_requested' });
  return { ok: true };
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!token) return { ok: false, error: 'This reset link is not valid.' };
  const db = getDb();
  const hash = await hashToken(token);
  const rows = await db
    .select()
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, hash),
        eq(authTokens.purpose, 'password_reset'),
        isNull(authTokens.consumedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: 'This reset link has expired or has already been used.' };

  const userRows = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, row.userId)).limit(1);
  const strength = assessPassword(newPassword, {
    email: userRows[0]?.email ?? '',
    name: userRows[0]?.name ?? '',
  });
  if (!strength.ok) return { ok: false, error: strength.problems[0]! };

  await db.update(authTokens).set({ consumedAt: new Date() }).where(eq(authTokens.id, row.id));
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(users.id, row.userId));
  await recordAudit({ userId: row.userId, action: 'auth.password_reset_completed' });
  return { ok: true };
}

/* ------------------------------------------------------------ GDPR/DPDP -- */

/**
 * Full personal-data export. Everything the user owns, as plain JSON.
 * Provider API keys are deliberately excluded - only the masked preview is
 * included, because the plaintext must never leave the encryption boundary.
 */
export async function exportUserData(userId: string): Promise<Record<string, unknown>> {
  const db = getDb();
  const [
    user,
    profile,
    documents,
    versions,
    userJobs,
    matches,
    packets,
    apps,
    contacts,
    drafts,
    sends,
    userSchedules,
    keys,
    convos,
    msgs,
    audits,
    userConsents,
    oauth,
    docs,
  ] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    db.select().from(profiles).where(eq(profiles.userId, userId)),
    db.select().from(resumeDocuments).where(eq(resumeDocuments.userId, userId)),
    db.select().from(resumeVersions).where(eq(resumeVersions.userId, userId)),
    db.select().from(jobs).where(eq(jobs.ownerUserId, userId)),
    db.select().from(jobMatches).where(eq(jobMatches.userId, userId)),
    db.select().from(applicationPackets).where(eq(applicationPackets.userId, userId)),
    db.select().from(applications).where(eq(applications.userId, userId)),
    db.select().from(outreachContacts).where(eq(outreachContacts.userId, userId)),
    db.select().from(outreachDrafts).where(eq(outreachDrafts.userId, userId)),
    db.select().from(outreachSends).where(eq(outreachSends.userId, userId)),
    db.select().from(schedules).where(eq(schedules.userId, userId)),
    db.select().from(aiProviderKeys).where(eq(aiProviderKeys.userId, userId)),
    db.select().from(conversations).where(eq(conversations.userId, userId)),
    db.select().from(messages).where(eq(messages.userId, userId)),
    db.select().from(auditEvents).where(eq(auditEvents.userId, userId)),
    db.select().from(consents).where(eq(consents.userId, userId)),
    db.select().from(oauthAccounts).where(eq(oauthAccounts.userId, userId)),
    db.select().from(generatedDocuments).where(eq(generatedDocuments.userId, userId)),
  ]);

  const u = user[0];
  await recordAudit({ userId, action: 'account.data_exported' });

  return {
    exportedAt: new Date().toISOString(),
    format: 'careerpilot360.export.v1',
    notice:
      'AI provider API keys are excluded by design: they are stored encrypted and are never decrypted for export. ' +
      'Only the masked preview is shown.',
    account: u
      ? {
          id: u.id,
          email: u.email,
          name: u.name,
          image: u.image,
          emailVerifiedAt: u.emailVerifiedAt,
          onboardingCompletedAt: u.onboardingCompletedAt,
          retentionDays: u.retentionDays,
          createdAt: u.createdAt,
        }
      : null,
    oauthConnections: oauth.map((o) => ({
      provider: o.provider,
      scopes: o.scopes,
      connectedAt: o.createdAt,
    })),
    profile: profile[0] ?? null,
    consents: userConsents,
    resumeDocuments: documents.map((d) => ({ ...d, blobPath: '[stored privately]' })),
    resumeVersions: versions.map((v) => ({ ...v, pdfBlobPath: v.pdfBlobPath ? '[stored privately]' : null })),
    generatedDocuments: docs.map((d) => ({ ...d, blobPath: '[stored privately]' })),
    importedJobs: userJobs,
    jobMatches: matches,
    applicationPackets: packets,
    applications: apps,
    outreachContacts: contacts,
    outreachDrafts: drafts,
    outreachSends: sends,
    schedules: userSchedules,
    aiProviders: keys.map((k) => ({
      provider: k.provider,
      maskedKey: k.maskedKey,
      defaultModel: k.defaultModel,
      enabled: k.enabled,
      createdAt: k.createdAt,
    })),
    conversations: convos,
    messages: msgs,
    auditEvents: audits,
  };
}

/**
 * Hard-delete the account.
 *
 * Stored documents are removed from the storage driver first, then the `users`
 * row is deleted; every user-owned table cascades from it. One audit row is
 * written with a null user id so the deletion itself remains provable.
 */
export async function deleteAccount(userId: string): Promise<{ ok: true; deletedObjects: number }> {
  const db = getDb();
  const storage = getStorage();

  const [documents, versions, docs] = await Promise.all([
    db.select({ blobPath: resumeDocuments.blobPath }).from(resumeDocuments).where(eq(resumeDocuments.userId, userId)),
    db.select({ blobPath: resumeVersions.pdfBlobPath }).from(resumeVersions).where(eq(resumeVersions.userId, userId)),
    db.select({ blobPath: generatedDocuments.blobPath }).from(generatedDocuments).where(eq(generatedDocuments.userId, userId)),
  ]);

  const paths = [...documents, ...versions, ...docs].map((r) => r.blobPath).filter((p): p is string => Boolean(p));
  let deletedObjects = 0;
  for (const p of paths) {
    try {
      await storage.remove(p);
      deletedObjects += 1;
    } catch (err) {
      console.error('[account-delete] could not remove object', err instanceof Error ? err.message : err);
    }
  }

  await db.delete(users).where(eq(users.id, userId));

  // userId is intentionally null: the row it referenced no longer exists.
  await recordAudit({
    userId: null,
    actorType: 'system',
    action: 'account.deleted',
    entityType: 'user',
    entityId: userId,
    metadata: { deletedObjects, tables: 'all user-owned rows cascaded' },
  });

  return { ok: true, deletedObjects };
}
