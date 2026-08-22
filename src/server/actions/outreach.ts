'use server';

/**
 * Outreach server actions.
 *
 * Sending is the one true side effect in this module. Every send action
 * requires `confirmed: true` from the caller — a confirmation dialog the user
 * has already seen — and nothing here infers consent from any other call.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { enforceRateLimit, RateLimitError } from '@/lib/rate-limit';
import { NotFoundError } from '@/lib/db/tenant';
import { AiError } from '@/lib/ai/types';
import { canSendRealEmail } from '@/lib/email';
import { publicEnv } from '@/lib/env';
import { loadProfile } from '@/lib/profile/service';
import { getDefaultVersion, getStructured } from '@/lib/resume/service';
import { getJob } from '@/lib/jobs/service';
import {
  ContactValidationError,
  createContact,
  deleteContact,
  isSuppressed,
  suppressEmail,
  unsuppressEmail,
  updateContact,
} from '@/lib/outreach/contacts';
import { createDraft, generateDraftContent, updateDraft } from '@/lib/outreach/drafts';
import { buildSendPreview, OutreachSendError, sendOutreachEmail, sendsToday } from '@/lib/outreach/send';
import { aiAvailability } from '@/lib/ai/client';
import { RATE_LIMITS } from '@/lib/rate-limit';

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  notice?: string;
  data?: T;
}

function toResult(err: unknown): ActionResult<never> {
  if (err instanceof RateLimitError) {
    return { ok: false, error: `Too many requests. Try again in ${err.retryAfterSeconds}s.` };
  }
  if (err instanceof NotFoundError) return { ok: false, error: err.message };
  if (err instanceof ContactValidationError) return { ok: false, error: err.message };
  if (err instanceof OutreachSendError) return { ok: false, error: err.message };
  if (err instanceof AiError) return { ok: false, error: err.message };
  console.error('[outreach-action] unexpected failure', err);
  return { ok: false, error: 'Something went wrong. Please try again.' };
}

/* ---------------------------------------------------------------- contacts */

const createContactSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(160),
  title: z.string().max(160).optional(),
  company: z.string().max(160).optional(),
  email: z.string().max(254).optional(),
  linkedinUrl: z.string().max(2048).optional(),
  source: z.enum(['user_provided', 'public_company_page', 'authorized_api', 'manual']),
  provenance: z.string().trim().min(1, 'Say where this contact came from.').max(300),
  notes: z.string().max(1000).optional(),
});

export async function createContactAction(raw: unknown): Promise<ActionResult<{ contactId: string }>> {
  try {
    const user = await requireUser();
    const parsed = createContactSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };

    const contactId = await createContact(user.id, parsed.data as Parameters<typeof createContact>[1]);
    revalidatePath('/outreach');
    return { ok: true, notice: 'Contact saved.', data: { contactId } };
  } catch (err) {
    return toResult(err);
  }
}

const updateContactSchema = z.object({
  contactId: z.string().uuid(),
  name: z.string().max(160).optional(),
  title: z.string().max(160).optional(),
  company: z.string().max(160).optional(),
  email: z.string().max(254).optional(),
  linkedinUrl: z.string().max(2048).optional(),
  notes: z.string().max(1000).optional(),
});

export async function updateContactAction(raw: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = updateContactSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'Those edits could not be understood.' };
    const { contactId, ...patch } = parsed.data;
    await updateContact(user.id, contactId, patch);
    revalidatePath('/outreach');
    return { ok: true, notice: 'Saved.' };
  } catch (err) {
    return toResult(err);
  }
}

export async function deleteContactAction(contactId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await deleteContact(user.id, contactId);
    revalidatePath('/outreach');
    return { ok: true, notice: 'Contact removed.' };
  } catch (err) {
    return toResult(err);
  }
}

/* ------------------------------------------------------------- suppression */

export async function suppressEmailAction(email: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await suppressEmail(user.id, email);
    revalidatePath('/outreach');
    return { ok: true, notice: `${email} will never be emailed by this account again.` };
  } catch (err) {
    return toResult(err);
  }
}

export async function unsuppressEmailAction(email: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await unsuppressEmail(user.id, email);
    revalidatePath('/outreach');
    return { ok: true, notice: 'Removed from the stop-contact list.' };
  } catch (err) {
    return toResult(err);
  }
}

/* ------------------------------------------------------------------ drafts */

export interface DraftPayload {
  draftId: string;
  usedAi: boolean;
  rejectedCount: number;
}

