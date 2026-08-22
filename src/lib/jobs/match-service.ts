/**
 * Match persistence and AI enrichment. Server-only.
 *
 * The score is always the deterministic one from `match.ts`. An AI pass may
 * rewrite the *explanation* into better prose, but it can never change the
 * score, the gaps or the concerns — those stay reproducible and auditable.
 */
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, jobMatches, resumeVersions } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { loadProfile } from '@/lib/profile/service';
import { getDefaultVersion, getStructured } from '@/lib/resume/service';
import { parseStructuredResume, type StructuredResume } from '@/lib/resume/types';
import { generateObject } from '@/lib/ai/client';
import { AiError } from '@/lib/ai/types';
import { SAFETY_PREAMBLE, budgetText, fenceUntrusted } from '@/lib/ai/prompts';
import { profileToProse } from '@/lib/profile/prose';
import { getJob, listJobs, type JobFilters, type JobWithSource } from './service';
import { matchJob, realGaps, type MatchResult } from './match';

/* ---------------------------------------------------------------- scoring -- */

export interface ScoreOptions {
  /** Use this resume version rather than the default. */
  resumeVersionId?: string;
  /** Attempt an AI-written explanation. Falls back silently. */
  enrich?: boolean;
}

interface Context {
  resume: StructuredResume;
  resumeVersionId: string | null;
  profile: Awaited<ReturnType<typeof loadProfile>>;
  versions: { id: string; name: string; plainText: string }[];
}

/** Load everything needed to score, once, for reuse across a batch. */
export async function loadMatchContext(userId: string, resumeVersionId?: string): Promise<Context> {
  const db = getDb();
  const [profile, versions] = await Promise.all([
    loadProfile(userId),
    db
      .select({
        id: resumeVersions.id,
        name: resumeVersions.name,
        plainText: resumeVersions.plainText,
        structuredContent: resumeVersions.structuredContent,
        isDefault: resumeVersions.isDefault,
      })
      .from(resumeVersions)
      .where(eq(resumeVersions.userId, userId))
      .orderBy(desc(resumeVersions.isDefault), desc(resumeVersions.createdAt)),
  ]);

  const chosen = resumeVersionId
    ? versions.find((v) => v.id === resumeVersionId)
    : (versions.find((v) => v.isDefault) ?? versions[0]);

  return {
    resume: chosen ? parseStructuredResume(chosen.structuredContent) : parseStructuredResume({}),
    resumeVersionId: chosen?.id ?? null,
    profile,
    versions: versions.map((v) => ({ id: v.id, name: v.name, plainText: v.plainText })),
  };
}

/** Score one job and persist the result. */
export async function scoreAndStore(
  userId: string,
  job: JobWithSource,
  ctx: Context,
  opts: { enrich?: boolean } = {},
): Promise<MatchResult> {
  let result = matchJob({
    job,
    resume: ctx.resume,
    profile: ctx.profile,
    resumeVersions: ctx.versions,
  });

  if (opts.enrich) {
    const enriched = await enrichExplanation(userId, job, result);
    if (enriched) result = { ...result, explanation: enriched.explanation, mode: 'deterministic+ai' };
  }

  const db = getDb();
  await db
    .insert(jobMatches)
    .values({
      userId,
      jobId: job.id,
      resumeVersionId: ctx.resumeVersionId,
      matchScore: result.score,
      scoreBreakdown: {
        signals: result.signals,
        matchedRequiredSkills: result.matchedRequiredSkills,
        matchedPreferredSkills: result.matchedPreferredSkills,
      },
      missingRequirements: result.gaps,
      transferableSkills: result.transferable,
      concerns: result.concerns,
      explanation: result.explanation,
      recommendedResumeVersionId: result.recommendedResumeVersionId,
      mode: result.mode,
    })
    .onConflictDoUpdate({
      target: [jobMatches.userId, jobMatches.jobId],
      set: {
        resumeVersionId: ctx.resumeVersionId,
        matchScore: result.score,
        scoreBreakdown: {
          signals: result.signals,
          matchedRequiredSkills: result.matchedRequiredSkills,
          matchedPreferredSkills: result.matchedPreferredSkills,
        },
        missingRequirements: result.gaps,
        transferableSkills: result.transferable,
        concerns: result.concerns,
        explanation: result.explanation,
        recommendedResumeVersionId: result.recommendedResumeVersionId,
        mode: result.mode,
        createdAt: new Date(),
      },
    });

  await recordAudit({
    userId,
    action: 'job.matched',
    entityType: 'job',
    entityId: job.id,
    metadata: {
      score: result.score,
      mode: result.mode,
      realGapCount: realGaps(result).length,
      concernCount: result.concerns.length,
      resumeVersionId: ctx.resumeVersionId,
    },
  });

  return result;
}

