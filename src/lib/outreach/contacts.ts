/**
 * Recruiter/HR contact management. Server-only.
 *
 * Compliance boundary: a contact may only be recorded from one of the sources
 * the spec permits — the user typed it, a public company page, or an
 * authorised API. There is no path that accepts a scraped profile, and no
 * function anywhere derives or guesses an email address from a name and a
 * company domain. If a contact has no email, outreach stays LinkedIn-draft
 * only for them (see `drafts.ts`).
 */
import { and, desc, eq } from 'drizzle-orm';
import { getDb, outreachContacts, outreachSends, outreachSuppressions, type OutreachContact } from '@/lib/db';
import { NotFoundError } from '@/lib/db/tenant';
import { isValidEmail } from '@/lib/email';
import { sanitizeLabel, validateUrl } from '@/lib/security';
import { recordAudit } from '@/lib/audit';

export const CONTACT_SOURCES = ['user_provided', 'public_company_page', 'authorized_api', 'manual'] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export const CONTACT_SOURCE_LABELS: Record<ContactSource, string> = {
  user_provided: 'You provided this',
  public_company_page: 'Public company page',
  authorized_api: 'Authorised API',
  manual: 'Entered manually',
};

export interface CreateContactInput {
  name: string;
  title?: string;
  company?: string;
  email?: string;
  linkedinUrl?: string;
  source: ContactSource;
  /** A short note on where exactly this came from — shown to the user. */
  provenance: string;
  notes?: string;
}

export class ContactValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContactValidationError';
  }
}

export async function createContact(userId: string, input: CreateContactInput): Promise<string> {
  const name = sanitizeLabel(input.name, 160);
  if (!name) throw new ContactValidationError('Enter the contact’s name.');

  if (input.email && !isValidEmail(input.email)) {
    throw new ContactValidationError('That does not look like a valid email address.');
  }
  if (input.linkedinUrl) {
    try {
      validateUrl(input.linkedinUrl);
    } catch {
      throw new ContactValidationError('That LinkedIn URL is not valid.');
    }
  }
  if (!CONTACT_SOURCES.includes(input.source)) {
    throw new ContactValidationError('Unknown contact source.');
  }

  const db = getDb();
  const rows = await db
    .insert(outreachContacts)
    .values({
      userId,
      name,
      title: input.title ? sanitizeLabel(input.title, 160) : null,
      company: input.company ? sanitizeLabel(input.company, 160) : null,
      email: input.email?.trim().toLowerCase() ?? null,
      linkedinUrl: input.linkedinUrl?.trim() ?? null,
      source: input.source,
      provenance: sanitizeLabel(input.provenance, 300),
      verificationStatus: 'unverified',
      notes: input.notes ? sanitizeLabel(input.notes, 1000) : null,
    })
    .returning({ id: outreachContacts.id });

  const contactId = rows[0]!.id;

  await recordAudit({
    userId,
    action: 'outreach.contact_created',
    entityType: 'outreach_contact',
    entityId: contactId,
    metadata: { source: input.source, hasEmail: Boolean(input.email) },
  });

  return contactId;
}

export async function listContacts(userId: string): Promise<OutreachContact[]> {
  return getDb()
    .select()
    .from(outreachContacts)
    .where(eq(outreachContacts.userId, userId))
    .orderBy(desc(outreachContacts.createdAt));
}

