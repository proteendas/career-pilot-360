'use server';

/**
 * Resume server actions.
 *
 * Every action re-derives the caller from the session — an id in the arguments
 * is never trusted as proof of ownership. Reads go through
 * `src/lib/resume/service.ts`, which forces a `user_id` predicate.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { enforceRateLimit, RateLimitError } from '@/lib/rate-limit';
import { NotFoundError } from '@/lib/db/tenant';
import { SecurityError } from '@/lib/security';
import { loadProfile } from '@/lib/profile/service';
import { recordAudit } from '@/lib/audit';
import { AiError } from '@/lib/ai/types';
import { aiAvailability } from '@/lib/ai/client';
import {
  atsContextFromProfile,
  createVersion,
  deleteVersion,
  duplicateVersion,
  exportVersionPdf,
  getLatestAnalysis,
  getStructured,
  getSuggestion,
  getVersion,
  listSuggestions,
  renameVersion,
  replaceSuggestions,
  restoreVersion,
  runAnalysis,
  setDefaultVersion,
  setSuggestionStatus,
  updateVersionContent,
} from '@/lib/resume/service';
import { analyzeResume, type AtsReport } from '@/lib/resume/ats';
import { applySuggestion, generateSuggestions, type Suggestion } from '@/lib/resume/suggestions';
import { assertNoFabrication, resumeToPlainText, structuredResumeSchema } from '@/lib/resume/types';
import { profileToProse } from '@/lib/profile/prose';
import { RESUME_TEMPLATES } from '@/lib/resume/pdf';

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  notice?: string;
  data?: T;
}

/** Translate internal errors into something safe and useful to show a user. */
function toResult(err: unknown): ActionResult<never> {
  if (err instanceof RateLimitError) {
    return { ok: false, error: `Too many requests. Try again in ${err.retryAfterSeconds}s.` };
  }
  if (err instanceof NotFoundError) return { ok: false, error: err.message };
  if (err instanceof SecurityError) return { ok: false, error: err.message };
  if (err instanceof AiError) return { ok: false, error: err.message };
  console.error('[resume-action] unexpected failure', err);
  return { ok: false, error: 'Something went wrong. Please try again.' };
}

/* ---------------------------------------------------------------- analysis */

export interface AnalysisPayload {
  report: AtsReport;
  suggestionCount: number;
  usedAi: boolean;
  aiProvider: string | null;
  aiNotice?: string;
  rejectedCount: number;
}

/**
 * Re-run the analysis and regenerate suggestions.
 *
 * The deterministic pass always runs. The AI pass is attempted only when a
 * provider is configured, and a failure there is reported as a notice rather
 * than an error — the user still gets a complete deterministic result.
 */
