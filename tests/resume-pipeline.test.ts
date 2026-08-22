/**
 * The core resume journey, end to end against a real database:
 *
 *   upload → parse → normalise → score → suggest → accept → new version → PDF
 *
 * This is the flow the product is judged on, so it is exercised through the
 * real service layer rather than mocked at the seams.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import {
  createVersion,
  exportVersionPdf,
  getDocumentBytes,
  getGeneratedPdf,
  getLatestAnalysis,
  getStructured,
  listVersions,
  replaceSuggestions,
  restoreVersion,
  runAnalysis,
  uploadResume,
  deleteVersion,
} from '@/lib/resume/service';
import { loadProfile } from '@/lib/profile/service';
import { normalizeResumeText } from '@/lib/resume/normalize';
import { generateResumePdf } from '@/lib/resume/pdf';
import { deterministicSuggestions, applySuggestion, rewriteWeakOpening } from '@/lib/resume/suggestions';
import { extractText } from '@/lib/resume/parse';
import { STRONG_RESUME, WEAK_RESUME } from './fixtures/resumes';
import { emptyResume } from '@/lib/resume/types';

let harness: TestDb;
let storage: MemoryStorage;
let user: TestUser;

beforeAll(async () => {
  harness = await createTestDb();
  storage = useMemoryStorage();
  user = await createUser(harness.db, 'pipeline@example.com', { fullName: 'Priya Sharma' });
});

afterAll(async () => {
  resetAdapters();
  await harness.close();
});

describe('upload → parse → score', () => {
  let versionId: string;
  let documentId: string;

  it('accepts a real PDF and produces a scored version', async () => {
    const resume = normalizeResumeText(STRONG_RESUME).resume;
    const { bytes } = await generateResumePdf(resume, { template: 'modern' });
    const profile = await loadProfile(user.id);

    const result = await uploadResume(
      user.id,
      { name: 'priya-resume.pdf', type: 'application/pdf', size: bytes.byteLength },
      bytes,
      profile,
      { name: 'Base resume' },
    );

    versionId = result.versionId;
    documentId = result.documentId;

    expect(result.extractedChars).toBeGreaterThan(500);
    expect(result.atsScore).toBeGreaterThan(60);
    expect(result.detectedSections).toContain('experience');
    expect(result.detectedSections).toContain('skills');
  });

  it('preserves the original upload\'s content exactly, even though storage applies a lossless size optimization', async () => {
    // Not byte-for-byte: uploaded PDFs are re-saved through pdf-lib with
    // object streams before storage (see optimizePdfBytes) to use less of
    // the storage quota, which changes the PDF's internal byte layout. The
    // guarantee that matters — same visible content — is checked directly
    // by re-extracting text from what's actually stored, rather than by
    // comparing bytes.
    const resume = normalizeResumeText(STRONG_RESUME).resume;
    const { bytes } = await generateResumePdf(resume, { template: 'modern' });
    const stored = await getDocumentBytes(user.id, documentId);

    expect(stored.bytes.byteLength).toBeLessThanOrEqual(bytes.byteLength);
    const { text: expectedText } = await extractText(bytes, 'pdf');
    const { text: storedText } = await extractText(stored.bytes, 'pdf');
    expect(storedText).toBe(expectedText);
  });

  it('marks the first version as the default', async () => {
    const versions = await listVersions(user.id);
    expect(versions.find((v) => v.id === versionId)?.isDefault).toBe(true);
  });

  it('records the upload, parse and analysis in the audit log', async () => {
    const events = await harness.db
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.userId, user.id));

    const actions = events.map((e) => e.action);
    expect(actions).toContain('resume.uploaded');
    expect(actions).toContain('resume.parsed');
    expect(actions).toContain('resume.version_created');
    expect(actions).toContain('resume.analysis_created');
  });

  it('persists a retrievable analysis', async () => {
    const analysis = await getLatestAnalysis(user.id, versionId);
    expect(analysis).not.toBeNull();
    expect(analysis!.report.scoreKind).toBe('heuristic');
    expect(analysis!.report.signals).toHaveLength(14);
  });

  it('rejects a file whose bytes do not match its extension', async () => {
    const profile = await loadProfile(user.id);
    const notAPdf = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]);
    await expect(
      uploadResume(user.id, { name: 'fake.pdf', type: 'application/pdf', size: 6 }, notAPdf, profile),
    ).rejects.toThrow(/not a valid PDF/);
  });
});

describe('suggest → accept → new version', () => {
  let baseVersionId: string;

  beforeAll(async () => {
    // Start from the weak resume so there is real work to suggest.
    const weak = normalizeResumeText(WEAK_RESUME).resume;
    baseVersionId = await createVersion(user.id, { name: 'Weak base', structuredContent: weak });
  });

  it('produces deterministic suggestions with evidence', async () => {
    const profile = await loadProfile(user.id);
    const report = await runAnalysis(user.id, baseVersionId, profile);
    const resume = await getStructured(user.id, baseVersionId);
    const suggestions = deterministicSuggestions(resume, report);

    expect(suggestions.length).toBeGreaterThan(0);
    // Every suggestion must cite something.
    for (const s of suggestions) {
      expect(s.evidence.source, s.id).toBeTruthy();
      expect(s.reason.length, s.id).toBeGreaterThan(10);
    }
  });

  it('marks only mechanical rewrites as safe to auto-apply', async () => {
    const profile = await loadProfile(user.id);
    const report = await runAnalysis(user.id, baseVersionId, profile);
    const resume = await getStructured(user.id, baseVersionId);
    const suggestions = deterministicSuggestions(resume, report);

    for (const s of suggestions) {
      if (!s.safeToAutoApply) continue;
      expect(s.category, s.id).toBe('weak_verb');
      expect(s.evidence.origin, s.id).toBe('deterministic');
      expect(s.suggestedText.length, s.id).toBeGreaterThan(0);
    }
  });

  it('never offers replacement text for a missing metric', async () => {
    const profile = await loadProfile(user.id);
    const report = await runAnalysis(user.id, baseVersionId, profile);
    const resume = await getStructured(user.id, baseVersionId);
    const suggestions = deterministicSuggestions(resume, report);

    for (const s of suggestions.filter((x) => x.category === 'missing_metric')) {
      // Supplying text here would mean inventing the number.
      expect(s.suggestedText).toBe('');
      expect(s.safeToAutoApply).toBe(false);
      expect(s.reason).toMatch(/will not invent/i);
    }
  });

  it('rewrites a weak opening without changing the claim', () => {
    const cases: [string, RegExp][] = [
      ['Responsible for the ledger service', /^Owned the ledger service$/],
      ['Worked on various backend tasks', /^Built various backend tasks$/],
      ['Assisted with API development', /^Contributed to API development$/],
      ['Involved in migrations', /^Contributed to migrations$/],
    ];
    for (const [input, expected] of cases) {
      const result = rewriteWeakOpening(input);
      expect(result, input).not.toBeNull();
      expect(result!.text, input).toMatch(expected);
      expect(result!.note.length).toBeGreaterThan(10);
    }
  });

  it('leaves a strong opening alone', () => {
    expect(rewriteWeakOpening('Designed the ledger service')).toBeNull();
    expect(rewriteWeakOpening('Reduced latency by 40%')).toBeNull();
  });

  it('applying a suggestion produces a new version and leaves the original intact', async () => {
    const profile = await loadProfile(user.id);
    const report = await runAnalysis(user.id, baseVersionId, profile);
    const original = await getStructured(user.id, baseVersionId);
    const suggestions = deterministicSuggestions(original, report);

    const safe = suggestions.find((s) => s.safeToAutoApply && s.suggestedText);
    expect(safe).toBeDefined();

    const applied = applySuggestion(original, safe!);
    expect(applied.applied).toBe(true);

    const newVersionId = await createVersion(user.id, {
      name: 'Weak base (improved)',
      structuredContent: applied.resume,
      parentVersionId: baseVersionId,
    });

    // The original still has the old wording.
    const reloadedOriginal = await getStructured(user.id, baseVersionId);
    const reloadedNew = await getStructured(user.id, newVersionId);

    const originalText = JSON.stringify(reloadedOriginal);
    const newText = JSON.stringify(reloadedNew);
    expect(originalText).not.toBe(newText);
    expect(originalText).toContain(safe!.originalText);
    expect(newText).toContain(safe!.suggestedText);

    // Provenance is recorded so the fabrication guard keeps policing it.
    expect(newText).toContain('"source":"suggested"');
  });

  it('improves the heuristic score after applying safe rewrites', async () => {
    const profile = await loadProfile(user.id);
    const report = await runAnalysis(user.id, baseVersionId, profile);
    const resume = await getStructured(user.id, baseVersionId);
    const suggestions = deterministicSuggestions(resume, report);

    let improved = resume;
    for (const s of suggestions.filter((x) => x.safeToAutoApply && x.suggestedText)) {
      const result = applySuggestion(improved, s);
      if (result.applied) improved = result.resume;
    }

    const improvedId = await createVersion(user.id, { name: 'All safe applied', structuredContent: improved });
    const after = await runAnalysis(user.id, improvedId, profile);

    // Weak openings were the thing being fixed, so action language must rise.
    const before = report.signals.find((s) => s.key === 'action_verbs')!.score;
    const afterScore = after.signals.find((s) => s.key === 'action_verbs')!.score;
    expect(afterScore).toBeGreaterThan(before);
  });

  it('stores suggestions and keeps decided ones across a regeneration', async () => {
    const profile = await loadProfile(user.id);
    const report = await runAnalysis(user.id, baseVersionId, profile);
    const resume = await getStructured(user.id, baseVersionId);
    const suggestions = deterministicSuggestions(resume, report);

    await replaceSuggestions(
      user.id,
      baseVersionId,
      null,
      suggestions.map((s) => ({
        category: s.category,
        priority: s.priority,
        sectionPath: s.sectionPath,
        originalText: s.originalText,
        suggestedText: s.suggestedText,
        reason: s.reason,
        evidence: s.evidence,
        safeToAutoApply: s.safeToAutoApply,
      })),
    );

    const stored = await harness.db
      .select()
      .from(schema.resumeSuggestions)
      .where(
        and(
          eq(schema.resumeSuggestions.userId, user.id),
          eq(schema.resumeSuggestions.resumeVersionId, baseVersionId),
        ),
      );
    expect(stored.length).toBe(suggestions.length);

    // Mark one accepted, then regenerate.
    await harness.db
      .update(schema.resumeSuggestions)
      .set({ status: 'accepted' })
      .where(eq(schema.resumeSuggestions.id, stored[0]!.id));

    await replaceSuggestions(user.id, baseVersionId, null, []);

    const after = await harness.db
      .select({ id: schema.resumeSuggestions.id, status: schema.resumeSuggestions.status })
      .from(schema.resumeSuggestions)
      .where(eq(schema.resumeSuggestions.resumeVersionId, baseVersionId));

    // The user's decision survives; only pending rows were cleared.
    expect(after).toHaveLength(1);
    expect(after[0]!.status).toBe('accepted');
  });
});

describe('version history', () => {
  it('restores an old version as a new one rather than rewinding', async () => {
    const first = await createVersion(user.id, {
      name: 'Snapshot',
      structuredContent: normalizeResumeText(STRONG_RESUME).resume,
    });

    const restoredId = await restoreVersion(user.id, first);
    expect(restoredId).not.toBe(first);

    const [before, after] = await Promise.all([getStructured(user.id, first), getStructured(user.id, restoredId)]);
    expect(JSON.stringify(before)).toBe(JSON.stringify(after));

    // Both exist: history is append-only.
    const versions = await listVersions(user.id);
    expect(versions.map((v) => v.id)).toContain(first);
    expect(versions.map((v) => v.id)).toContain(restoredId);
  });

  it('promotes another version to default when the default is deleted', async () => {
    const keeper = await createVersion(user.id, { name: 'Keeper', structuredContent: emptyResume() });
    const doomed = await createVersion(user.id, {
      name: 'Doomed default',
      structuredContent: emptyResume(),
      isDefault: true,
    });

    await deleteVersion(user.id, doomed);

    const versions = await listVersions(user.id);
    expect(versions.find((v) => v.id === doomed)).toBeUndefined();
    expect(versions.filter((v) => v.isDefault)).toHaveLength(1);
    expect(versions.map((v) => v.id)).toContain(keeper);
  });
});

describe('PDF export', () => {
  let versionId: string;

  beforeAll(async () => {
    versionId = await createVersion(user.id, {
      name: 'For export',
      structuredContent: normalizeResumeText(STRONG_RESUME).resume,
    });
  });

  it('stores a PDF with full provenance', async () => {
    const result = await exportVersionPdf(user.id, versionId, { template: 'ats_safe' });

    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const rows = await harness.db
      .select()
      .from(schema.generatedDocuments)
      .where(eq(schema.generatedDocuments.id, result.documentId));

    const doc = rows[0]!;
    expect(doc.userId).toBe(user.id);
    expect(doc.resumeVersionId).toBe(versionId);
    expect(doc.template).toBe('ats_safe');
    expect(doc.contentHash).toBe(result.contentHash);
    expect(doc.generatedAt).toBeInstanceOf(Date);
  });

  it('writes the object under a tenant-scoped key', async () => {
    await exportVersionPdf(user.id, versionId, { template: 'modern' });
    const keys = [...storage.objects.keys()].filter((k) => k.includes('/resumes/pdf/'));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key.startsWith(`u/${user.id}/`)).toBe(true);
  });

  it('serves the stored PDF back, and it still extracts as text', async () => {
    await exportVersionPdf(user.id, versionId, { template: 'modern' });
    const pdf = await getGeneratedPdf(user.id, versionId);

    expect(pdf).not.toBeNull();
    expect(pdf!.filename).toMatch(/\.pdf$/);

    const { text, meta } = await extractText(pdf!.bytes, 'pdf');
    expect(meta.likelyScanned).toBe(false);
    expect(text).toContain('Priya Sharma');
    expect(text).toContain('Northwind Payments');
  });

  it('records a pdf_generated audit event', async () => {
    await exportVersionPdf(user.id, versionId);
    const events = await harness.db
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.userId, user.id), eq(schema.auditEvents.action, 'resume.pdf_generated')));
    expect(events.length).toBeGreaterThan(0);
  });
});