export async function getContact(userId: string, contactId: string): Promise<OutreachContact> {
  const rows = await getDb()
    .select()
    .from(outreachContacts)
    .where(and(eq(outreachContacts.userId, userId), eq(outreachContacts.id, contactId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('That contact was not found.');
  return row;
}

export async function updateContact(
  userId: string,
  contactId: string,
  patch: Partial<Pick<CreateContactInput, 'name' | 'title' | 'company' | 'email' | 'linkedinUrl' | 'notes'>>,
): Promise<void> {
  await getContact(userId, contactId);
  if (patch.email && !isValidEmail(patch.email)) {
    throw new ContactValidationError('That does not look like a valid email address.');
  }

  const db = getDb();
  await db
    .update(outreachContacts)
    .set({
      ...(patch.name !== undefined ? { name: sanitizeLabel(patch.name, 160) } : {}),
      ...(patch.title !== undefined ? { title: sanitizeLabel(patch.title, 160) || null } : {}),
      ...(patch.company !== undefined ? { company: sanitizeLabel(patch.company, 160) || null } : {}),
      ...(patch.email !== undefined ? { email: patch.email.trim().toLowerCase() || null } : {}),
      ...(patch.linkedinUrl !== undefined ? { linkedinUrl: patch.linkedinUrl.trim() || null } : {}),
      ...(patch.notes !== undefined ? { notes: sanitizeLabel(patch.notes, 1000) || null } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(outreachContacts.userId, userId), eq(outreachContacts.id, contactId)));
}

export async function markContactVerified(
  userId: string,
  contactId: string,
  status: 'unverified' | 'user_confirmed' | 'bounced',
): Promise<void> {
  await getContact(userId, contactId);
  await getDb()
    .update(outreachContacts)
    .set({ verificationStatus: status, updatedAt: new Date() })
    .where(and(eq(outreachContacts.userId, userId), eq(outreachContacts.id, contactId)));
}

export async function deleteContact(userId: string, contactId: string): Promise<void> {
  await getContact(userId, contactId);
  await getDb().delete(outreachContacts).where(and(eq(outreachContacts.userId, userId), eq(outreachContacts.id, contactId)));
}

/* -------------------------------------------------------------- suppression */

/**
 * Add an email to the user's stop-contact list. Once suppressed, `send()` in
 * `send.ts` refuses to deliver to it regardless of which draft or contact
 * requests it.
 */
export async function suppressEmail(userId: string, email: string, reason = 'user_requested'): Promise<void> {
  const normalised = email.trim().toLowerCase();
  if (!isValidEmail(normalised)) throw new ContactValidationError('That does not look like a valid email address.');

  await getDb()
    .insert(outreachSuppressions)
    .values({ userId, email: normalised, reason })
    .onConflictDoNothing({ target: [outreachSuppressions.userId, outreachSuppressions.email] });

  await recordAudit({
    userId,
    action: 'outreach.suppressed',
    entityType: 'outreach_suppression',
    metadata: { reason },
  });
}

export async function unsuppressEmail(userId: string, email: string): Promise<void> {
  await getDb()
    .delete(outreachSuppressions)
    .where(and(eq(outreachSuppressions.userId, userId), eq(outreachSuppressions.email, email.trim().toLowerCase())));
}

export async function isSuppressed(userId: string, email: string): Promise<boolean> {
  const rows = await getDb()
    .select({ email: outreachSuppressions.email })
    .from(outreachSuppressions)
    .where(and(eq(outreachSuppressions.userId, userId), eq(outreachSuppressions.email, email.trim().toLowerCase())))
    .limit(1);
  return rows.length > 0;
}

export async function listSuppressions(userId: string) {
  return getDb()
    .select()
    .from(outreachSuppressions)
    .where(eq(outreachSuppressions.userId, userId))
    .orderBy(desc(outreachSuppressions.createdAt));
}

/** Has this user already sent mail to this address, and when. */
export async function lastSendToRecipient(
  userId: string,
  email: string,
): Promise<{ sentAt: Date | null; count: number } | null> {
  const rows = await getDb()
    .select({ sentAt: outreachSends.sentAt, status: outreachSends.status })
    .from(outreachSends)
    .where(and(eq(outreachSends.userId, userId), eq(outreachSends.recipient, email.trim().toLowerCase())));

  const successful = rows.filter((r) => r.status === 'sent');
  if (successful.length === 0) return null;

  const latest = successful.reduce<Date | null>((latestSoFar, r) => {
    if (!r.sentAt) return latestSoFar;
    return !latestSoFar || r.sentAt > latestSoFar ? r.sentAt : latestSoFar;
  }, null);

  return { sentAt: latest, count: successful.length };
}
