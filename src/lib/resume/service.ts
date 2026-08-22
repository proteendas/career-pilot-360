/**
 * Resume persistence: upload, parse, versioning, analysis and PDF export.
 * Server-only. Every function is scoped to a `userId`.
 *
 * Version model:
 *   resume_documents   the original upload's CONTENT, immutable and never
 *                      edited. For a PDF, the bytes actually written to
 *                      storage may not be byte-identical to what was
 *                      uploaded — see `optimizePdfBytes` — but every word,
 *                      page and layout choice is guaranteed unchanged.
 *   resume_versions    an editable tree; `parentVersionId` records lineage, so
 *                      "restore" is a new version rather than a mutation.
 *
 * That distinction is deliberate: a user who accepts a suggestion and dislikes
 * the result must be able to get their original wording back exactly.
 */
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  generatedDocuments,
  getDb,
  resumeAnalyses,
  resumeDocuments,
  resumeSuggestions,
  resumeVersions,
  type ResumeVersion,
} from '@/lib/db';
import { NotFoundError } from '@/lib/db/tenant';
import { contentHash, validateUpload, type ValidatedUpload } from '@/lib/security';
import { getStorage, resumeOriginalPath, resumePdfPath } from '@/lib/storage';
import { recordAudit } from '@/lib/audit';
import { extractText } from './parse';
import { optimizePdfBytes } from './optimize';
import { enrichContactFromProfile, normalizeResumeText } from './normalize';
import {
  parseStructuredResume,
  resumeToPlainText,
  type StructuredResume,
} from './types';
import { analyzeResume, type AtsContext, type AtsReport } from './ats';
import { generateResumePdf, isResumeTemplate, type PdfOptions, type ResumeTemplate } from './pdf';
import type { FullProfile } from '@/lib/profile/types';

/* ------------------------------------------------------------------ upload */

export interface UploadResult {
  documentId: string;
  versionId: string;
  extractedChars: number;
  warnings: string[];
  detectedSections: string[];
  filledFromProfile: string[];
  atsScore: number;
}

/**
 * Store an uploaded resume, parse it, create the first version, and score it.
 *
 * The original bytes are written to storage before anything is parsed, so a
 * parser failure never loses the user's file — they can retry or download it.
 */
