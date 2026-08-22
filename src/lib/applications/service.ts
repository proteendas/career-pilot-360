/**
 * Application persistence: packets, applications, status transitions, events.
 * Server-only. Every function is scoped to a `userId`.
 */
import { and, desc, eq } from 'drizzle-orm';
import {
  applicationEvents,
  applicationPackets,
  applications,
  getDb,
  type Application,
  type ApplicationPacket,
} from '@/lib/db';
import { NotFoundError } from '@/lib/db/tenant';
import { recordAudit } from '@/lib/audit';
import {
  assertTransition,
  eventTypeForTransition,
  type ActorType,
  type ApplicationStatus,
} from './state';
import type { ApplicationPacketContent } from './packet';

/* --------------------------------------------------------------- packets -- */

export interface CreatePacketInput {
  jobId: string;
  resumeVersionId?: string | null;
  tailoredResumeVersionId?: string | null;
  content: ApplicationPacketContent;
  diff?: Record<string, unknown>;
}

export async function createPacket(userId: string, input: CreatePacketInput): Promise<string> {
  const db = getDb();
  const rows = await db
    .insert(applicationPackets)
    .values({
      userId,
      jobId: input.jobId,
      resumeVersionId: input.resumeVersionId ?? null,
      tailoredResumeVersionId: input.tailoredResumeVersionId ?? null,
      coverLetter: input.content.coverLetter,
      shortSummary: input.content.shortSummary,
      emailSubject: input.content.emailSubject,
      recruiterEmail: input.content.recruiterEmail,
      linkedinMessage: input.content.linkedinMessage,
      screeningAnswers: input.content.screeningAnswers,
      keySkills: input.content.keySkillsToEmphasize,
      checklist: input.content.checklist,
      warnings: input.content.warnings,
      diff: input.diff ?? {},
      status: input.content.warnings.some((w) => w.severity === 'high') ? 'needs_user_input' : 'ready_for_review',
      provider: input.content.provider,
      model: null,
    })
    .returning({ id: applicationPackets.id });

  const packetId = rows[0]!.id;

  await recordAudit({
    userId,
    action: 'packet.generated',
    entityType: 'application_packet',
    entityId: packetId,
    metadata: {
      jobId: input.jobId,
      usedAi: input.content.usedAi,
      provider: input.content.provider,
      warningCount: input.content.warnings.length,
      screeningQuestionCount: input.content.screeningAnswers.length,
      screeningNeedsInputCount: input.content.screeningAnswers.filter((a) => a.needsUserInput).length,
    },
  });

  return packetId;
}

export async function getPacket(userId: string, packetId: string): Promise<ApplicationPacket> {
  const rows = await getDb()
    .select()
    .from(applicationPackets)
    .where(and(eq(applicationPackets.userId, userId), eq(applicationPackets.id, packetId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('That application packet was not found.');
  return row;
}

export async function updatePacketContent(
  userId: string,
  packetId: string,
  patch: Partial<{
    coverLetter: string;
    recruiterEmail: string;
    linkedinMessage: string;
    emailSubject: string;
    screeningAnswers: unknown;
  }>,
): Promise<void> {
  await getPacket(userId, packetId);
  await getDb()
    .update(applicationPackets)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(applicationPackets.userId, userId), eq(applicationPackets.id, packetId)));
}

export async function listPacketsForJob(userId: string, jobId: string): Promise<ApplicationPacket[]> {
  return getDb()
    .select()
    .from(applicationPackets)
    .where(and(eq(applicationPackets.userId, userId), eq(applicationPackets.jobId, jobId)))
    .orderBy(desc(applicationPackets.createdAt));
}

/* ---------------------------------------------------------------- creation */

export async function getOrCreateApplication(
  userId: string,
  jobId: string,
  packetId: string | null,
): Promise<Application> {
  const db = getDb();
  const existing = await db
    .select()
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.jobId, jobId)))
    .limit(1);

  if (existing[0]) {
    if (packetId && existing[0].applicationPacketId !== packetId) {
      await db
        .update(applications)
        .set({ applicationPacketId: packetId, updatedAt: new Date() })
        .where(eq(applications.id, existing[0].id));
      return { ...existing[0], applicationPacketId: packetId };
    }
    return existing[0];
  }

  const rows = await db
    .insert(applications)
    .values({
      userId,
      jobId,
      applicationPacketId: packetId,
      status: 'draft',
      source: 'manual_prep',
    })
    .returning();

  const app = rows[0]!;
  await recordEvent(userId, app.id, 'application.created', { toStatus: 'draft' });
  await recordAudit({
    userId,
    action: 'application.created',
    entityType: 'application',
    entityId: app.id,
    metadata: { jobId },
  });

  return app;
}

export async function getApplication(userId: string, applicationId: string): Promise<Application> {
  const rows = await getDb()
    .select()
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.id, applicationId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('That application was not found.');
  return row;
}

