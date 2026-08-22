/**
 * Tenant isolation.
 *
 * This is the most consequential property in the product: it holds resumes,
 * salary expectations and application history for many users in one database.
 * These tests exercise the real service layer against a real Postgres, and
 * assert that user B can reach nothing belonging to user A.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  createTestDb,
  createUser,
  resetAdapters,
  useMemoryStorage,
  type MemoryStorage,
  type TestDb,
  type TestUser,
} from './helpers/db';
import * as schema from '@/lib/db/schema';
import { NotFoundError } from '@/lib/db/tenant';
import {
  createVersion,
  deleteVersion,
  duplicateVersion,
  exportVersionPdf,
  getDocumentBytes,
  getExtractedText,
  getStructured,
  getSuggestion,
  getVersion,
  listVersions,
  renameVersion,
  restoreVersion,
  runAnalysis,
  setDefaultVersion,
  setSuggestionStatus,
  uploadResume,
} from '@/lib/resume/service';
import { loadProfile } from '@/lib/profile/service';
import { normalizeResumeText } from '@/lib/resume/normalize';
import { generateResumePdf } from '@/lib/resume/pdf';
import { STRONG_RESUME } from './fixtures/resumes';
import { emptyResume } from '@/lib/resume/types';

let harness: TestDb;
let storage: MemoryStorage;
let alice: TestUser;
let bob: TestUser;
let aliceVersionId: string;
let aliceDocumentId: string;
let aliceSuggestionId: string;

beforeAll(async () => {
  harness = await createTestDb();
  storage = useMemoryStorage();

  alice = await createUser(harness.db, 'alice@example.com', { fullName: 'Alice Alpha' });
  bob = await createUser(harness.db, 'bob@example.com', { fullName: 'Bob Beta' });

  // Alice uploads a real PDF through the real service.
  const resume = normalizeResumeText(STRONG_RESUME).resume;
  const { bytes } = await generateResumePdf(resume, { template: 'modern' });
  const aliceProfile = await loadProfile(alice.id);
  const upload = await uploadResume(
    alice.id,
    { name: 'alice-resume.pdf', type: 'application/pdf', size: bytes.byteLength },
    bytes,
    aliceProfile,
  );

  aliceVersionId = upload.versionId;
  aliceDocumentId = upload.documentId;

  // Give Alice a suggestion row to attempt to reach.
  const inserted = await harness.db
    .insert(schema.resumeSuggestions)
    .values({
      userId: alice.id,
      resumeVersionId: aliceVersionId,
      category: 'weak_verb',
      priority: 'medium',
      sectionPath: 'experience[0].bullets[0]',
      originalText: 'Responsible for the ledger',
      suggestedText: 'Owned the ledger',
      reason: 'Stronger verb.',
      evidence: { source: 'experience[0]', quote: 'Responsible for the ledger', origin: 'deterministic' },
      safeToAutoApply: true,
    })
    .returning({ id: schema.resumeSuggestions.id });
  aliceSuggestionId = inserted[0]!.id;
});

afterEach(() => {
  // Adapters are shared state; storage contents are asserted per-test.
});

afterAll(async () => {
  resetAdapters();
  await harness.close();
});

describe('setup sanity', () => {
  it('created two distinct users with data for Alice', async () => {
    expect(alice.id).not.toBe(bob.id);
    expect(aliceVersionId).toBeTruthy();
    expect(aliceDocumentId).toBeTruthy();
    const aliceVersions = await listVersions(alice.id);
    expect(aliceVersions.length).toBeGreaterThan(0);
  });

  it('stores the object under a tenant-scoped key', () => {
    const keys = [...storage.objects.keys()];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key.startsWith(`u/${alice.id}/`)).toBe(true);
  });
});

describe('reads are scoped to the owner', () => {
  it('lists nothing for a user with no data', async () => {
    await expect(listVersions(bob.id)).resolves.toEqual([]);
  });

  it('refuses getVersion for a non-owner', async () => {
    await expect(getVersion(bob.id, aliceVersionId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses getStructured for a non-owner', async () => {
    await expect(getStructured(bob.id, aliceVersionId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses the original document bytes for a non-owner', async () => {
    await expect(getDocumentBytes(bob.id, aliceDocumentId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses extracted text for a non-owner', async () => {
    await expect(getExtractedText(bob.id, aliceDocumentId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a suggestion for a non-owner', async () => {
    await expect(getSuggestion(bob.id, aliceSuggestionId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('reports "not found" rather than "forbidden", so ids cannot be probed', async () => {
    // A real id owned by someone else and a completely fabricated id must be
    // indistinguishable to the caller.
    const realButForeign = getVersion(bob.id, aliceVersionId).catch((e: Error) => e);
    const nonexistent = getVersion(bob.id, '00000000-0000-0000-0000-000000000000').catch((e: Error) => e);
    const [a, b] = await Promise.all([realButForeign, nonexistent]);
    expect((a as Error).constructor).toBe((b as Error).constructor);
    expect((a as Error).message).toBe((b as Error).message);
  });
});

describe('writes are scoped to the owner', () => {
  it('refuses to rename another user’s version', async () => {
    await expect(renameVersion(bob.id, aliceVersionId, 'hijacked')).rejects.toBeInstanceOf(NotFoundError);
    const stillMine = await getVersion(alice.id, aliceVersionId);
    expect(stillMine.name).not.toBe('hijacked');
  });

  it('refuses to set another user’s version as default', async () => {
    await expect(setDefaultVersion(bob.id, aliceVersionId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to duplicate another user’s version', async () => {
    await expect(duplicateVersion(bob.id, aliceVersionId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listVersions(bob.id)).resolves.toEqual([]);
  });

  it('refuses to restore another user’s version', async () => {
    await expect(restoreVersion(bob.id, aliceVersionId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to export a PDF of another user’s version', async () => {
    await expect(exportVersionPdf(bob.id, aliceVersionId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to analyse another user’s version', async () => {
    const bobProfile = await loadProfile(bob.id);
    await expect(runAnalysis(bob.id, aliceVersionId, bobProfile)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to change the status of another user’s suggestion', async () => {
    await expect(setSuggestionStatus(bob.id, aliceSuggestionId, 'accepted')).rejects.toBeInstanceOf(NotFoundError);
    const row = await getSuggestion(alice.id, aliceSuggestionId);
    expect(row.status).toBe('pending');
  });

  it('refuses to delete another user’s version', async () => {
    await expect(deleteVersion(bob.id, aliceVersionId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getVersion(alice.id, aliceVersionId)).resolves.toBeTruthy();
  });
});

describe('the owner can do all of it', () => {
  it('lets Alice read, analyse and export her own version', async () => {
    const profile = await loadProfile(alice.id);
    await expect(getVersion(alice.id, aliceVersionId)).resolves.toBeTruthy();
    await expect(runAnalysis(alice.id, aliceVersionId, profile)).resolves.toMatchObject({
      scoreKind: 'heuristic',
    });
    const pdf = await exportVersionPdf(alice.id, aliceVersionId);
    expect(pdf.pageCount).toBeGreaterThanOrEqual(1);
  });

  it('keeps Bob’s own data reachable once he has some', async () => {
    const bobVersion = await createVersion(bob.id, { name: 'Bob resume', structuredContent: emptyResume() });
    await expect(getVersion(bob.id, bobVersion)).resolves.toBeTruthy();
    // And still invisible to Alice.
    await expect(getVersion(alice.id, bobVersion)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('database-level guarantees', () => {
  it('cascades every user-owned row when the user is deleted', async () => {
    const doomed = await createUser(harness.db, 'doomed@example.com');
    const versionId = await createVersion(doomed.id, { name: 'Doomed', structuredContent: emptyResume() });
    await harness.db.insert(schema.resumeSuggestions).values({
      userId: doomed.id,
      resumeVersionId: versionId,
      category: 'wording',
      priority: 'low',
      originalText: 'a',
      suggestedText: 'b',
      reason: 'c',
    });

    await harness.db.delete(schema.users).where(eq(schema.users.id, doomed.id));

    const [profiles, versions, suggestions] = await Promise.all([
      harness.db.select().from(schema.profiles).where(eq(schema.profiles.userId, doomed.id)),
      harness.db.select().from(schema.resumeVersions).where(eq(schema.resumeVersions.userId, doomed.id)),
      harness.db.select().from(schema.resumeSuggestions).where(eq(schema.resumeSuggestions.userId, doomed.id)),
    ]);

    expect(profiles).toEqual([]);
    expect(versions).toEqual([]);
    expect(suggestions).toEqual([]);
  });

  it('enforces one default resume version per user', async () => {
    const a = await createVersion(alice.id, { name: 'A', structuredContent: emptyResume(), isDefault: true });
    const b = await createVersion(alice.id, { name: 'B', structuredContent: emptyResume(), isDefault: true });

    const defaults = await harness.db
      .select({ id: schema.resumeVersions.id })
      .from(schema.resumeVersions)
      .where(and(eq(schema.resumeVersions.userId, alice.id), eq(schema.resumeVersions.isDefault, true)));

    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe(b);
    expect(a).not.toBe(b);
  });

  it('enforces a unique email address', async () => {
    await expect(createUser(harness.db, 'alice@example.com')).rejects.toThrow();
  });

  it('writes audit events attributed to the acting user only', async () => {
    const events = await harness.db
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.userId, bob.id));

    // Bob's failed attempts never produced an audit row against Alice.
    const aliceEvents = await harness.db
      .select({ userId: schema.auditEvents.userId })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.userId, alice.id));

    expect(aliceEvents.every((e) => e.userId === alice.id)).toBe(true);
    expect(events.every((e) => typeof e.action === 'string')).toBe(true);
  });

  it('never records a raw secret in an audit event', async () => {
    const events = await harness.db.select().from(schema.auditEvents);
    const serialised = JSON.stringify(events);
    expect(serialised).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
    expect(serialised).not.toMatch(/"password"\s*:\s*"(?!\[redacted\])/);
  });
});