/** Score every visible job that has no stored match yet. */
export async function scoreJobsForUser(
  userId: string,
  opts: ScoreOptions & { limit?: number; jobIds?: string[] } = {},
): Promise<{ scored: number; skipped: number }> {
  const ctx = await loadMatchContext(userId, opts.resumeVersionId);
  if (!ctx.resumeVersionId) return { scored: 0, skipped: 0 };

  const jobs = opts.jobIds?.length
    ? await Promise.all(opts.jobIds.map((id) => getJob(userId, id).catch(() => null)))
    : await listJobs(userId, { limit: opts.limit ?? 50 });

  let scored = 0;
  let skipped = 0;

  for (const job of jobs) {
    if (!job) {
      skipped += 1;
      continue;
    }
    try {
      // Enrichment is opt-in per call: scoring a batch with AI would be slow
      // and would spend the user's tokens without them asking.
      await scoreAndStore(userId, job, ctx, { enrich: false });
      scored += 1;
    } catch (err) {
      console.error('[match] failed to score one job', err instanceof Error ? err.message : err);
      skipped += 1;
    }
  }

  return { scored, skipped };
}

/* --------------------------------------------------------------- retrieval */

/**
 * The full `MatchResult` shape, reconstructed from a stored row. Kept
 * assignable to `MatchResult` so a page can use either interchangeably
 * without re-deriving anything the database already has.
 */
export type StoredMatch = MatchResult & {
  jobId: string;
  resumeVersionId: string | null;
  createdAt: Date;
};

function toStored(row: typeof jobMatches.$inferSelect): StoredMatch {
  const breakdown = (row.scoreBreakdown ?? {}) as {
    signals?: MatchResult['signals'];
    matchedRequiredSkills?: string[];
    matchedPreferredSkills?: string[];
  };
  return {
    jobId: row.jobId,
    score: row.matchScore,
    mode: row.mode as MatchResult['mode'],
    signals: breakdown.signals ?? [],
    matchedRequiredSkills: breakdown.matchedRequiredSkills ?? [],
    matchedPreferredSkills: breakdown.matchedPreferredSkills ?? [],
    gaps: (row.missingRequirements ?? []) as MatchResult['gaps'],
    transferable: (row.transferableSkills ?? []) as MatchResult['transferable'],
    concerns: (row.concerns ?? []) as MatchResult['concerns'],
    explanation: row.explanation,
    recommendedResumeVersionId: row.recommendedResumeVersionId,
    resumeVersionId: row.resumeVersionId,
    createdAt: row.createdAt,
  };
}

export async function getMatch(userId: string, jobId: string): Promise<StoredMatch | null> {
  const rows = await getDb()
    .select()
    .from(jobMatches)
    .where(and(eq(jobMatches.userId, userId), eq(jobMatches.jobId, jobId)))
    .limit(1);
  return rows[0] ? toStored(rows[0]) : null;
}

export async function getMatches(userId: string, jobIds: string[]): Promise<Map<string, StoredMatch>> {
  if (jobIds.length === 0) return new Map();
  const rows = await getDb()
    .select()
    .from(jobMatches)
    .where(and(eq(jobMatches.userId, userId), inArray(jobMatches.jobId, jobIds)));
  return new Map(rows.map((r) => [r.jobId, toStored(r)]));
}

export interface MatchListItem {
  match: StoredMatch;
  job: JobWithSource;
}