export async function uploadResume(
  userId: string,
  file: { name: string; type: string; size: number },
  bytes: Uint8Array,
  profile: FullProfile,
  opts: { name?: string; requestId?: string } = {},
): Promise<UploadResult> {
  const validated: ValidatedUpload = validateUpload(file, bytes);
  const db = getDb();
  const hash = await contentHash(bytes);

  // Storage-only optimization: a PDF that round-trips through pdf-lib
  // unchanged in content but smaller in bytes is stored instead of the raw
  // upload. Parsing below still reads `validated.bytes` (the true original),
  // never the optimized copy, so this can only affect storage size, never
  // what gets extracted.
  let storedBytes: Uint8Array = validated.bytes;
  let optimizedSavedBytes = 0;
  if (validated.kind === 'pdf') {
    const optimized = await optimizePdfBytes(validated.bytes);
    if (optimized.optimized) {
      storedBytes = optimized.bytes;
      optimizedSavedBytes = optimized.originalSize - optimized.finalSize;
    }
  }

  // 1. Persist the original first.
  const inserted = await db
    .insert(resumeDocuments)
    .values({
      userId,
      originalFilename: validated.filename,
      mimeType: validated.mimeType,
      blobPath: 'pending',
      sizeBytes: storedBytes.byteLength,
      contentHash: hash,
      parsingStatus: 'pending',
    })
    .returning({ id: resumeDocuments.id });

  const documentId = inserted[0]!.id;
  const path = resumeOriginalPath(userId, documentId, validated.filename);

  const stored = await getStorage().put(path, storedBytes, validated.mimeType);
  await db
    .update(resumeDocuments)
    .set({ blobPath: stored.path, blobUrl: stored.url })
    .where(eq(resumeDocuments.id, documentId));

  await recordAudit({
    userId,
    action: 'resume.uploaded',
    entityType: 'resume_document',
    entityId: documentId,
    metadata: {
      filename: validated.filename,
      kind: validated.kind,
      sizeBytes: storedBytes.byteLength,
      ...(optimizedSavedBytes > 0 ? { optimizedSavedBytes } : {}),
    },
    ...(opts.requestId ? { requestId: opts.requestId } : {}),
  });

  // 2. Parse. A failure is recorded against the document, not thrown away.
  let extraction;
  try {
    extraction = await extractText(validated.bytes, validated.kind);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown parsing failure';
    await db
      .update(resumeDocuments)
      .set({ parsingStatus: 'failed', parsingError: message })
      .where(eq(resumeDocuments.id, documentId));
    await recordAudit({
      userId,
      action: 'resume.parse_failed',
      entityType: 'resume_document',
      entityId: documentId,
      metadata: { reason: message },
    });
    throw err;
  }

  // 3. Normalise into the canonical structure, then fill contact gaps from the
  //    user's own profile (their data, not invented).
  const { resume: parsed, warnings, detectedSections } = normalizeResumeText(extraction.text);
  const { resume: enriched, filled } = enrichContactFromProfile(parsed, {
    fullName: profile.personal.fullName,
    email: profile.personal.email,
    phone: profile.personal.phone,
    city: profile.personal.city,
    country: profile.personal.country,
    linkedinUrl: profile.professional.linkedinUrl,
    githubUrl: profile.professional.githubUrl,
    portfolioUrl: profile.professional.portfolioUrl,
    websiteUrl: profile.professional.websiteUrl,
    headline: profile.professional.currentTitle,
  });

  const allWarnings = [...extraction.warnings, ...warnings];

  await db
    .update(resumeDocuments)
    .set({
      extractedText: extraction.text,
      parsingStatus: extraction.meta.likelyScanned ? 'needs_review' : 'parsed',
      parsingMeta: { ...extraction.meta, warnings: allWarnings, detectedSections },
    })
    .where(eq(resumeDocuments.id, documentId));

  await recordAudit({
    userId,
    action: 'resume.parsed',
    entityType: 'resume_document',
    entityId: documentId,
    metadata: {
      chars: extraction.text.length,
      pageCount: extraction.meta.pageCount,
      detectedSections,
      warningCount: allWarnings.length,
    },
  });

  // 4. First version.
  const existingCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(resumeVersions)
    .where(eq(resumeVersions.userId, userId));
  const isFirst = Number(existingCount[0]?.count ?? 0) === 0;

  const versionId = await createVersion(userId, {
    name: opts.name?.trim() || deriveVersionName(validated.filename),
    structuredContent: enriched,
    sourceResumeId: documentId,
    parentVersionId: null,
    isDefault: isFirst,
    template: 'classic',
  });

  // 5. Score it immediately: the user should land on a result, not a blank page.
  const report = await runAnalysis(userId, versionId, profile);

  return {
    documentId,
    versionId,
    extractedChars: extraction.text.length,
    warnings: allWarnings,
    detectedSections,
    filledFromProfile: filled,
    atsScore: report.overallScore,
  };
}

function deriveVersionName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return base ? base.slice(0, 80) : 'Uploaded resume';
}

/* ---------------------------------------------------------------- versions */

export interface CreateVersionInput {
  name: string;
  structuredContent: StructuredResume;
  sourceResumeId?: string | null;
  parentVersionId?: string | null;
  jobId?: string | null;
  isDefault?: boolean;
  isTailored?: boolean;
  template?: string;
  templateOptions?: Record<string, unknown>;
}

export async function createVersion(userId: string, input: CreateVersionInput): Promise<string> {
  const db = getDb();
  const plainText = resumeToPlainText(input.structuredContent);
  const hash = await contentHash(plainText);

  const rows = await db
    .insert(resumeVersions)
    .values({
      userId,
      name: input.name.slice(0, 200),
      structuredContent: input.structuredContent,
      plainText,
      contentHash: hash,
      sourceResumeId: input.sourceResumeId ?? null,
      parentVersionId: input.parentVersionId ?? null,
      jobId: input.jobId ?? null,
      isDefault: input.isDefault ?? false,
      isTailored: input.isTailored ?? false,
      template: input.template ?? 'classic',
      templateOptions: input.templateOptions ?? {},
    })
    .returning({ id: resumeVersions.id });

  const versionId = rows[0]!.id;

  if (input.isDefault) await setDefaultVersion(userId, versionId, { audit: false });

  await recordAudit({
    userId,
    action: 'resume.version_created',
    entityType: 'resume_version',
    entityId: versionId,
    afterSummary: input.name,
    metadata: {
      parentVersionId: input.parentVersionId ?? null,
      isTailored: input.isTailored ?? false,
      jobId: input.jobId ?? null,
    },
  });

  return versionId;
}