export async function analyzeResumeAction(versionId: string): Promise<ActionResult<AnalysisPayload>> {
  try {
    const user = await requireUser();
    await enforceRateLimit('aiTask', `analyze:${user.id}`);

    const profile = await loadProfile(user.id);
    const report = await runAnalysis(user.id, versionId, profile);
    const resume = await getStructured(user.id, versionId);
    const analysis = await getLatestAnalysis(user.id, versionId);

    const availability = await aiAvailability(user.id, 'resume_suggestions');
    let suggestions: Suggestion[] = [];
    let usedAi = false;
    let aiProvider: string | null = null;
    let aiNotice: string | undefined;
    let rejectedCount = 0;

    if (availability.available) {
      const result = await generateSuggestions({
        userId: user.id,
        resume,
        report,
        profileSummary: profileToProse(profile),
      });
      suggestions = result.suggestions;
      usedAi = result.usedAi;
      aiProvider = result.provider;
      rejectedCount = result.rejected.length;
      if (result.aiError) {
        aiNotice = `${result.aiError} The deterministic suggestions below are unaffected.`;
      } else if (result.rejected.length > 0) {
        aiNotice =
          `${result.rejected.length} AI rewrite(s) were discarded for introducing figures that do not appear ` +
          'in your resume or profile.';
      }
    } else {
      const { deterministicSuggestions } = await import('@/lib/resume/suggestions');
      suggestions = deterministicSuggestions(resume, report);
      aiNotice = availability.reason;
    }

    await replaceSuggestions(
      user.id,
      versionId,
      analysis?.id ?? null,
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

    revalidatePath(`/resume/${versionId}/analysis`);
    revalidatePath(`/resume/${versionId}/suggestions`);
    revalidatePath('/dashboard');

    return {
      ok: true,
      data: {
        report,
        suggestionCount: suggestions.length,
        usedAi,
        aiProvider,
        rejectedCount,
        ...(aiNotice ? { aiNotice } : {}),
      },
    };
  } catch (err) {
    return toResult(err);
  }
}

/** Score the current content without persisting — used for live previews. */
export async function previewScoreAction(versionId: string): Promise<ActionResult<{ score: number }>> {
  try {
    const user = await requireUser();
    const [resume, profile] = await Promise.all([getStructured(user.id, versionId), loadProfile(user.id)]);
    const report = analyzeResume(resume, atsContextFromProfile(profile));
    return { ok: true, data: { score: report.overallScore } };
  } catch (err) {
    return toResult(err);
  }
}

/* ------------------------------------------------------------- suggestions */

const decisionSchema = z.object({
  suggestionId: z.string().uuid(),
  decision: z.enum(['accept', 'reject', 'edit']),
  editedText: z.string().max(2000).optional(),
});

export interface DecisionPayload {
  newVersionId?: string;
  scoreBefore: number;
  scoreAfter: number;
}

/**
 * Accept, reject or edit one suggestion.
 *
 * Accepting creates a NEW version rather than mutating the current one, so the
 * user can always get their previous wording back. The fabrication guard runs
 * again on the result: a suggestion that somehow slipped through earlier is
 * refused here.
 */
export async function decideSuggestionAction(raw: unknown): Promise<ActionResult<DecisionPayload>> {
  try {
    const user = await requireUser();
    const parsed = decisionSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'That decision could not be understood.' };

    const { suggestionId, decision, editedText } = parsed.data;
    const suggestion = await getSuggestion(user.id, suggestionId);
    const versionId = suggestion.resumeVersionId;

    if (decision === 'reject') {
      await setSuggestionStatus(user.id, suggestionId, 'rejected');
      await recordAudit({
        userId: user.id,
        action: 'resume.suggestion_rejected',
        entityType: 'resume_suggestion',
        entityId: suggestionId,
        metadata: { category: suggestion.category, sectionPath: suggestion.sectionPath },
      });
      revalidatePath(`/resume/${versionId}/suggestions`);
      return { ok: true, notice: 'Suggestion dismissed.', data: { scoreBefore: 0, scoreAfter: 0 } };
    }

    const text = decision === 'edit' ? (editedText ?? '').trim() : suggestion.suggestedText;
    if (!text) {
      return {
        ok: false,
        error:
          decision === 'edit'
            ? 'Enter the replacement text.'
            : 'This suggestion has no replacement text — it is guidance for you to act on.',
      };
    }

    const [profile, currentResume] = await Promise.all([
      loadProfile(user.id),
      getStructured(user.id, versionId),
    ]);
    const version = await getVersion(user.id, versionId);
    const ctx = atsContextFromProfile(profile);
    const scoreBefore = analyzeResume(currentResume, ctx).overallScore;

    const applied = applySuggestion(
      currentResume,
      { sectionPath: suggestion.sectionPath ?? '', suggestedText: text },
      decision === 'edit' ? text : undefined,
    );

    if (!applied.applied) {
      return {
        ok: false,
        error: 'This suggestion is guidance rather than a direct replacement — apply it in the editor.',
      };
    }

    // The guard runs on the RESULT, not just the proposal.
    const corpus = `${resumeToPlainText(currentResume)}\n\n${profileToProse(profile)}`;
    const fabrications = assertNoFabrication(applied.resume, corpus);
    if (fabrications.length > 0) {
      return {
        ok: false,
        error:
          `That text introduces figures not present in your resume or profile (${fabrications[0]!.unsupported.join(', ')}). ` +
          'Add the underlying detail to your profile first, or reword without the numbers.',
      };
    }

    const scoreAfter = analyzeResume(applied.resume, ctx).overallScore;

    const newVersionId = await createVersion(user.id, {
      name: version.name,
      structuredContent: applied.resume,
      sourceResumeId: version.sourceResumeId,
      parentVersionId: version.id,
      isDefault: version.isDefault,
      template: version.template,
      templateOptions: (version.templateOptions ?? {}) as Record<string, unknown>,
    });

    await setSuggestionStatus(user.id, suggestionId, decision === 'edit' ? 'edited' : 'accepted', {
      ...(decision === 'edit' ? { userEditedText: text } : {}),
      appliedToVersionId: newVersionId,
    });

    await recordAudit({
      userId: user.id,
      action: decision === 'edit' ? 'resume.suggestion_edited' : 'resume.suggestion_accepted',
      entityType: 'resume_suggestion',
      entityId: suggestionId,
      beforeSummary: suggestion.originalText.slice(0, 200),
      afterSummary: text.slice(0, 200),
      metadata: {
        category: suggestion.category,
        sectionPath: suggestion.sectionPath,
        newVersionId,
        scoreBefore,
        scoreAfter,
      },
    });

    revalidatePath('/resume');
    revalidatePath(`/resume/${newVersionId}/suggestions`);
    revalidatePath('/dashboard');

    return {
      ok: true,
      notice:
        scoreAfter > scoreBefore
          ? `Applied. Heuristic score moved from ${scoreBefore} to ${scoreAfter}.`
          : 'Applied to a new version.',
      data: { newVersionId, scoreBefore, scoreAfter },
    };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Apply every suggestion marked safe to auto-apply.
 * Only mechanical rewrites qualify; AI rewrites never do.
 */
export async function acceptAllSafeAction(versionId: string): Promise<ActionResult<DecisionPayload>> {
  try {
    const user = await requireUser();
    const [profile, resume, version, stored] = await Promise.all([
      loadProfile(user.id),
      getStructured(user.id, versionId),
      getVersion(user.id, versionId),
      listSuggestions(user.id, versionId),
    ]);

    const safe = stored.filter((s) => s.status === 'pending' && s.safeToAutoApply && s.suggestedText);
    if (safe.length === 0) {
      return { ok: false, error: 'There are no suggestions that can be applied automatically.' };
    }

    const ctx = atsContextFromProfile(profile);
    const scoreBefore = analyzeResume(resume, ctx).overallScore;

    let current = resume;
    const appliedIds: string[] = [];
    for (const s of safe) {
      const result = applySuggestion(current, { sectionPath: s.sectionPath ?? '', suggestedText: s.suggestedText });
      if (result.applied) {
        current = result.resume;
        appliedIds.push(s.id);
      }
    }

    if (appliedIds.length === 0) {
      return { ok: false, error: 'None of those suggestions could be applied automatically.' };
    }

    const corpus = `${resumeToPlainText(resume)}\n\n${profileToProse(profile)}`;
    const fabrications = assertNoFabrication(current, corpus);
    if (fabrications.length > 0) {
      return { ok: false, error: 'Applying those changes would introduce unsupported figures. Nothing was changed.' };
    }

    const scoreAfter = analyzeResume(current, ctx).overallScore;

    const newVersionId = await createVersion(user.id, {
      name: version.name,
      structuredContent: current,
      sourceResumeId: version.sourceResumeId,
      parentVersionId: version.id,
      isDefault: version.isDefault,
      template: version.template,
      templateOptions: (version.templateOptions ?? {}) as Record<string, unknown>,
    });

    for (const id of appliedIds) {
      await setSuggestionStatus(user.id, id, 'accepted', { appliedToVersionId: newVersionId });
      await recordAudit({
        userId: user.id,
        action: 'resume.suggestion_accepted',
        entityType: 'resume_suggestion',
        entityId: id,
        metadata: { batch: true, newVersionId },
      });
    }

    revalidatePath('/resume');
    revalidatePath('/dashboard');

    return {
      ok: true,
      notice: `Applied ${appliedIds.length} safe change(s). Heuristic score ${scoreBefore} → ${scoreAfter}.`,
      data: { newVersionId, scoreBefore, scoreAfter },
    };
  } catch (err) {
    return toResult(err);
  }
}

/* ------------------------------------------------------------ version CRUD */

export async function renameVersionAction(versionId: string, name: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const trimmed = (name ?? '').trim();
    if (!trimmed) return { ok: false, error: 'Enter a name.' };
    await renameVersion(user.id, versionId, trimmed);
    revalidatePath('/resume');
    return { ok: true, notice: 'Renamed.' };
  } catch (err) {
    return toResult(err);
  }
}

export async function duplicateVersionAction(versionId: string): Promise<ActionResult<{ versionId: string }>> {
  try {
    const user = await requireUser();
    const newId = await duplicateVersion(user.id, versionId);
    revalidatePath('/resume');
    return { ok: true, notice: 'Duplicated.', data: { versionId: newId } };
  } catch (err) {
    return toResult(err);
  }
}

export async function restoreVersionAction(versionId: string): Promise<ActionResult<{ versionId: string }>> {
  try {
    const user = await requireUser();
    const newId = await restoreVersion(user.id, versionId);
    revalidatePath('/resume');
    return { ok: true, notice: 'Restored into a new version. Nothing was overwritten.', data: { versionId: newId } };
  } catch (err) {
    return toResult(err);
  }
}

export async function setDefaultVersionAction(versionId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await setDefaultVersion(user.id, versionId);
    revalidatePath('/resume');
    revalidatePath('/dashboard');
    return { ok: true, notice: 'Default resume updated.' };
  } catch (err) {
    return toResult(err);
  }
}

