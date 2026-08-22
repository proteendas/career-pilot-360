'use server';

/**
 * Application server actions: packet generation, review, submission tracking.
 *
 * The action surface deliberately separates PREPARATION (generate a packet,
 * tailor a resume) from SIDE EFFECTS (open a portal, mark submitted). Every
 * side-effect action requires the confirmation to have already happened in the
 * UI — this layer records it, it does not ask for it.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { enforceRateLimit, RateLimitError } from '@/lib/rate-limit';
import { NotFoundError } from '@/lib/db/tenant';
import { AiError } from '@/lib/ai/types';
import { aiAvailability } from '@/lib/ai/client';
import { loadProfile } from '@/lib/profile/service';
import { getJob } from '@/lib/jobs/service';
import { getMatch, scoreJobWithEnrichment } from '@/lib/jobs/match-service';
import { getDefaultVersion, getStructured, createVersion } from '@/lib/resume/service';
import { resumeToPlainText } from '@/lib/resume/types';
import { generateApplicationPacket, summarizeResumeDiff } from '@/lib/applications/packet';
import { tailorResumeForJob, describeTailoring } from '@/lib/applications/tailor';
import {
  createPacket,
  getApplicationByJob,
  getOrCreateApplication,
  getPacket,
  listEvents,
  markSubmittedByUser,
  transitionApplication,
  updatePacketContent,
} from '@/lib/applications/service';
import { and, eq } from 'drizzle-orm';
import { applications, getDb } from '@/lib/db';
import { InvalidTransitionError, type ApplicationStatus } from '@/lib/applications/state';
import { recordAudit } from '@/lib/audit';

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
  if (err instanceof InvalidTransitionError) return { ok: false, error: err.message };
  if (err instanceof AiError) return { ok: false, error: err.message };
  console.error('[applications-action] unexpected failure', err);
  return { ok: false, error: 'Something went wrong. Please try again.' };
}

/* ------------------------------------------------------------ packet build */

export interface PacketBuildPayload {
  applicationId: string;
  packetId: string;
  usedAi: boolean;
  provider: string | null;
  rejectedCount: number;
  warningCount: number;
}

/**
 * Build a full application packet for a job: a tailored resume version, cover
 * letter, screening answers, outreach drafts, checklist and warnings.
 *
 * Tailoring reorders content only (see `tailor.ts`); AI-written prose is
 * fabrication-checked before it reaches the packet (see `packet.ts`).
 */
export async function generatePacketAction(
  jobId: string,
  opts: { useAi?: boolean; resumeVersionId?: string } = {},
): Promise<ActionResult<PacketBuildPayload>> {
  try {
    const user = await requireUser();
    await enforceRateLimit('aiTask', `packet:${user.id}`);

    const [job, profile, defaultVersion] = await Promise.all([
      getJob(user.id, jobId),
      loadProfile(user.id),
      getDefaultVersion(user.id),
    ]);

    const versionId = opts.resumeVersionId ?? defaultVersion?.id;
    if (!versionId) {
      return { ok: false, error: 'Upload a resume before preparing an application packet.' };
    }

    const [resume, match] = await Promise.all([
      getStructured(user.id, versionId),
      getMatch(user.id, jobId).then((m) => m ?? scoreJobWithEnrichment(user.id, jobId)),
    ]);

    let useAi = opts.useAi ?? false;
    if (useAi) {
      const availability = await aiAvailability(user.id, 'cover_letter');
      useAi = availability.available;
    }

    const content = await generateApplicationPacket({
      userId: user.id,
      job,
      match,
      resume,
      profile,
    }, { useAi });

    // Tailor the resume for this job (reorder only) and save as a new version.
    const tailored = tailorResumeForJob(resume, job, match);
    const original = resumeToPlainText(resume);
    const tailoredText = resumeToPlainText(tailored);

    const tailoredVersionId = await createVersion(user.id, {
      name: `${job.title} at ${job.company} — tailored`,
      structuredContent: tailored,
      parentVersionId: versionId,
      jobId,
      isTailored: true,
    });

    const diff = summarizeResumeDiff(original, tailoredText);

    const packetId = await createPacket(user.id, {
      jobId,
      resumeVersionId: versionId,
      tailoredResumeVersionId: tailoredVersionId,
      content,
      diff: {
        ...diff,
        tailoringNotes: describeTailoring(job, match),
      },
    });

    const application = await getOrCreateApplication(user.id, jobId, packetId);

    revalidatePath(`/applications/${application.id}`);
    revalidatePath(`/applications/${application.id}/review`);
    revalidatePath('/applications');

    return {
      ok: true,
      notice: content.usedAi
        ? `Packet prepared with AI assistance${content.rejectedCount > 0 ? ` (${content.rejectedCount} rewrite(s) discarded for unsupported claims)` : ''}.`
        : 'Packet prepared using deterministic templates.',
      data: {
        applicationId: application.id,
        packetId,
        usedAi: content.usedAi,
        provider: content.provider,
        rejectedCount: content.rejectedCount,
        warningCount: content.warnings.length,
      },
    };
  } catch (err) {
    return toResult(err);
  }
}

/* ------------------------------------------------------------- packet edit */

const editPacketSchema = z.object({
  packetId: z.string().uuid(),
  coverLetter: z.string().max(3000).optional(),
  recruiterEmail: z.string().max(2000).optional(),
  linkedinMessage: z.string().max(600).optional(),
  emailSubject: z.string().max(150).optional(),
});

/** Save the user's own edits to a packet's free-text fields. */
export async function updatePacketAction(raw: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = editPacketSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'Those edits could not be understood.' };

    const { packetId, ...patch } = parsed.data;
    await updatePacketContent(user.id, packetId, patch);

    revalidatePath('/applications');
    return { ok: true, notice: 'Saved.' };
  } catch (err) {
    return toResult(err);
  }
}

