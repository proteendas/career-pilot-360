'use server';

/**
 * Job server actions: discovery, import, matching.
 *
 * The import path is where the compliance rules bite hardest, so the decision
 * about whether a URL may be fetched is made by `classifyPastedUrl` and
 * enforced by the adapter — never by the caller.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { enforceRateLimit, RateLimitError } from '@/lib/rate-limit';
import { NotFoundError } from '@/lib/db/tenant';
import { SecurityError, validateUrl } from '@/lib/security';
import { AiError } from '@/lib/ai/types';
import { loadProfile } from '@/lib/profile/service';
import { classifyPastedUrl } from '@/lib/jobs/registry';
import { JobSourceError, type NormalizedJob } from '@/lib/jobs/types';
import { buildManualJob, UserUrlAdapter } from '@/lib/jobs/adapters/user-provided';
import { searchJobs, recordSearch, sourceAvailability } from '@/lib/jobs/search';
import {
  deletePrivateJob,
  importJob,
  importJobs,
  listJobs,
  setJobState,
  type JobFilters,
} from '@/lib/jobs/service';
import { loadMatchContext, scoreAndStore, scoreJobsForUser, scoreJobWithEnrichment } from '@/lib/jobs/match-service';
import { getJob } from '@/lib/jobs/service';

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  notice?: string;
  data?: T;
}

function toResult(err: unknown): ActionResult<never> {
  if (err instanceof RateLimitError) {
    return { ok: false, error: `Too many requests. Try again in ${err.retryAfterSeconds}s.` };
  }
  if (err instanceof NotFoundError) return { ok: false, error: err.message };
  if (err instanceof SecurityError) return { ok: false, error: err.message };
  if (err instanceof JobSourceError) return { ok: false, error: err.message };
  if (err instanceof AiError) return { ok: false, error: err.message };
  console.error('[jobs-action] unexpected failure', err);
  return { ok: false, error: 'Something went wrong. Please try again.' };
}

/* -------------------------------------------------------------- discovery -- */

const searchSchema = z.object({
  query: z.string().max(300).optional(),
  titles: z.array(z.string().max(120)).max(10).optional(),
  keywords: z.array(z.string().max(120)).max(20).optional(),
  skills: z.array(z.string().max(80)).max(20).optional(),
  locations: z.array(z.string().max(120)).max(10).optional(),
  companies: z.array(z.string().max(120)).max(20).optional(),
  excludedCompanies: z.array(z.string().max(120)).max(50).optional(),
  workModes: z.array(z.enum(['remote', 'hybrid', 'onsite', 'unknown'])).max(4).optional(),
  minSalary: z.number().min(0).max(1_000_000_000).nullable().optional(),
  postedWithinDays: z.number().min(1).max(365).nullable().optional(),
  limit: z.number().min(1).max(100).optional(),
});

export interface DiscoveryPayload {
  imported: number;
  duplicates: number;
  scored: number;
  sourcesQueried: { adapterKey: string; name: string; count: number }[];
  sourcesSkipped: { adapterKey: string; name: string; reason: string }[];
  sourcesFailed: { adapterKey: string; name: string; error: string }[];
  coverageNote: string;
}

/**
 * Run a discovery pass across permitted sources, import the results, and score
 * them. Returns exactly which sources answered and which did not.
 */
export async function discoverJobsAction(raw: unknown): Promise<ActionResult<DiscoveryPayload>> {
  try {
    const user = await requireUser();
    await enforceRateLimit('jobSearch', user.id);

    const parsed = searchSchema.safeParse(raw ?? {});
    if (!parsed.success) return { ok: false, error: 'Those search filters were not valid.' };

    // Fall back to the user's own preferences when the form is left empty.
    const profile = await loadProfile(user.id);
    const input = {
      ...parsed.data,
      titles: parsed.data.titles?.length
        ? parsed.data.titles
        : [...(profile.professional.targetTitles ?? []), ...(profile.jobPreferences.preferredRoles ?? [])],
      locations: parsed.data.locations?.length ? parsed.data.locations : (profile.jobPreferences.preferredLocations ?? []),
      keywords: parsed.data.keywords?.length ? parsed.data.keywords : (profile.jobPreferences.customKeywords ?? []),
      companies: parsed.data.companies?.length ? parsed.data.companies : (profile.jobPreferences.preferredCompanies ?? []),
      excludedCompanies: parsed.data.excludedCompanies?.length
        ? parsed.data.excludedCompanies
        : (profile.jobPreferences.excludedCompanies ?? []),
      minSalary: parsed.data.minSalary ?? profile.jobPreferences.minExpectedCtc ?? null,
    };

    const outcome = await searchJobs(input);
    await recordSearch(user.id, input, outcome);

    // Public-board and API results are shared; there is no owner.
    const { created, duplicates, jobIds } = await importJobs(outcome.jobs, { userId: user.id, ownerUserId: null });

    const { scored } = jobIds.length > 0 ? await scoreJobsForUser(user.id, { jobIds }) : { scored: 0 };

    revalidatePath('/jobs');
    revalidatePath('/matches');

    return {
      ok: true,
      notice:
        created > 0
          ? `Imported ${created} new job${created === 1 ? '' : 's'}${duplicates > 0 ? `, skipped ${duplicates} already stored` : ''}.`
          : outcome.jobs.length > 0
            ? 'Every result was already in your list.'
            : 'No results from the sources that could be searched.',
      data: {
        imported: created,
        duplicates,
        scored,
        sourcesQueried: outcome.sourcesQueried,
        sourcesSkipped: outcome.sourcesSkipped,
        sourcesFailed: outcome.sourcesFailed,
        coverageNote: outcome.coverageNote,
      },
    };
  } catch (err) {
    return toResult(err);
  }
}