export async function listVersions(userId: string): Promise<ResumeVersion[]> {
  return getDb()
    .select()
    .from(resumeVersions)
    .where(eq(resumeVersions.userId, userId))
    .orderBy(desc(resumeVersions.isDefault), desc(resumeVersions.createdAt));
}

export async function getVersion(userId: string, versionId: string): Promise<ResumeVersion> {
  const rows = await getDb()
    .select()
    .from(resumeVersions)
    .where(and(eq(resumeVersions.userId, userId), eq(resumeVersions.id, versionId)))
    .limit(1);
  const row = rows[0];
  // Indistinguishable from "does not exist", so ids cannot be probed.
  if (!row) throw new NotFoundError('That resume version was not found.');
  return row;
}

export async function getStructured(userId: string, versionId: string): Promise<StructuredResume> {
  const version = await getVersion(userId, versionId);
  return parseStructuredResume(version.structuredContent);
}

/** Update a version's content in place. Used by the inline editor. */
export async function updateVersionContent(
  userId: string,
  versionId: string,
  structuredContent: StructuredResume,
): Promise<void> {
  await getVersion(userId, versionId);
  const plainText = resumeToPlainText(structuredContent);
  await getDb()
    .update(resumeVersions)
    .set({
      structuredContent,
      plainText,
      contentHash: await contentHash(plainText),
      // The stored PDF no longer matches the content.
      pdfBlobPath: null,
      pdfBlobUrl: null,
      updatedAt: new Date(),
    })
    .where(and(eq(resumeVersions.userId, userId), eq(resumeVersions.id, versionId)));
}

export async function duplicateVersion(userId: string, versionId: string, name?: string): Promise<string> {
  const source = await getVersion(userId, versionId);
  return createVersion(userId, {
    name: name?.trim() || `${source.name} (copy)`,
    structuredContent: parseStructuredResume(source.structuredContent),
    sourceResumeId: source.sourceResumeId,
    parentVersionId: source.id,
    template: source.template,
    templateOptions: (source.templateOptions ?? {}) as Record<string, unknown>,
  });
}

/**
 * "Restore" creates a NEW version from an older one rather than rewinding.
 * History stays append-only, so nothing a user did is ever lost.
 */
export async function restoreVersion(userId: string, versionId: string): Promise<string> {
  const source = await getVersion(userId, versionId);
  const newId = await createVersion(userId, {
    name: `${source.name} (restored)`,
    structuredContent: parseStructuredResume(source.structuredContent),
    sourceResumeId: source.sourceResumeId,
    parentVersionId: source.id,
    template: source.template,
    templateOptions: (source.templateOptions ?? {}) as Record<string, unknown>,
  });

  await recordAudit({
    userId,
    action: 'resume.version_restored',
    entityType: 'resume_version',
    entityId: newId,
    beforeSummary: source.name,
    metadata: { restoredFrom: source.id },
  });

  return newId;
}

export async function renameVersion(userId: string, versionId: string, name: string): Promise<void> {
  await getVersion(userId, versionId);
  await getDb()
    .update(resumeVersions)
    .set({ name: name.trim().slice(0, 200), updatedAt: new Date() })
    .where(and(eq(resumeVersions.userId, userId), eq(resumeVersions.id, versionId)));
}

export async function setDefaultVersion(
  userId: string,
  versionId: string,
  opts: { audit?: boolean } = {},
): Promise<void> {
  const db = getDb();
  await getVersion(userId, versionId);

  await db
    .update(resumeVersions)
    .set({ isDefault: false })
    .where(and(eq(resumeVersions.userId, userId), ne(resumeVersions.id, versionId)));
  await db
    .update(resumeVersions)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(and(eq(resumeVersions.userId, userId), eq(resumeVersions.id, versionId)));

  if (opts.audit !== false) {
    await recordAudit({
      userId,
      action: 'resume.default_changed',
      entityType: 'resume_version',
      entityId: versionId,
    });
  }
}