const editAnswerSchema = z.object({
  packetId: z.string().uuid(),
  questionIndex: z.number().int().min(0),
  answer: z.string().max(3000),
});

/** Save the user's own answer to one screening question in a packet. */
export async function updateScreeningAnswerAction(raw: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = editAnswerSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'That answer could not be saved.' };

    const packet = await getPacket(user.id, parsed.data.packetId);
    const answers = [...((packet.screeningAnswers as { question: string; answer: string; needsUserInput: boolean; reason: string; category: string | null; source: string }[]) ?? [])];
    const existing = answers[parsed.data.questionIndex];
    if (!existing) return { ok: false, error: 'That question could not be found in this packet.' };

    answers[parsed.data.questionIndex] = {
      ...existing,
      answer: parsed.data.answer,
      needsUserInput: false,
      reason: 'You answered this yourself.',
      source: 'profile_custom_answer',
    };

    await updatePacketContent(user.id, parsed.data.packetId, { screeningAnswers: answers });

    await recordAudit({
      userId: user.id,
      action: 'profile.updated',
      entityType: 'application_packet',
      entityId: parsed.data.packetId,
      afterSummary: `Answered: ${existing.question}`,
    });

    revalidatePath('/applications');
    return { ok: true, notice: 'Answer saved.' };
  } catch (err) {
    return toResult(err);
  }
}

/* -------------------------------------------------------------- review UI */

/** The user reviewed the packet and approves it for use. */
export async function approveApplicationAction(applicationId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await transitionApplication(user.id, applicationId, { toStatus: 'approved', actor: 'user' });
    revalidatePath(`/applications/${applicationId}`);
    revalidatePath('/applications');
    return { ok: true, notice: 'Approved.' };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Record that the user opened the external application portal.
 * This is the confirmation moment before any external side effect — the
 * caller's UI must have already shown the exact URL before calling this.
 */
export async function recordPortalOpenedAction(
  applicationId: string,
  externalUrl: string,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await transitionApplication(user.id, applicationId, {
      toStatus: 'opened_externally',
      actor: 'user',
      metadata: { externalUrl },
    });

    await getDb()
      .update(applications)
      .set({ externalUrl, updatedAt: new Date() })
      .where(and(eq(applications.userId, user.id), eq(applications.id, applicationId)));

    revalidatePath(`/applications/${applicationId}`);
    return { ok: true, notice: 'Recorded. The application portal opened in a new tab.' };
  } catch (err) {
    return toResult(err);
  }
}

const markSubmittedSchema = z.object({
  applicationId: z.string().uuid(),
  externalUrl: z.string().max(2048).optional(),
  userNotes: z.string().max(2000).optional(),
  /** The user must explicitly confirm — never inferred from any other action. */
  confirmed: z.literal(true),
});

/**
 * The single function that may mark an application submitted by the user.
 * Requires an explicit `confirmed: true` from a confirmation dialog — this
 * cannot be called as a side effect of anything else.
 */
export async function markSubmittedAction(raw: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = markSubmittedSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: 'Confirmation is required before marking an application as submitted.' };
    }

    await markSubmittedByUser(user.id, parsed.data.applicationId, {
      externalUrl: parsed.data.externalUrl ?? null,
      userNotes: parsed.data.userNotes ?? null,
    });

    revalidatePath(`/applications/${parsed.data.applicationId}`);
    revalidatePath('/applications');
    revalidatePath('/dashboard');

    return { ok: true, notice: 'Marked as submitted. Recorded in your audit history.' };
  } catch (err) {
    return toResult(err);
  }
}

const changeStatusSchema = z.object({
  applicationId: z.string().uuid(),
  toStatus: z.enum([
    'draft', 'ready_for_review', 'approved', 'scheduled', 'opened_externally', 'in_progress',
    'needs_user_input', 'interview', 'offer', 'rejected', 'withdrawn', 'closed', 'failed',
  ]),
});

/** Manual status changes the user makes from the tracking UI (not submission). */
export async function changeApplicationStatusAction(raw: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = changeStatusSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'Choose a valid status.' };

    await transitionApplication(user.id, parsed.data.applicationId, {
      toStatus: parsed.data.toStatus as ApplicationStatus,
      actor: 'user',
    });

    revalidatePath(`/applications/${parsed.data.applicationId}`);
    revalidatePath('/applications');
    return { ok: true, notice: 'Status updated.' };
  } catch (err) {
    return toResult(err);
  }
}

export async function withdrawApplicationAction(applicationId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await transitionApplication(user.id, applicationId, { toStatus: 'withdrawn', actor: 'user' });
    revalidatePath(`/applications/${applicationId}`);
    revalidatePath('/applications');
    return { ok: true, notice: 'Application withdrawn.' };
  } catch (err) {
    return toResult(err);
  }
}

/* ------------------------------------------------------------------- read */

export async function getApplicationHistoryAction(
  applicationId: string,
): Promise<ActionResult<{ events: Awaited<ReturnType<typeof listEvents>> }>> {
  try {
    const user = await requireUser();
    const events = await listEvents(user.id, applicationId);
    return { ok: true, data: { events } };
  } catch (err) {
    return toResult(err);
  }
}

export async function ensureApplicationForJobAction(jobId: string): Promise<ActionResult<{ applicationId: string }>> {
  try {
    const user = await requireUser();
    const existing = await getApplicationByJob(user.id, jobId);
    if (existing) return { ok: true, data: { applicationId: existing.id } };

    const app = await getOrCreateApplication(user.id, jobId, null);
    return { ok: true, data: { applicationId: app.id } };
  } catch (err) {
    return toResult(err);
  }
}