export async function generateDraftAction(
  contactId: string,
  opts: { jobId?: string; useAi?: boolean } = {},
): Promise<ActionResult<DraftPayload>> {
  try {
    const user = await requireUser();
    await enforceRateLimit('aiTask', `outreach-draft:${user.id}`);

    const [profile, defaultVersion] = await Promise.all([loadProfile(user.id), getDefaultVersion(user.id)]);
    if (!defaultVersion) return { ok: false, error: 'Upload a resume before drafting outreach.' };

    const resume = await getStructured(user.id, defaultVersion.id);
    const { getContact } = await import('@/lib/outreach/contacts');
    const contact = await getContact(user.id, contactId);
    const job = opts.jobId ? await getJob(user.id, opts.jobId) : null;

    let useAi = opts.useAi ?? false;
    if (useAi) {
      const availability = await aiAvailability(user.id, 'outreach_draft');
      useAi = availability.available;
    }

    const content = await generateDraftContent(user.id, { contact, job, profile, resume }, { useAi });
    const draftId = await createDraft(user.id, {
      contactId,
      jobId: opts.jobId ?? null,
      content,
      attachmentVersionId: defaultVersion.id,
    });

    revalidatePath('/outreach');
    return {
      ok: true,
      notice: content.usedAi
        ? `Draft prepared with AI assistance${content.rejectedCount > 0 ? ` (${content.rejectedCount} field(s) reverted to templates)` : ''}.`
        : 'Draft prepared using templates.',
      data: { draftId, usedAi: content.usedAi, rejectedCount: content.rejectedCount },
    };
  } catch (err) {
    return toResult(err);
  }
}

const updateDraftSchema = z.object({
  draftId: z.string().uuid(),
  subject: z.string().max(150).optional(),
  body: z.string().max(1500).optional(),
  followUpBody: z.string().max(800).optional(),
});

export async function updateDraftAction(raw: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = updateDraftSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'Those edits could not be understood.' };
    const { draftId, ...patch } = parsed.data;
    await updateDraft(user.id, draftId, patch);
    revalidatePath('/outreach');
    return { ok: true, notice: 'Saved.' };
  } catch (err) {
    return toResult(err);
  }
}

/* -------------------------------------------------------------------- send */

export interface SendPreviewPayload {
  recipient: string;
  senderDisplay: string;
  subject: string;
  body: string;
  attachmentName: string | null;
  warnings: string[];
  realSendingConfigured: boolean;
  dailyLimit: number;
  sentToday: number;
}

export async function getSendPreviewAction(
  draftId: string,
  kind: 'initial' | 'follow_up',
): Promise<ActionResult<SendPreviewPayload>> {
  try {
    const user = await requireUser();
    const preview = await buildSendPreview(user.id, draftId, {
      kind,
      senderEmail: user.email,
    });
    const sentToday = await sendsToday(user.id);

    return {
      ok: true,
      data: {
        ...preview,
        realSendingConfigured: canSendRealEmail(),
        dailyLimit: RATE_LIMITS.emailSend.limit,
        sentToday,
      },
    };
  } catch (err) {
    return toResult(err);
  }
}

const sendSchema = z.object({
  draftId: z.string().uuid(),
  kind: z.enum(['initial', 'follow_up']),
  confirmed: z.literal(true),
  overrideDuplicate: z.boolean().optional(),
});

/**
 * The single function that may deliver an outreach email.
 * `confirmed: true` must come from a dialog the user has just seen displaying
 * the exact recipient, subject and body — see `getSendPreviewAction`.
 */
export async function sendOutreachAction(raw: unknown): Promise<ActionResult<{ sendId: string }>> {
  try {
    const user = await requireUser();
    const parsed = sendSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: 'Confirmation is required before sending.' };
    }

    const result = await sendOutreachEmail(user.id, parsed.data);

    revalidatePath('/outreach');

    if (!result.ok) {
      return { ok: false, error: result.error ?? 'The email could not be sent.' };
    }

    return {
      ok: true,
      notice: canSendRealEmail()
        ? 'Sent.'
        : `Simulated — no real email provider is configured (${publicEnv.appName} logged it to the server console instead of delivering it).`,
      data: { sendId: result.sendId },
    };
  } catch (err) {
    return toResult(err);
  }
}

export async function isSuppressedAction(email: string): Promise<ActionResult<{ suppressed: boolean }>> {
  try {
    const user = await requireUser();
    const suppressed = await isSuppressed(user.id, email);
    return { ok: true, data: { suppressed } };
  } catch (err) {
    return toResult(err);
  }
}