export async function getDefaultVersion(userId: string): Promise<ResumeVersion | null> {
  const rows = await getDb()
    .select()
    .from(resumeVersions)
    .where(eq(resumeVersions.userId, userId))
    .orderBy(desc(resumeVersions.isDefault), desc(resumeVersions.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Delete a version and its generated PDFs. The original upload is untouched. */
export async function deleteVersion(userId: string, versionId: string): Promise<void> {
  const db = getDb();
  const version = await getVersion(userId, versionId);

  const docs = await db
    .select({ blobPath: generatedDocuments.blobPath })
    .from(generatedDocuments)
    .where(and(eq(generatedDocuments.userId, userId), eq(generatedDocuments.resumeVersionId, versionId)));

  const storage = getStorage();
  for (const doc of docs) {
    await storage.remove(doc.blobPath).catch(() => undefined);
  }
  if (version.pdfBlobPath) await storage.remove(version.pdfBlobPath).catch(() => undefined);

  await db.delete(resumeVersions).where(and(eq(resumeVersions.userId, userId), eq(resumeVersions.id, versionId)));

  // Promote another version so the user is never left without a default.
  if (version.isDefault) {
    const next = await getDefaultVersion(userId);
    if (next) await setDefaultVersion(userId, next.id, { audit: false });
  }

  await recordAudit({
    userId,
    action: 'resume.version_deleted',
    entityType: 'resume_version',
    entityId: versionId,
    beforeSummary: version.name,
  });
}

/* ---------------------------------------------------------------- documents */

export async function listDocuments(userId: string) {
  return getDb()
    .select({
      id: resumeDocuments.id,
      originalFilename: resumeDocuments.originalFilename,
      mimeType: resumeDocuments.mimeType,
      sizeBytes: resumeDocuments.sizeBytes,
      parsingStatus: resumeDocuments.parsingStatus,
      parsingError: resumeDocuments.parsingError,
      parsingMeta: resumeDocuments.parsingMeta,
      createdAt: resumeDocuments.createdAt,
    })
    .from(resumeDocuments)
    .where(eq(resumeDocuments.userId, userId))
    .orderBy(desc(resumeDocuments.createdAt));
}

export async function getDocumentBytes(
  userId: string,
  documentId: string,
): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> {
  const rows = await getDb()
    .select()
    .from(resumeDocuments)
    .where(and(eq(resumeDocuments.userId, userId), eq(resumeDocuments.id, documentId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('That document was not found.');

  const object = await getStorage().get(row.blobPath);
  if (!object) throw new NotFoundError('The stored file could not be read.');

  return { bytes: object.bytes, contentType: row.mimeType || object.contentType, filename: row.originalFilename };
}

export async function getExtractedText(userId: string, documentId: string): Promise<string> {
  const rows = await getDb()
    .select({ extractedText: resumeDocuments.extractedText })
    .from(resumeDocuments)
    .where(and(eq(resumeDocuments.userId, userId), eq(resumeDocuments.id, documentId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('That document was not found.');
  return rows[0].extractedText ?? '';
}

/* ----------------------------------------------------------------- analysis */

/** Build the ATS context from the user's profile and, optionally, a job. */
export function atsContextFromProfile(
  profile: FullProfile,
  job?: { title?: string; description?: string },
): AtsContext {
  return {
    targetTitles: [
      ...(profile.professional.targetTitles ?? []),
      ...(profile.jobPreferences.preferredRoles ?? []),
    ].filter(Boolean),
    preferredLocations: profile.jobPreferences.preferredLocations ?? [],
    ...(profile.professional.careerLevel ? { careerLevel: profile.professional.careerLevel } : {}),
    ...(profile.professional.yearsOfExperience === undefined
      ? {}
      : { yearsOfExperience: profile.professional.yearsOfExperience }),
    profileSkills: profile.professional.skills ?? [],
    ...(job?.title ? { jobTitle: job.title } : {}),
    ...(job?.description ? { jobDescription: job.description } : {}),
  };
}

/** Run the deterministic analysis and persist it. */
export async function runAnalysis(
  userId: string,
  versionId: string,
  profile: FullProfile,
  job?: { id?: string; title?: string; description?: string },
): Promise<AtsReport> {
  const resume = await getStructured(userId, versionId);
  const report = analyzeResume(resume, atsContextFromProfile(profile, job));

  await getDb().insert(resumeAnalyses).values({
    userId,
    resumeVersionId: versionId,
    jobId: job?.id ?? null,
    overallScore: report.overallScore,
    report,
    mode: 'heuristic',
  });

  await recordAudit({
    userId,
    action: 'resume.analysis_created',
    entityType: 'resume_version',
    entityId: versionId,
    metadata: {
      score: report.overallScore,
      findingCount: report.findings.length,
      jobId: job?.id ?? null,
      mode: 'heuristic',
    },
  });

  return report;
}

/** Latest stored analysis for a version, or null. */
export async function getLatestAnalysis(
  userId: string,
  versionId: string,
): Promise<{ report: AtsReport; createdAt: Date; id: string } | null> {
  const rows = await getDb()
    .select({
      id: resumeAnalyses.id,
      report: resumeAnalyses.report,
      createdAt: resumeAnalyses.createdAt,
    })
    .from(resumeAnalyses)
    .where(and(eq(resumeAnalyses.userId, userId), eq(resumeAnalyses.resumeVersionId, versionId), isNull(resumeAnalyses.jobId)))
    .orderBy(desc(resumeAnalyses.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { report: row.report as AtsReport, createdAt: row.createdAt, id: row.id };
}

/** Score history for a version, oldest first, for the trend chart. */
export async function getAnalysisHistory(userId: string, versionId: string) {
  const rows = await getDb()
    .select({ overallScore: resumeAnalyses.overallScore, createdAt: resumeAnalyses.createdAt })
    .from(resumeAnalyses)
    .where(and(eq(resumeAnalyses.userId, userId), eq(resumeAnalyses.resumeVersionId, versionId)))
    .orderBy(resumeAnalyses.createdAt);
  return rows;
}

/* ----------------------------------------------------------- PDF export --- */

export interface ExportResult {
  documentId: string;
  path: string;
  pageCount: number;
  contentHash: string;
  template: ResumeTemplate;
  truncated: boolean;
  bytes: Uint8Array;
}

/**
 * Render a version to PDF, store it, and record its provenance.
 * Every generated document is traceable to the user, version, template,
 * timestamp, content hash and — when AI shaped the content — the model used.
 */
export async function exportVersionPdf(
  userId: string,
  versionId: string,
  options: PdfOptions & { jobId?: string | null; provider?: string | null; model?: string | null } = {},
): Promise<ExportResult> {
  const version = await getVersion(userId, versionId);
  const resume = parseStructuredResume(version.structuredContent);

  const storedOptions = (version.templateOptions ?? {}) as PdfOptions;
  const template: ResumeTemplate = isResumeTemplate(options.template ?? version.template)
    ? ((options.template ?? version.template) as ResumeTemplate)
    : 'classic';

  const pdf = await generateResumePdf(resume, { ...storedOptions, ...options, template });

  const path = resumePdfPath(userId, versionId, pdf.contentHash);
  const storage = getStorage();
  // Overwriting the same content hash is a no-op; remove first so re-export of
  // changed content cannot collide with a stale object.
  await storage.remove(path).catch(() => undefined);
  const stored = await storage.put(path, pdf.bytes, 'application/pdf');

  const db = getDb();
  const inserted = await db
    .insert(generatedDocuments)
    .values({
      userId,
      resumeVersionId: versionId,
      jobId: options.jobId ?? version.jobId ?? null,
      kind: 'resume_pdf',
      template,
      blobPath: stored.path,
      blobUrl: stored.url,
      contentHash: pdf.contentHash,
      provider: options.provider ?? null,
      model: options.model ?? null,
    })
    .returning({ id: generatedDocuments.id });

  await db
    .update(resumeVersions)
    .set({
      pdfBlobPath: stored.path,
      pdfBlobUrl: stored.url,
      template,
      templateOptions: { ...storedOptions, ...options },
      updatedAt: new Date(),
    })
    .where(and(eq(resumeVersions.userId, userId), eq(resumeVersions.id, versionId)));

  await recordAudit({
    userId,
    action: 'resume.pdf_generated',
    entityType: 'resume_version',
    entityId: versionId,
    metadata: {
      template,
      pageCount: pdf.pageCount,
      contentHash: pdf.contentHash,
      generatedDocumentId: inserted[0]!.id,
      jobId: options.jobId ?? null,
    },
  });

  return {
    documentId: inserted[0]!.id,
    path: stored.path,
    pageCount: pdf.pageCount,
    contentHash: pdf.contentHash,
    template,
    truncated: pdf.truncated,
    bytes: pdf.bytes,
  };
}

/** Read back a stored PDF for download. */
export async function getGeneratedPdf(
  userId: string,
  versionId: string,
): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const version = await getVersion(userId, versionId);
  if (!version.pdfBlobPath) return null;
  const object = await getStorage().get(version.pdfBlobPath);
  if (!object) return null;
  return { bytes: object.bytes, filename: `${slugify(version.name)}.pdf` };
}

export function slugify(value: string): string {
  return (
    (value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'resume'
  );
}

/**
 * Delete a version's generated PDF — the stored file and the version's
 * pointer to it — without touching the version's content, history or
 * suggestions. A later export regenerates it on demand.
 */
export async function deleteGeneratedPdf(userId: string, versionId: string): Promise<void> {
  const version = await getVersion(userId, versionId);
  if (!version.pdfBlobPath) return;

  await getStorage().remove(version.pdfBlobPath).catch(() => undefined);

  await getDb()
    .update(resumeVersions)
    .set({ pdfBlobPath: null, pdfBlobUrl: null, updatedAt: new Date() })
    .where(and(eq(resumeVersions.userId, userId), eq(resumeVersions.id, versionId)));

  await recordAudit({
    userId,
    action: 'resume.pdf_deleted',
    entityType: 'resume_version',
    entityId: versionId,
    beforeSummary: version.name,
  });
}

/* -------------------------------------------------------------- suggestions */

export async function replaceSuggestions(
  userId: string,
  versionId: string,
  analysisId: string | null,
  suggestions: {
    category: string;
    priority: string;
    sectionPath: string;
    originalText: string;
    suggestedText: string;
    reason: string;
    evidence: unknown;
    safeToAutoApply: boolean;
  }[],
): Promise<void> {
  const db = getDb();

  // Only pending suggestions are cleared: a decision the user already made is
  // part of their history and must survive a re-analysis.
  await db
    .delete(resumeSuggestions)
    .where(
      and(
        eq(resumeSuggestions.userId, userId),
        eq(resumeSuggestions.resumeVersionId, versionId),
        eq(resumeSuggestions.status, 'pending'),
      ),
    );

  if (suggestions.length === 0) return;

  await db.insert(resumeSuggestions).values(
    suggestions.map((s) => ({
      userId,
      resumeVersionId: versionId,
      analysisId,
      category: s.category,
      priority: s.priority,
      sectionPath: s.sectionPath,
      originalText: s.originalText,
      suggestedText: s.suggestedText,
      reason: s.reason,
      evidence: s.evidence as Record<string, unknown>,
      safeToAutoApply: s.safeToAutoApply,
      status: 'pending' as const,
    })),
  );
}

export async function listSuggestions(userId: string, versionId: string) {
  return getDb()
    .select()
    .from(resumeSuggestions)
    .where(and(eq(resumeSuggestions.userId, userId), eq(resumeSuggestions.resumeVersionId, versionId)))
    .orderBy(resumeSuggestions.createdAt);
}

export async function getSuggestion(userId: string, suggestionId: string) {
  const rows = await getDb()
    .select()
    .from(resumeSuggestions)
    .where(and(eq(resumeSuggestions.userId, userId), eq(resumeSuggestions.id, suggestionId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('That suggestion was not found.');
  return rows[0];
}

export async function setSuggestionStatus(
  userId: string,
  suggestionId: string,
  status: 'pending' | 'accepted' | 'rejected' | 'edited' | 'applied',
  opts: { userEditedText?: string; appliedToVersionId?: string } = {},
): Promise<void> {
  await getSuggestion(userId, suggestionId);
  await getDb()
    .update(resumeSuggestions)
    .set({
      status,
      ...(opts.userEditedText === undefined ? {} : { userEditedText: opts.userEditedText }),
      ...(opts.appliedToVersionId === undefined ? {} : { appliedToVersionId: opts.appliedToVersionId }),
      updatedAt: new Date(),
    })
    .where(and(eq(resumeSuggestions.userId, userId), eq(resumeSuggestions.id, suggestionId)));
}

/**
 * Carry every suggestion (pending or already decided) forward onto the new
 * version created by accepting/editing one of them.
 *
 * Suggestions are generated once per analysis but a review session applies
 * them one at a time, each creating a new version. Without this, every
 * suggestion still stays attached to the OLD version: the moment the user is
 * redirected to the version they just created, the rest of the list — which
 * is still perfectly valid, since the sectionPath indices this suggestion
 * didn't touch are unchanged — appears to have vanished.
 */
export async function moveSuggestionsToVersion(
  userId: string,
  fromVersionId: string,
  toVersionId: string,
): Promise<void> {
  if (fromVersionId === toVersionId) return;
  await getDb()
    .update(resumeSuggestions)
    .set({ resumeVersionId: toVersionId, updatedAt: new Date() })
    .where(and(eq(resumeSuggestions.userId, userId), eq(resumeSuggestions.resumeVersionId, fromVersionId)));
}