/** Which sources can answer a search, for the UI to state honestly. */
export async function sourceAvailabilityAction(
  companies: string[] = [],
): Promise<ActionResult<{ sources: ReturnType<typeof sourceAvailability> }>> {
  try {
    await requireUser();
    return { ok: true, data: { sources: sourceAvailability({ companies }) } };
  } catch (err) {
    return toResult(err);
  }
}

/* ----------------------------------------------------------- URL preview -- */

export interface UrlPreviewPayload {
  fetched: boolean;
  note: string;
  injectionWarning?: string;
  adapterKey: 'user_url' | 'external_link';
  job: {
    title: string;
    company: string;
    description: string;
    location: string;
    canonicalUrl: string | null;
    skills: string[];
    workMode: string;
    employmentType: string | null;
    seniority: string | null;
    experienceMinYears: number | null;
    salaryRaw: string | null;
  };
}

/**
 * Read a pasted URL, or explain why it will not be read.
 *
 * Nothing is saved here: the user reviews and corrects the extraction first.
 * For a no-fetch platform this returns an empty shell plus the policy reason.
 */
export async function previewJobUrlAction(rawUrl: string): Promise<ActionResult<UrlPreviewPayload>> {
  try {
    const user = await requireUser();
    await enforceRateLimit('urlFetch', user.id);

    const validated = validateUrl(rawUrl);
    const verdict = classifyPastedUrl(validated.hostname);

    if (!verdict.mayFetch) {
      return {
        ok: true,
        data: {
          fetched: false,
          note: verdict.reason,
          adapterKey: 'external_link',
          job: {
            title: '',
            company: '',
            description: '',
            location: '',
            canonicalUrl: validated.href,
            skills: [],
            workMode: 'unknown',
            employmentType: null,
            seniority: null,
            experienceMinYears: null,
            salaryRaw: null,
          },
        },
      };
    }

    const adapter = new UserUrlAdapter();
    const result = await adapter.importFromUrl(validated.href);
    const job = result.job;

    return {
      ok: true,
      data: {
        fetched: result.fetched,
        note: result.note,
        ...(result.injectionWarning ? { injectionWarning: result.injectionWarning } : {}),
        adapterKey: 'user_url',
        job: {
          title: job.title,
          company: job.company,
          description: job.description,
          location: job.location.raw ?? '',
          canonicalUrl: job.canonicalUrl,
          skills: job.skills,
          workMode: job.workMode,
          employmentType: job.employmentType,
          seniority: job.seniority,
          experienceMinYears: job.experienceMinYears,
          salaryRaw: job.salary.raw ?? null,
        },
      },
    };
  } catch (err) {
    return toResult(err);
  }
}

/* ---------------------------------------------------------------- import -- */

const manualImportSchema = z.object({
  title: z.string().trim().min(1, 'Enter the job title.').max(200),
  company: z.string().trim().min(1, 'Enter the company.').max(200),
  description: z.string().trim().min(30, 'Paste at least a few lines of the job description.').max(60_000),
  location: z.string().max(160).optional(),
  url: z.string().max(2048).optional(),
  employmentType: z.string().max(40).optional(),
  workMode: z.string().max(20).optional(),
  salaryText: z.string().max(200).optional(),
  /** Which adapter the preview step decided on. */
  adapterKey: z.enum(['manual', 'external_link', 'user_url']).default('manual'),
});