export async function deleteVersionAction(versionId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await deleteVersion(user.id, versionId);
    revalidatePath('/resume');
    revalidatePath('/dashboard');
    return { ok: true, notice: 'Version deleted. Your original upload is untouched.' };
  } catch (err) {
    return toResult(err);
  }
}

/** Save edits from the inline resume editor. */
export async function saveResumeContentAction(versionId: string, content: unknown): Promise<ActionResult<{ score: number }>> {
  try {
    const user = await requireUser();
    const parsed = structuredResumeSchema.safeParse(content);
    if (!parsed.success) return { ok: false, error: 'Some resume fields were not valid.' };

    await updateVersionContent(user.id, versionId, parsed.data);
    const profile = await loadProfile(user.id);
    const report = analyzeResume(parsed.data, atsContextFromProfile(profile));

    revalidatePath(`/resume/${versionId}`);
    return { ok: true, notice: 'Saved.', data: { score: report.overallScore } };
  } catch (err) {
    return toResult(err);
  }
}

/* --------------------------------------------------------------- PDF export */

const exportSchema = z.object({
  versionId: z.string().uuid(),
  template: z.enum(RESUME_TEMPLATES).optional(),
  margin: z.number().min(20).max(90).optional(),
  fontSize: z.number().min(8).max(12).optional(),
  lineSpacing: z.number().min(1).max(2).optional(),
  accentColor: z.string().max(9).optional(),
  pageMode: z.enum(['single', 'multi']).optional(),
});

export async function exportPdfAction(
  raw: unknown,
): Promise<ActionResult<{ pageCount: number; truncated: boolean; downloadUrl: string }>> {
  try {
    const user = await requireUser();
    const parsed = exportSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'Those export options were not valid.' };

    await enforceRateLimit('pdfExport', user.id);

    const { versionId, ...options } = parsed.data;
    const result = await exportVersionPdf(user.id, versionId, options);

    revalidatePath(`/resume/${versionId}`);

    return {
      ok: true,
      notice: result.truncated
        ? `Generated ${result.pageCount} pages. Single-page mode could not fit this content at these settings.`
        : `Generated a ${result.pageCount}-page PDF.`,
      data: {
        pageCount: result.pageCount,
        truncated: result.truncated,
        downloadUrl: `/api/resume/${versionId}/pdf`,
      },
    };
  } catch (err) {
    return toResult(err);
  }
}
