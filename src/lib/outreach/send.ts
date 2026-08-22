/**
 * Outreach email sending — the ONLY function in the codebase that may deliver
 * an email to a recruiter contact. Everything upstream (drafting, editing,
 * previewing) is inert; nothing reaches an inbox until this runs, and this
 * only runs after `SendEmailConfirmation` has been explicitly true.
 *
 * Guarantees enforced here, not merely documented:
 *  - explicit confirmation is a required argument, not inferred from a prior call;
 *  - the recipient is checked against the suppression list first;
 *  - the daily send cap is a hard rate limit, not a soft warning;
 *  - a duplicate send to the same recipient within the cool-down window is
 *    blocked unless the caller explicitly overrides it, with the override itself audited;
 *  - the idempotency key means a network retry can never deliver twice;
 *  - a failure is recorded and returned — it is never silently retried.
 */
import { and, eq, gte, count } from 'drizzle-orm';
import { getDb, outreachSends, type OutreachDraft } from '@/lib/db';
import { NotFoundError } from '@/lib/db/tenant';
import { getEmailProvider, isValidEmail, type EmailAttachment } from '@/lib/email';
import { checkRateLimit } from '@/lib/rate-limit';
import { recordAudit } from '@/lib/audit';
import { randomToken } from '@/lib/crypto';
import { getContact, isSuppressed, lastSendToRecipient } from './contacts';
import { getDraft, setDraftStatus } from './drafts';

/** How long after a successful send to the same address before a repeat needs an explicit override. */
const DUPLICATE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

export class OutreachSendError extends Error {
  readonly code:
    | 'not_confirmed'
    | 'suppressed'
    | 'invalid_recipient'
    | 'rate_limited'
    | 'duplicate_recipient'
    | 'provider_not_configured'
    | 'provider_failed';

  constructor(code: OutreachSendError['code'], message: string) {
    super(message);
    this.name = 'OutreachSendError';
    this.code = code;
  }
}

export interface SendPreview {
  recipient: string;
  senderDisplay: string;
  subject: string;
  body: string;
  attachmentName: string | null;
  warnings: string[];
}

/**
 * Everything the confirmation screen must show BEFORE the user can proceed.
 * This is the "display the exact recipient, target, message" step from the
 * spec — building it is separate from sending so the UI can render it first.
 */
export async function buildSendPreview(
  userId: string,
  draftId: string,
  opts: { kind: 'initial' | 'follow_up'; senderEmail: string },
): Promise<SendPreview> {
  const draft = await getDraft(userId, draftId);
  const contact = draft.contactId ? await getContact(userId, draft.contactId) : null;

  if (!contact?.email) {
    throw new OutreachSendError('invalid_recipient', 'This contact has no email address on file.');
  }

  const warnings: string[] = [];
  if (await isSuppressed(userId, contact.email)) {
    warnings.push('This address is on your stop-contact list. Sending will be blocked unless you remove it first.');
  }
  const last = await lastSendToRecipient(userId, contact.email);
  if (last?.sentAt && Date.now() - last.sentAt.getTime() < DUPLICATE_COOLDOWN_MS) {
    warnings.push(
      `You already emailed this address ${daysAgo(last.sentAt)} day(s) ago. Sending again needs an explicit override.`,
    );
  }

  return {
    recipient: contact.email,
    senderDisplay: opts.senderEmail,
    subject: draft.subject,
    body: opts.kind === 'follow_up' ? draft.followUpBody ?? '' : draft.body,
    attachmentName: draft.attachmentVersionId ? 'Resume.pdf' : null,
    warnings,
  };
}

function daysAgo(date: Date): number {
  return Math.round((Date.now() - date.getTime()) / 86_400_000);
}

export interface SendOutreachInput {
  draftId: string;
  kind: 'initial' | 'follow_up';
  /** Required. This function does not infer consent from any other call. */
  confirmed: true;
  /** Required only to proceed past the duplicate-recipient warning. */
  overrideDuplicate?: boolean;
  attachment?: EmailAttachment;
}

export interface SendOutreachResult {
  ok: boolean;
  sendId: string;
  providerMessageId: string | null;
  error?: string;
}

/**
 * Send one outreach email. Idempotent per (draft, kind): calling this twice
 * for the same draft and kind reuses the idempotency key, so a retried request
 * cannot deliver twice even if the client double-submits.
 */
