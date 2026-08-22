/**
 * Outreach draft generation: cold email, subject, LinkedIn message, follow-up.
 * Server-only.
 *
 * Same grounding discipline as `applications/packet.ts`: every AI-written
 * sentence is checked against the resume+profile corpus, and anything
 * introducing an unsupported claim is replaced with a deterministic template
 * rather than shown. The templates never claim a prior interaction, a mutual
 * connection, or a fact not present in the corpus — see `OUTREACH_PREAMBLE`.
 */
import { z } from 'zod';
import { getDb, outreachDrafts, type OutreachContact, type OutreachDraft } from '@/lib/db';
import { and, desc, eq } from 'drizzle-orm';
import { NotFoundError } from '@/lib/db/tenant';
import { recordAudit } from '@/lib/audit';
import { generateObject } from '@/lib/ai/client';
import { AiError } from '@/lib/ai/types';
import { SAFETY_PREAMBLE, OUTREACH_PREAMBLE, budgetText, fenceUntrusted } from '@/lib/ai/prompts';
import { checkGrounding, resumeToPlainText, type StructuredResume } from '@/lib/resume/types';
import { profileToProse } from '@/lib/profile/prose';
import type { FullProfile } from '@/lib/profile/types';
import type { JobWithSource } from '@/lib/jobs/service';

export interface DraftContent {
  subject: string;
  body: string;
  followUpBody: string;
  linkedinMessage: string;
  /** A plain suggestion, e.g. "Tuesday–Thursday mornings". Never scheduled automatically. */
  suggestedTiming: string;
  usedAi: boolean;
  provider: string | null;
  rejectedCount: number;
}

/* ------------------------------------------------------------- templates -- */

function templateSubject(job: JobWithSource | null): string {
  return job ? `Interested in the ${job.title} role at ${job.company}` : `Quick introduction`;
}

function templateBody(profile: FullProfile, job: JobWithSource | null, contact: OutreachContact): string {
  const name = profile.personal.fullName || profile.personal.preferredName || '';
  const title = profile.professional.currentTitle;
  const skills = (profile.professional.skills ?? []).slice(0, 4);

  const lines = [
    `Hi ${contact.name.split(' ')[0] || contact.name},`,
    '',
    job
      ? `I saw the ${job.title} opening at ${job.company} and wanted to reach out directly.`
      : `I wanted to introduce myself${contact.company ? ` regarding opportunities at ${contact.company}` : ''}.`,
  ];

  if (title) lines.push('', `I currently work as a ${title}${skills.length ? `, focused on ${skills.join(', ')}` : ''}.`);
  lines.push('', `I've attached my resume and would welcome a short conversation if there's a fit.`, '', `Best regards,`, name);

  return lines.join('\n');
}

function templateFollowUp(job: JobWithSource | null, contact: OutreachContact): string {
  return [
    `Hi ${contact.name.split(' ')[0] || contact.name},`,
    '',
    `Just following up on my note about${job ? ` the ${job.title} role` : ' opportunities at your team'} — happy to share more if useful.`,
    '',
    `Thanks,`,
  ].join('\n');
}

function templateLinkedIn(job: JobWithSource | null): string {
  return job
    ? `Hi — I'm interested in the ${job.title} role at ${job.company} and wanted to connect.`
    : `Hi — I'd love to connect and learn more about opportunities on your team.`;
}

/* -------------------------------------------------------------- AI pass --- */

const aiDraftSchema = z.object({
  subject: z.string().max(150),
  body: z.string().max(1500),
  followUpBody: z.string().max(800),
  linkedinMessage: z.string().max(400),
  suggestedTiming: z.string().max(150),
});

async function generateWithAi(
  userId: string,
  input: { contact: OutreachContact; job: JobWithSource | null; profile: FullProfile; resume: StructuredResume },
  corpus: string,
): Promise<{ content: z.infer<typeof aiDraftSchema>; rejected: number; provider: string } | null> {
  const instructions = [
    SAFETY_PREAMBLE,
    '',
    OUTREACH_PREAMBLE,
    '',
    'TASK',
    'Write a short cold outreach email to a recruiter or hiring contact, plus a follow-up and a LinkedIn message.',
    '',
    'Rules:',
    '- Address the contact by first name.',
    '- The email body is under 120 words.',
    '- The LinkedIn message is under 300 characters (LinkedIn has a hard limit).',
    '- Ground every claim about the candidate in the resume/profile. Never claim a prior conversation or connection.',
    '- Suggest a plausible send-time window in general terms (e.g. "weekday mornings") — never a specific date or time.',
  ].join('\n');

  const userContent = [
    `Contact: ${input.contact.name}${input.contact.title ? `, ${input.contact.title}` : ''}${input.contact.company ? ` at ${input.contact.company}` : ''}`,
    input.job ? `Regarding: ${input.job.title} at ${input.job.company}` : 'No specific role — a general introduction.',
    '',
    fenceUntrusted('candidate_resume', budgetText(resumeToPlainText(input.resume), 8_000)),
    '',
    fenceUntrusted('candidate_profile', budgetText(profileToProse(input.profile), 3_000)),
  ].join('\n');

  try {
    const res = await generateObject({
      userId,
      task: 'outreach_draft',
      schema: aiDraftSchema,
      schemaName: 'outreach_draft',
      temperature: 0.4,
      maxOutputTokens: 1200,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: userContent },
      ],
    });

    let rejected = 0;
    const checked = { ...res.value };

    for (const field of ['body', 'followUpBody', 'linkedinMessage'] as const) {
      const finding = checkGrounding(checked[field], corpus, field);
      if (finding) {
        rejected += 1;
        if (field === 'body') checked.body = templateBody(input.profile, input.job, input.contact);
        if (field === 'followUpBody') checked.followUpBody = templateFollowUp(input.job, input.contact);
        if (field === 'linkedinMessage') checked.linkedinMessage = templateLinkedIn(input.job);
      }
    }

    return { content: checked, rejected, provider: res.provider };
  } catch (err) {
    if (!(err instanceof AiError)) console.error('[outreach] AI draft generation failed unexpectedly', err);
    return null;
  }
}

