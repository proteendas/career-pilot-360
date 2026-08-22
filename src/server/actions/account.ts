'use server';

/**
 * Account-level server actions: profile updates, verification resend, data
 * export, retention settings and deletion.
 */
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getDb, notifications, profiles, users } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { deleteAccount, exportUserData, issueEmailVerification } from '@/lib/auth/service';
import { recordAudit } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
import { signOut } from '@/lib/auth';
import {
  applicationProfileSchema,
  jobPreferencesSchema,
  personalSchema,
  professionalSchema,
  type FullProfile,
} from '@/lib/profile/types';
import { loadProfile } from '@/lib/profile/service';

export interface ActionResult {
  ok: boolean;
  error?: string;
  notice?: string;
}

/* ------------------------------------------------------------ verification */

export async function resendVerificationAction(): Promise<ActionResult> {
  const user = await requireUser();
  if (user.emailVerified) return { ok: true, notice: 'Your email is already verified.' };

  const rl = await checkRateLimit('passwordReset', `verify:${user.id}`);
  if (!rl.allowed) return { ok: false, error: `Please wait ${rl.retryAfterSeconds}s before requesting another email.` };

  const sent = await issueEmailVerification(user.id, user.email);
  return sent
    ? { ok: true, notice: 'Verification email sent.' }
    : { ok: false, error: 'Could not send the email. Check the server log for the link.' };
}

/* ----------------------------------------------------------------- profile */

const sectionSchemas = {
  personal: personalSchema,
  professional: professionalSchema,
  jobPreferences: jobPreferencesSchema,
  applicationProfile: applicationProfileSchema,
} as const;

export type ProfileSection = keyof typeof sectionSchemas;

export async function getProfileAction(): Promise<FullProfile> {
  const user = await requireUser();
  return loadProfile(user.id);
}

/**
 * Save one section of the profile. Sections are saved independently so a
 * partially-filled profile is never lost, and an invalid field in one block
 * cannot discard another.
 */
export async function updateProfileSectionAction(
  section: ProfileSection,
  raw: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const schema = sectionSchemas[section];
  if (!schema) return { ok: false, error: 'Unknown profile section.' };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? 'Some values were not valid.' };
  }

  const db = getDb();
  const existing = await db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1);

  if (existing[0]) {
    await db
      .update(profiles)
      .set({ [section]: parsed.data, updatedAt: new Date() })
      .where(eq(profiles.userId, user.id));
  } else {
    await db.insert(profiles).values({ userId: user.id, [section]: parsed.data });
  }

  await recordAudit({
    userId: user.id,
    action: 'profile.updated',
    entityType: 'profile',
    entityId: user.id,
    afterSummary: `Updated ${section}`,
    metadata: { section, fields: Object.keys(parsed.data as Record<string, unknown>).length },
  });

  revalidatePath('/profile');
  revalidatePath('/dashboard');
  return { ok: true, notice: 'Saved.' };
}

/** Marks onboarding complete. Called from the final onboarding step. */
export async function completeOnboardingAction(): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();

  await db
    .update(users)
    .set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  await recordAudit({ userId: user.id, action: 'profile.updated', afterSummary: 'Completed onboarding' });
  revalidatePath('/dashboard');
  return { ok: true, notice: 'Onboarding complete.' };
}

/* ------------------------------------------------------------- retention -- */

const retentionSchema = z.object({
  retentionDays: z.number().int().min(0).max(3650).nullable(),
});

export async function updateRetentionAction(raw: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = retentionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Choose a valid retention window.' };

  await getDb()
    .update(users)
    .set({ retentionDays: parsed.data.retentionDays, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  await recordAudit({
    userId: user.id,
    action: 'account.retention_changed',
    metadata: { retentionDays: parsed.data.retentionDays },
  });

  revalidatePath('/settings/security');
  return {
    ok: true,
    notice:
      parsed.data.retentionDays === null
        ? 'Retention set to keep data until you delete it.'
        : `Data older than ${parsed.data.retentionDays} days will be purged by the scheduled cleanup task.`,
  };
}

/* ---------------------------------------------------------------- export -- */

export async function exportDataAction(): Promise<{ ok: true; json: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const rl = await checkRateLimit('aiTask', `export:${user.id}`);
  if (!rl.allowed) return { ok: false, error: 'Please wait a moment before exporting again.' };

  const data = await exportUserData(user.id);
  return { ok: true, json: JSON.stringify(data, null, 2) };
}

/* -------------------------------------------------------------- deletion -- */

const deleteSchema = z.object({
  confirmation: z.string(),
});

/**
 * Irreversible. The UI requires the user to type DELETE and confirm in a
 * dialog that itemises exactly what is removed.
 */
export async function deleteAccountAction(raw: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = deleteSchema.safeParse(raw);
  if (!parsed.success || parsed.data.confirmation.trim() !== 'DELETE') {
    return { ok: false, error: 'Type DELETE exactly to confirm.' };
  }

  await deleteAccount(user.id);
  await signOut({ redirect: false });
  redirect('/?deleted=1');
}

/* --------------------------------------------------------- notifications -- */

export async function markNotificationsReadAction(): Promise<ActionResult> {
  const user = await requireUser();
  await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(eq(notifications.userId, user.id));
  revalidatePath('/dashboard');
  return { ok: true };
}
