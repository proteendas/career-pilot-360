/**
 * Outreach sending — the only path in the codebase that emails a real person.
 * Every guarantee here is tested against a real database and a captured (not
 * mocked-in-spirit) email provider, so a passing suite means the guarantee
 * actually holds through the persistence layer, not just in isolated logic.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  createTestDb,
  createUser,
  resetAdapters,
  useCapturingEmail,
  type CapturingEmailProvider,
  type TestDb,
  type TestUser,
} from './helpers/db';
import * as schema from '@/lib/db/schema';
import { createContact, isSuppressed, suppressEmail, unsuppressEmail } from '@/lib/outreach/contacts';
import { createDraft, generateDraftContent, getDraft } from '@/lib/outreach/drafts';
import { buildSendPreview, OutreachSendError, sendOutreachEmail } from '@/lib/outreach/send';
import { loadProfile } from '@/lib/profile/service';
import { emptyResume } from '@/lib/resume/types';
import { checkRateLimit, __clearRateLimitMemory } from '@/lib/rate-limit';

let harness: TestDb;
let email: CapturingEmailProvider;
let user: TestUser;

beforeAll(async () => {
  harness = await createTestDb();
  user = await createUser(harness.db, 'sender@example.com');
});

beforeEach(async () => {
  email = useCapturingEmail();
  await __clearRateLimitMemory();
});

afterAll(async () => {
  resetAdapters();
  await harness.close();
});

async function makeDraft(recipientEmail: string, contactName = 'Jordan Recruiter') {
  const contactId = await createContact(user.id, {
    name: contactName,
    email: recipientEmail,
    source: 'user_provided',
    provenance: 'Given to me directly by the contact.',
  });
  const profile = await loadProfile(user.id);
  const content = await generateDraftContent(
    user.id,
    { contact: await (await import('@/lib/outreach/contacts')).getContact(user.id, contactId), job: null, profile, resume: emptyResume() },
    { useAi: false },
  );
  const draftId = await createDraft(user.id, { contactId, content });
  return { contactId, draftId };
}

describe('contact provenance', () => {
  it('accepts only the permitted source values', async () => {
    for (const source of ['user_provided', 'public_company_page', 'authorized_api', 'manual'] as const) {
      await expect(
        createContact(user.id, { name: 'Test', source, provenance: 'test' }),
      ).resolves.toBeTruthy();
    }
  });

  it('rejects an invalid email on creation', async () => {
    await expect(
      createContact(user.id, { name: 'Bad Email', email: 'not-an-email', source: 'manual', provenance: 'test' }),
    ).rejects.toThrow(/valid email/i);
  });

  it('rejects an invalid LinkedIn URL', async () => {
    await expect(
      createContact(user.id, { name: 'Bad URL', linkedinUrl: 'not a url', source: 'manual', provenance: 'test' }),
    ).rejects.toThrow(/not valid/i);
  });
});

describe('preview shows the exact recipient before sending', () => {
  it('shows the real recipient, subject and body', async () => {
    const { draftId } = await makeDraft('preview-target@example.com');
    const preview = await buildSendPreview(user.id, draftId, { kind: 'initial', senderEmail: user.email });
    expect(preview.recipient).toBe('preview-target@example.com');
    expect(preview.subject.length).toBeGreaterThan(0);
    expect(preview.body.length).toBeGreaterThan(0);
  });

  it('refuses a contact with no email', async () => {
    const contactId = await createContact(user.id, { name: 'No Email', source: 'manual', provenance: 'test' });
    const profile = await loadProfile(user.id);
    const { getContact } = await import('@/lib/outreach/contacts');
    const content = await generateDraftContent(
      user.id,
      { contact: await getContact(user.id, contactId), job: null, profile, resume: emptyResume() },
      { useAi: false },
    );
    const draftId = await createDraft(user.id, { contactId, content });

    await expect(
      buildSendPreview(user.id, draftId, { kind: 'initial', senderEmail: user.email }),
    ).rejects.toBeInstanceOf(OutreachSendError);
  });
});

describe('sending requires explicit confirmation', () => {
  it('rejects a call without confirmed: true at the type level and at runtime', async () => {
    const { draftId } = await makeDraft('confirm-required@example.com');
    // @ts-expect-error — confirmed is required and typed as the literal true.
    await expect(sendOutreachEmail(user.id, { draftId, kind: 'initial' })).rejects.toBeInstanceOf(OutreachSendError);
    expect(email.sent).toHaveLength(0);
  });
});

describe('suppression list is an absolute veto', () => {
  it('blocks a send to a suppressed address even with confirmation', async () => {
    const { draftId } = await makeDraft('blocked@example.com');
    await suppressEmail(user.id, 'blocked@example.com');

    await expect(
      sendOutreachEmail(user.id, { draftId, kind: 'initial', confirmed: true }),
    ).rejects.toMatchObject({ code: 'suppressed' });
    expect(email.sent).toHaveLength(0);
  });

  it('allows sending again once removed from suppression', async () => {
    const { draftId } = await makeDraft('unblocked@example.com');
    await suppressEmail(user.id, 'unblocked@example.com');
    await unsuppressEmail(user.id, 'unblocked@example.com');

    const result = await sendOutreachEmail(user.id, { draftId, kind: 'initial', confirmed: true });
    expect(result.ok).toBe(true);
    expect(email.sent).toHaveLength(1);
  });

  it('is scoped per user', async () => {
    const bob = await createUser(harness.db, 'bob-outreach@example.com');
    await suppressEmail(user.id, 'shared-target@example.com');
    expect(await isSuppressed(user.id, 'shared-target@example.com')).toBe(true);
    expect(await isSuppressed(bob.id, 'shared-target@example.com')).toBe(false);
  });
});

describe('idempotency prevents a double send', () => {
  it('sending the same draft+kind twice delivers only once', async () => {
    const { draftId } = await makeDraft('idempotent@example.com');

    const first = await sendOutreachEmail(user.id, { draftId, kind: 'initial', confirmed: true });
    const second = await sendOutreachEmail(user.id, { draftId, kind: 'initial', confirmed: true });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.sendId).toBe(first.sendId);
    // The provider was only actually invoked once.
    expect(email.sent).toHaveLength(1);
  });

  it('a follow-up uses a distinct idempotency key from the initial send', async () => {
    const { draftId } = await makeDraft('followup-key@example.com');
    const initial = await sendOutreachEmail(user.id, { draftId, kind: 'initial', confirmed: true });
    const followUp = await sendOutreachEmail(user.id, { draftId, kind: 'follow_up', confirmed: true });

    expect(initial.sendId).not.toBe(followUp.sendId);
    expect(email.sent).toHaveLength(2);
  });
});

describe('duplicate-recipient protection', () => {
  it('blocks a second send to the same address within the cooldown without override', async () => {
    const { draftId: firstDraft } = await makeDraft('repeat-target@example.com', 'First Contact');
    await sendOutreachEmail(user.id, { draftId: firstDraft, kind: 'initial', confirmed: true });

    // A second, unrelated draft to the SAME recipient address.
    const { draftId: secondDraft } = await makeDraft('repeat-target@example.com', 'Second Contact');
    await expect(
      sendOutreachEmail(user.id, { draftId: secondDraft, kind: 'initial', confirmed: true }),
    ).rejects.toMatchObject({ code: 'duplicate_recipient' });
    expect(email.sent).toHaveLength(1);
  });

  it('allows the repeat once explicitly overridden', async () => {
    const { draftId: firstDraft } = await makeDraft('override-target@example.com', 'First');
    await sendOutreachEmail(user.id, { draftId: firstDraft, kind: 'initial', confirmed: true });

    const { draftId: secondDraft } = await makeDraft('override-target@example.com', 'Second');
    const result = await sendOutreachEmail(user.id, {
      draftId: secondDraft,
      kind: 'initial',
      confirmed: true,
      overrideDuplicate: true,
    });
    expect(result.ok).toBe(true);
    expect(email.sent).toHaveLength(2);
  });

  it('records the override in the audit log', async () => {
    const events = await harness.db
      .select()
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.userId, user.id), eq(schema.auditEvents.action, 'outreach.email_sent')));
    const overridden = events.find((e) => (e.metadata as { overrodeDuplicate?: boolean })?.overrodeDuplicate === true);
    expect(overridden).toBeDefined();
  });
});

describe('daily send limit', () => {
  it('is enforced as a hard cap, not advisory', async () => {
    // Exhaust the limit directly against the same counter sendOutreachEmail uses.
    for (let i = 0; i < 20; i++) {
      const r = await checkRateLimit('emailSend', user.id);
      expect(r.allowed, `attempt ${i}`).toBe(true);
    }
    const over = await checkRateLimit('emailSend', user.id);
    expect(over.allowed).toBe(false);

    const { draftId } = await makeDraft('over-limit@example.com');
    await expect(
      sendOutreachEmail(user.id, { draftId, kind: 'initial', confirmed: true }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
  });
});

describe('failure handling', () => {
  it('records a failure and does not silently retry', async () => {
    email.shouldFail = true;
    const { draftId } = await makeDraft('will-fail@example.com');

    const result = await sendOutreachEmail(user.id, { draftId, kind: 'initial', confirmed: true });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();

    const rows = await harness.db
      .select()
      .from(schema.outreachSends)
      .where(eq(schema.outreachSends.id, result.sendId));
    expect(rows[0]?.status).toBe('failed');
    expect(email.sent).toHaveLength(0);
  });

  it('a subsequent explicit retry with the same draft can still succeed', async () => {
    email.shouldFail = true;
    const { draftId } = await makeDraft('retry-after-fail@example.com');
    const failed = await sendOutreachEmail(user.id, { draftId, kind: 'initial', confirmed: true });
    expect(failed.ok).toBe(false);

    email.shouldFail = false;
    const retried = await sendOutreachEmail(user.id, { draftId, kind: 'initial', confirmed: true });
    expect(retried.ok).toBe(true);
    expect(email.sent).toHaveLength(1);
  });
});

describe('grounding of AI-free drafts', () => {
  it('deterministic drafts never claim a prior connection', async () => {
    const { draftId } = await makeDraft('grounded@example.com');
    const draft = await getDraft(user.id, draftId);
    expect(draft.body.toLowerCase()).not.toMatch(/as we discussed|great speaking with you|as mentioned/);
  });
});

describe('tenant isolation', () => {
  it('a second user cannot send from another user’s draft', async () => {
    const { draftId } = await makeDraft('isolated@example.com');
    const bob = await createUser(harness.db, 'bob-iso@example.com');
    await expect(sendOutreachEmail(bob.id, { draftId, kind: 'initial', confirmed: true })).rejects.toThrow();
  });
});