export async function getApplicationByJob(userId: string, jobId: string): Promise<Application | null> {
  const rows = await getDb()
    .select()
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.jobId, jobId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listApplications(
  userId: string,
  filters: { status?: ApplicationStatus[] } = {},
): Promise<Application[]> {
  const db = getDb();
  const conditions = [eq(applications.userId, userId)];
  const rows = await db
    .select()
    .from(applications)
    .where(and(...conditions))
    .orderBy(desc(applications.updatedAt));

  return filters.status?.length ? rows.filter((r) => filters.status!.includes(r.status as ApplicationStatus)) : rows;
}

/* --------------------------------------------------------- state changes -- */

export interface TransitionInput {
  toStatus: ApplicationStatus;
  actor: ActorType;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Move an application to a new status, enforcing the actor gate from
 * `state.ts` and recording the event. This is the ONLY function that may
 * write `applications.status` — a page or action must go through it.
 */
export async function transitionApplication(
  userId: string,
  applicationId: string,
  input: TransitionInput,
): Promise<Application> {
  const app = await getApplication(userId, applicationId);
  const fromStatus = app.status as ApplicationStatus;

  // Validates the transition AND the actor gate; throws InvalidTransitionError.
  assertTransition(fromStatus, input.toStatus, input.actor);

  const db = getDb();
  const patch: Partial<typeof applications.$inferInsert> = {
    status: input.toStatus,
    updatedAt: new Date(),
  };
  if (input.toStatus === 'submitted_by_user' || input.toStatus === 'submitted_by_connector') {
    patch.submittedAt = new Date();
    patch.submittedByUserId = input.actorUserId ?? userId;
  }

  await db.update(applications).set(patch).where(eq(applications.id, applicationId));

  await recordEvent(userId, applicationId, eventTypeForTransition(input.toStatus), {
    fromStatus,
    toStatus: input.toStatus,
    actorType: input.actor,
    metadata: input.metadata ?? {},
  });

  await recordAudit({
    userId,
    action: mapTransitionToAuditAction(input.toStatus),
    entityType: 'application',
    entityId: applicationId,
    beforeSummary: fromStatus,
    afterSummary: input.toStatus,
    metadata: { actor: input.actor, ...input.metadata },
  });

  return { ...app, ...patch } as Application;
}

function mapTransitionToAuditAction(
  status: ApplicationStatus,
): 'application.approved' | 'application.external_portal_opened' | 'application.marked_submitted' | 'application.status_changed' | 'application.withdrawn' {
  switch (status) {
    case 'approved':
      return 'application.approved';
    case 'opened_externally':
      return 'application.external_portal_opened';
    case 'submitted_by_user':
    case 'submitted_by_connector':
      return 'application.marked_submitted';
    case 'withdrawn':
      return 'application.withdrawn';
    default:
      return 'application.status_changed';
  }
}

export interface MarkSubmittedInput {
  externalUrl?: string | null;
  resumeVersionId?: string | null;
  applicationPacketId?: string | null;
  userNotes?: string | null;
}

/**
 * The one function that may record a manual submission. Requires the actor to
 * be 'user' — there is no other path to this status, by construction of
 * `assertTransition`.
 */
export async function markSubmittedByUser(
  userId: string,
  applicationId: string,
  input: MarkSubmittedInput,
): Promise<Application> {
  const db = getDb();
  await transitionApplication(userId, applicationId, {
    toStatus: 'submitted_by_user',
    actor: 'user',
    actorUserId: userId,
    metadata: { externalUrl: input.externalUrl ?? null },
  });

  // Only overwrite a field when the caller actually supplied one. The packet
  // and resume version were set when the application was created — omitting
  // them here (as the real submission flow does, since it only passes a URL
  // and notes) must never wipe that link back to null.
  const patch: Partial<typeof applications.$inferInsert> = {
    userNotes: input.userNotes ?? null,
    submissionMethod: 'manual_external',
    updatedAt: new Date(),
  };
  if (input.externalUrl !== undefined) patch.externalUrl = input.externalUrl;
  if (input.resumeVersionId !== undefined) patch.resumeVersionId = input.resumeVersionId;
  if (input.applicationPacketId !== undefined) patch.applicationPacketId = input.applicationPacketId;

  await db.update(applications).set(patch).where(eq(applications.id, applicationId));

  return getApplication(userId, applicationId);
}

/* --------------------------------------------------------------- events --- */

export async function recordEvent(
  userId: string,
  applicationId: string,
  eventType: string,
  opts: {
    fromStatus?: string | null;
    toStatus?: string | null;
    actorType?: ActorType;
    actorUserId?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  await getDb().insert(applicationEvents).values({
    applicationId,
    userId,
    eventType,
    fromStatus: opts.fromStatus ?? null,
    toStatus: opts.toStatus ?? null,
    actorType: opts.actorType ?? 'user',
    actorUserId: opts.actorUserId ?? userId,
    metadata: opts.metadata ?? {},
  });
}

export async function listEvents(userId: string, applicationId: string) {
  await getApplication(userId, applicationId);
  return getDb()
    .select()
    .from(applicationEvents)
    .where(and(eq(applicationEvents.userId, userId), eq(applicationEvents.applicationId, applicationId)))
    .orderBy(applicationEvents.createdAt);
}