/**
 * Save a job the user supplied. Private to them, since it is their import.
 *
 * The adapter key decides the source label the UI shows, so a LinkedIn URL is
 * permanently recorded as "external link only" rather than being presented as
 * though we read it.
 */
export async function importJobAction(raw: unknown): Promise<ActionResult<{ jobId: string; created: boolean }>> {
  try {
    const user = await requireUser();
    await enforceRateLimit('jobImport', user.id);

    const parsed = manualImportSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
    }

    const { adapterKey, ...input } = parsed.data;

    // A pasted URL that was actually fetched keeps the user_url provenance;
    // anything else is manual or link-only.
    let normalized: NormalizedJob;
    if (adapterKey === 'user_url') {
      normalized = buildManualJob(input, 'manual');
      normalized = {
        ...normalized,
        provenance: {
          adapterKey: 'user_url',
          sourceType: 'user_provided',
          note:
            'Imported from a URL you pasted, with the details you confirmed. Applying happens on the employer’s ' +
            'own site, in your browser.',
          fetchedAt: new Date(),
        },
      };
    } else {
      normalized = buildManualJob(input, adapterKey);
    }

    const result = await importJob(normalized, { userId: user.id, ownerUserId: user.id });

    // Score it straight away so the user lands on something useful.
    try {
      const ctx = await loadMatchContext(user.id);
      if (ctx.resumeVersionId) {
        const job = await getJob(user.id, result.jobId);
        await scoreAndStore(user.id, job, ctx);
      }
    } catch (err) {
      console.error('[jobs-action] import scored failed', err instanceof Error ? err.message : err);
    }

    revalidatePath('/jobs');
    revalidatePath('/matches');

    return {
      ok: true,
      notice: result.created ? 'Job saved.' : 'You already had this job saved.',
      data: { jobId: result.jobId, created: result.created },
    };
  } catch (err) {
    return toResult(err);
  }
}

/* --------------------------------------------------------------- matching -- */

export async function rescoreJobAction(
  jobId: string,
  opts: { resumeVersionId?: string; enrich?: boolean } = {},
): Promise<ActionResult<{ score: number; mode: string; explanation: string }>> {
  try {
    const user = await requireUser();
    if (opts.enrich) await enforceRateLimit('aiTask', `match:${user.id}`);

    const result = await scoreJobWithEnrichment(user.id, jobId, opts);

    revalidatePath(`/jobs/${jobId}`);
    revalidatePath('/matches');

    return {
      ok: true,
      notice: `Match score ${result.score}/100.`,
      data: { score: result.score, mode: result.mode, explanation: result.explanation },
    };
  } catch (err) {
    return toResult(err);
  }
}

export async function rescoreAllAction(
  resumeVersionId?: string,
): Promise<ActionResult<{ scored: number; skipped: number }>> {
  try {
    const user = await requireUser();
    await enforceRateLimit('jobSearch', `rescore:${user.id}`);

    const result = await scoreJobsForUser(user.id, {
      ...(resumeVersionId ? { resumeVersionId } : {}),
      limit: 100,
    });

    revalidatePath('/matches');
    revalidatePath('/jobs');

    return {
      ok: true,
      notice:
        result.scored === 0
          ? 'Nothing to score. Import some jobs, and make sure you have a resume version.'
          : `Scored ${result.scored} job${result.scored === 1 ? '' : 's'}.`,
      data: result,
    };
  } catch (err) {
    return toResult(err);
  }
}

/* ------------------------------------------------------------ saved/hidden */

export async function setJobStateAction(
  jobId: string,
  state: 'saved' | 'hidden' | 'none',
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await setJobState(user.id, jobId, state);
    revalidatePath('/jobs');
    revalidatePath('/matches');
    return {
      ok: true,
      notice: state === 'saved' ? 'Saved.' : state === 'hidden' ? 'Hidden from your list.' : 'Cleared.',
    };
  } catch (err) {
    return toResult(err);
  }
}

export async function deleteJobAction(jobId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await deletePrivateJob(user.id, jobId);
    revalidatePath('/jobs');
    revalidatePath('/matches');
    return { ok: true, notice: 'Removed from your list.' };
  } catch (err) {
    return toResult(err);
  }
}

/* ----------------------------------------------------------------- filters */

export async function listJobsAction(filters: JobFilters = {}): Promise<
  ActionResult<{ jobs: Awaited<ReturnType<typeof listJobs>> }>
> {
  try {
    const user = await requireUser();
    const jobs = await listJobs(user.id, filters);
    return { ok: true, data: { jobs } };
  } catch (err) {
    return toResult(err);
  }
}