export async function sendOutreachEmail(userId: string, input: SendOutreachInput): Promise<SendOutreachResult> {
  if (input.confirmed !== true) {
    throw new OutreachSendError('not_confirmed', 'Sending requires explicit confirmation.');
  }

  const draft = await getDraft(userId, input.draftId);
  const contact = draft.contactId ? await getContact(userId, draft.contactId) : null;
  if (!contact?.email || !isValidEmail(contact.email)) {
    throw new OutreachSendError('invalid_recipient', 'This contact has no valid email address on file.');
  }
  const recipient = contact.email;
  const idempotencyKey = `outreach:${draft.id}:${input.kind}`;
  const db = getDb();

  // 1. Idempotency check FIRST. This is a retry of an action already taken —
  //    not a new duplicate-recipient decision — so a completed send for this
  //    exact (draft, kind) short-circuits everything below: no re-checking
  //    suppression, no consuming another slot of the daily cap, and no
  //    "duplicate recipient" prompt for what is actually the same request.
  const existing = await findExistingSendByKey(userId, idempotencyKey);
  if (existing?.status === 'sent') {
    return { ok: true, sendId: existing.id, providerMessageId: existing.providerMessageId };
  }

  // 2. Suppression list — absolute veto, no override possible.
  if (await isSuppressed(userId, recipient)) {
    throw new OutreachSendError(
      'suppressed',
      `${recipient} is on your stop-contact list and cannot be emailed. Remove it from the suppression list first if this was a mistake.`,
    );
  }

  // 3. Daily send cap — a hard rate limit, not advisory.
  const rl = await checkRateLimit('emailSend', userId);
  if (!rl.allowed) {
    throw new OutreachSendError(
      'rate_limited',
      `You have reached your daily outreach limit. Try again in ${Math.ceil(rl.retryAfterSeconds / 3600)}h.`,
    );
  }

  // 4. Duplicate-recipient protection — overridable, but the override is
  //    audited. This guards against accidentally sending a second, SEPARATE
  //    cold-outreach email to someone already contacted — it applies only to
  //    'initial' sends. A follow-up is, by definition, meant to reach someone
  //    already mailed; that is a distinct feature gated on its own
  //    confirmation, not a case for this guard. Declared outside the `if` so
  //    the audit metadata below can report whether an override was exercised.
  let withinCooldown = false;
  if (input.kind === 'initial') {
    const last = await lastSendToRecipient(userId, recipient);
    withinCooldown = Boolean(last?.sentAt && Date.now() - last.sentAt.getTime() < DUPLICATE_COOLDOWN_MS);
    if (withinCooldown && !input.overrideDuplicate) {
      throw new OutreachSendError(
        'duplicate_recipient',
        `You already emailed ${recipient} ${daysAgo(last!.sentAt!)} day(s) ago. Confirm again to send anyway.`,
      );
    }
  }

  const body = input.kind === 'follow_up' ? draft.followUpBody ?? '' : draft.body;
  const subject = input.kind === 'follow_up' ? `Re: ${draft.subject}` : draft.subject;

  const insertedRows = await db
    .insert(outreachSends)
    .values({
      userId,
      draftId: draft.id,
      provider: 'pending',
      recipient,
      status: 'pending',
      idempotencyKey,
    })
    .onConflictDoNothing({ target: outreachSends.idempotencyKey })
    .returning({ id: outreachSends.id });

  const sendId = insertedRows[0]?.id ?? (await findExistingSendByKey(userId, idempotencyKey))?.id;
  if (!sendId) throw new OutreachSendError('provider_failed', 'Could not create a send record.');

  const provider = getEmailProvider();

  try {
    const result = await provider.send({
      to: recipient,
      subject,
      text: body,
      ...(input.attachment ? { attachments: [input.attachment] } : {}),
      idempotencyKey,
    });

    if (!result.ok) {
      await db
        .update(outreachSends)
        .set({ status: 'failed', errorMessage: result.error ?? 'Unknown provider error', provider: result.provider })
        .where(eq(outreachSends.id, sendId));

      await recordAudit({
        userId,
        action: 'outreach.email_failed',
        entityType: 'outreach_send',
        entityId: sendId,
        metadata: { recipient, error: result.error },
      });

      return { ok: false, sendId, providerMessageId: null, error: result.error };
    }

    await db
      .update(outreachSends)
      .set({
        status: 'sent',
        provider: result.provider,
        providerMessageId: result.providerMessageId,
        sentAt: new Date(),
      })
      .where(eq(outreachSends.id, sendId));

    await setDraftStatus(userId, draft.id, 'sent');

    await recordAudit({
      userId,
      action: 'outreach.email_sent',
      entityType: 'outreach_send',
      entityId: sendId,
      metadata: {
        recipient,
        provider: result.provider,
        simulated: result.simulated ?? false,
        overrodeDuplicate: Boolean(input.overrideDuplicate && withinCooldown),
      },
    });

    return { ok: true, sendId, providerMessageId: result.providerMessageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The email could not be sent.';
    await db.update(outreachSends).set({ status: 'failed', errorMessage: message }).where(eq(outreachSends.id, sendId));
    await recordAudit({
      userId,
      action: 'outreach.email_failed',
      entityType: 'outreach_send',
      entityId: sendId,
      metadata: { recipient, error: message },
    });
    // Deliberately not retried here: the caller must explicitly try again.
    return { ok: false, sendId, providerMessageId: null, error: message };
  }
}

async function findExistingSendByKey(userId: string, idempotencyKey: string) {
  const rows = await getDb()
    .select()
    .from(outreachSends)
    .where(and(eq(outreachSends.userId, userId), eq(outreachSends.idempotencyKey, idempotencyKey)));
  return rows[0] ?? null;
}

export async function listSends(userId: string) {
  return getDb().select().from(outreachSends).where(eq(outreachSends.userId, userId));
}

/** Sends today, for showing "X of 20 used" in the UI. */
export async function sendsToday(userId: string): Promise<number> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const rows = await getDb()
    .select({ n: count() })
    .from(outreachSends)
    .where(and(eq(outreachSends.userId, userId), gte(outreachSends.createdAt, dayStart)));
  return Number(rows[0]?.n ?? 0);
}