/* ------------------------------------------------------------------ entry -- */

export async function generateDraftContent(
  userId: string,
  input: { contact: OutreachContact; job: JobWithSource | null; profile: FullProfile; resume: StructuredResume },
  opts: { useAi?: boolean } = {},
): Promise<DraftContent> {
  const corpus = `${resumeToPlainText(input.resume)}\n\n${profileToProse(input.profile)}`;

  let subject = templateSubject(input.job);
  let body = templateBody(input.profile, input.job, input.contact);
  let followUpBody = templateFollowUp(input.job, input.contact);
  let linkedinMessage = templateLinkedIn(input.job);
  let suggestedTiming = 'Weekday mornings tend to get better response rates.';
  let usedAi = false;
  let provider: string | null = null;
  let rejectedCount = 0;

  if (opts.useAi) {
    const ai = await generateWithAi(userId, input, corpus);
    if (ai) {
      usedAi = true;
      provider = ai.provider;
      rejectedCount = ai.rejected;
      subject = ai.content.subject || subject;
      body = ai.content.body;
      followUpBody = ai.content.followUpBody;
      linkedinMessage = ai.content.linkedinMessage;
      suggestedTiming = ai.content.suggestedTiming || suggestedTiming;
    }
  }

  return { subject, body, followUpBody, linkedinMessage, suggestedTiming, usedAi, provider, rejectedCount };
}

/* --------------------------------------------------------------- storage -- */

export interface CreateDraftInput {
  contactId: string;
  jobId?: string | null;
  content: DraftContent;
  attachmentVersionId?: string | null;
}

export async function createDraft(userId: string, input: CreateDraftInput): Promise<string> {
  const db = getDb();
  const rows = await db
    .insert(outreachDrafts)
    .values({
      userId,
      contactId: input.contactId,
      jobId: input.jobId ?? null,
      channel: 'email',
      subject: input.content.subject,
      body: input.content.body,
      followUpBody: input.content.followUpBody,
      linkedinMessage: input.content.linkedinMessage,
      suggestedTiming: input.content.suggestedTiming,
      attachmentVersionId: input.attachmentVersionId ?? null,
      status: 'draft',
      provider: input.content.provider,
    })
    .returning({ id: outreachDrafts.id });

  const draftId = rows[0]!.id;

  await recordAudit({
    userId,
    action: 'outreach.draft_created',
    entityType: 'outreach_draft',
    entityId: draftId,
    metadata: { contactId: input.contactId, jobId: input.jobId ?? null, usedAi: input.content.usedAi },
  });

  return draftId;
}

export async function getDraft(userId: string, draftId: string): Promise<OutreachDraft> {
  const rows = await getDb()
    .select()
    .from(outreachDrafts)
    .where(and(eq(outreachDrafts.userId, userId), eq(outreachDrafts.id, draftId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('That outreach draft was not found.');
  return row;
}

export async function listDrafts(userId: string): Promise<OutreachDraft[]> {
  return getDb().select().from(outreachDrafts).where(eq(outreachDrafts.userId, userId)).orderBy(desc(outreachDrafts.createdAt));
}

export async function updateDraft(
  userId: string,
  draftId: string,
  patch: Partial<{ subject: string; body: string; followUpBody: string }>,
): Promise<void> {
  await getDraft(userId, draftId);
  await getDb()
    .update(outreachDrafts)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(outreachDrafts.userId, userId), eq(outreachDrafts.id, draftId)));
}

export async function setDraftStatus(
  userId: string,
  draftId: string,
  status: 'draft' | 'approved' | 'sent' | 'failed' | 'cancelled',
): Promise<void> {
  await getDraft(userId, draftId);
  await getDb()
    .update(outreachDrafts)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(outreachDrafts.userId, userId), eq(outreachDrafts.id, draftId)));
}