/** Matches at or above `minScore`, best first. */
export async function listMatches(
  userId: string,
  opts: { minScore?: number; limit?: number; filters?: JobFilters } = {},
): Promise<MatchListItem[]> {
  const db = getDb();
  const conditions = [eq(jobMatches.userId, userId)];
  if (opts.minScore !== undefined) conditions.push(gte(jobMatches.matchScore, opts.minScore));

  const rows = await db
    .select()
    .from(jobMatches)
    .where(and(...conditions))
    .orderBy(desc(jobMatches.matchScore), desc(jobMatches.createdAt))
    .limit(Math.min(200, opts.limit ?? 60));

  const out: MatchListItem[] = [];
  for (const row of rows) {
    try {
      const job = await getJob(userId, row.jobId);
      if (job.hidden) continue;
      out.push({ match: toStored(row), job });
    } catch {
      // The job was deleted; the match row will cascade away with it.
      continue;
    }
  }
  return out;
}

/* -------------------------------------------------------------- AI enrich -- */

const explanationSchema = z.object({
  explanation: z
    .string()
    .max(1200)
    .describe('Two to four sentences explaining the fit, grounded strictly in the supplied analysis.'),
});

/**
 * Ask a model to phrase the deterministic result more readably.
 *
 * It is given the computed signals, gaps and concerns as facts, and told it may
 * not introduce anything new. The score is never sent for revision — this is a
 * presentation pass, not a second opinion.
 */
async function enrichExplanation(
  userId: string,
  job: JobWithSource,
  result: MatchResult,
): Promise<{ explanation: string } | null> {
  const analysis = [
    `Deterministic match score: ${result.score}/100`,
    '',
    'Signals:',
    ...result.signals.map(
      (s) => `- ${s.label}: ${s.score === null ? 'not comparable' : `${s.score}/100`} — ${s.explanation}`,
    ),
    '',
    `Skills evidenced: ${result.matchedRequiredSkills.join(', ') || 'none'}`,
    `Genuine gaps: ${realGaps(result).map((g) => g.requirement).join(', ') || 'none'}`,
    `Adjacent skills held: ${result.transferable.map((t) => `${t.candidateHas} (near ${t.jobWants})`).join(', ') || 'none'}`,
    '',
    'Concerns:',
    ...(result.concerns.length ? result.concerns.map((c) => `- [${c.severity}] ${c.title}: ${c.detail}`) : ['- none']),
  ].join('\n');

  const instructions = [
    SAFETY_PREAMBLE,
    '',
    'TASK',
    'Rewrite the supplied match analysis as a short, direct explanation for the candidate.',
    '',
    'Rules:',
    '- Use ONLY the facts in the analysis. Introduce nothing new.',
    '- Do NOT restate or revise the score; it is computed deterministically and is not yours to change.',
    '- Do NOT claim the candidate has a skill listed as a gap. An adjacent skill is context, not a substitute.',
    '- Be candid about weaknesses. An encouraging but misleading summary is worse than a blunt one.',
    '- Two to four sentences. No bullet points, no headings.',
  ].join('\n');

  try {
    const res = await generateObject({
      userId,
      task: 'job_matching',
      schema: explanationSchema,
      schemaName: 'match_explanation',
      temperature: 0.3,
      maxOutputTokens: 500,
      messages: [
        { role: 'system', content: instructions },
        {
          role: 'user',
          content: [
            `Role: ${job.title} at ${job.company}`,
            '',
            'ANALYSIS (facts you must not exceed):',
            analysis,
            '',
            'Job description, for tone only:',
            fenceUntrusted('job_description', budgetText(job.description, 4_000)),
          ].join('\n'),
        },
      ],
    });

    const explanation = res.value.explanation.trim();
    return explanation.length > 20 ? { explanation } : null;
  } catch (err) {
    if (!(err instanceof AiError)) console.error('[match] enrichment failed', err);
    return null;
  }
}

/** Score a single job with AI enrichment, for the job detail page. */
export async function scoreJobWithEnrichment(
  userId: string,
  jobId: string,
  opts: ScoreOptions = {},
): Promise<MatchResult> {
  const [job, ctx] = await Promise.all([getJob(userId, jobId), loadMatchContext(userId, opts.resumeVersionId)]);
  return scoreAndStore(userId, job, ctx, { enrich: opts.enrich ?? false });
}

export { getDefaultVersion, getStructured, profileToProse };
