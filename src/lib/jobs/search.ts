/**
 * Search orchestration across permitted sources.
 *
 * Honesty about coverage is a design goal here, not a disclaimer. The result
 * carries `sourcesQueried`, `sourcesSkipped` and the reason each source was
 * skipped, so the UI can state exactly where the results came from and what was
 * not searched. Nothing in this product claims to search "the whole internet".
 */
import { getDb, isDatabaseConfigured, jobSearches, jobSources } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { AdzunaAdapter } from './adapters/adzuna';
import { AshbyAdapter, GreenhouseAdapter, LeverAdapter } from './adapters/ats-boards';
import { ExternalLinkAdapter, ManualAdapter, UserUrlAdapter } from './adapters/user-provided';
import { dedupeBatch, computeDedupeKey } from './dedupe';
import { JOB_SOURCE_REGISTRY } from './registry';
import { JobSourceError, type JobSearchInput, type JobSourceAdapter, type NormalizedJob } from './types';
import { contentHash } from '@/lib/security';

/* -------------------------------------------------------------- adapters -- */

const adapters = new Map<string, JobSourceAdapter>();

export function getAdapter(adapterKey: string): JobSourceAdapter {
  const cached = adapters.get(adapterKey);
  if (cached) return cached;

  let adapter: JobSourceAdapter;
  switch (adapterKey) {
    case 'greenhouse':
      adapter = new GreenhouseAdapter();
      break;
    case 'lever':
      adapter = new LeverAdapter();
      break;
    case 'ashby':
      adapter = new AshbyAdapter();
      break;
    case 'adzuna':
      adapter = new AdzunaAdapter();
      break;
    case 'user_url':
      adapter = new UserUrlAdapter();
      break;
    case 'manual':
      adapter = new ManualAdapter();
      break;
    case 'external_link':
      adapter = new ExternalLinkAdapter();
      break;
    default:
      throw new JobSourceError(adapterKey, 'not_configured', `No adapter is registered for "${adapterKey}".`);
  }

  adapters.set(adapterKey, adapter);
  return adapter;
}

/** Test-only override. */
export function __setAdapter(adapterKey: string, adapter: JobSourceAdapter | null): void {
  if (adapter) adapters.set(adapterKey, adapter);
  else adapters.delete(adapterKey);
}

/* ------------------------------------------------------------ availability */

export interface SourceAvailability {
  adapterKey: string;
  name: string;
  searchable: boolean;
  /** Why it will not be queried, when it will not be. */
  reason?: string;
}

/**
 * Which sources can answer a search, and why the others cannot.
 * Board adapters need company names; the aggregator needs credentials.
 */
export function sourceAvailability(input: JobSearchInput): SourceAvailability[] {
  const hasCompanies = (input.companies ?? []).length > 0;

  return JOB_SOURCE_REGISTRY.filter((s) => s.capabilities.includes('search')).map((s) => {
    if (s.adapterKey === 'adzuna') {
      return AdzunaAdapter.isConfigured()
        ? { adapterKey: s.adapterKey, name: s.name, searchable: true }
        : {
            adapterKey: s.adapterKey,
            name: s.name,
            searchable: false,
            reason:
              'Not configured. Set SEARCH_PROVIDER=adzuna with ADZUNA_APP_ID and ADZUNA_APP_KEY to search by ' +
              'keyword and location rather than by company.',
          };
    }

    return hasCompanies
      ? { adapterKey: s.adapterKey, name: s.name, searchable: true }
      : {
          adapterKey: s.adapterKey,
          name: s.name,
          searchable: false,
          reason:
            'Public job boards are addressed per company. Add target companies to search their boards directly.',
        };
  });
}

/* ---------------------------------------------------------------- search -- */

export interface SearchOutcome {
  jobs: NormalizedJob[];
  duplicatesRemoved: number;
  sourcesQueried: { adapterKey: string; name: string; count: number }[];
  sourcesSkipped: { adapterKey: string; name: string; reason: string }[];
  sourcesFailed: { adapterKey: string; name: string; error: string }[];
  /** Plain-language statement of what was and was not searched. */
  coverageNote: string;
}

const PER_SOURCE_TIMEOUT_MS = 15_000;

/** Run one adapter with a hard timeout so a slow source cannot stall a search. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('The source took too long to respond.')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Query every searchable source in parallel, then deduplicate.
 * A failing source degrades the result; it never fails the search.
 */
export async function searchJobs(input: JobSearchInput): Promise<SearchOutcome> {
  const availability = sourceAvailability(input);
  const searchable = availability.filter((a) => a.searchable);

  const sourcesQueried: SearchOutcome['sourcesQueried'] = [];
  const sourcesFailed: SearchOutcome['sourcesFailed'] = [];
  const collected: NormalizedJob[] = [];

  const settled = await Promise.allSettled(
    searchable.map(async (source) => {
      const adapter = getAdapter(source.adapterKey);
      const results = await withTimeout(adapter.search(input), PER_SOURCE_TIMEOUT_MS);
      return { source, results };
    }),
  );

  for (const [index, outcome] of settled.entries()) {
    const source = searchable[index]!;
    if (outcome.status === 'fulfilled') {
      sourcesQueried.push({
        adapterKey: source.adapterKey,
        name: source.name,
        count: outcome.value.results.length,
      });
      collected.push(...outcome.value.results.map((r) => r.job));
    } else {
      sourcesFailed.push({
        adapterKey: source.adapterKey,
        name: source.name,
        error:
          outcome.reason instanceof JobSourceError
            ? outcome.reason.message
            : outcome.reason instanceof Error
              ? outcome.reason.message
              : 'That source could not be reached.',
      });
    }
  }

  // Deduplicate. Order matters: authorised APIs and public boards are more
  // trustworthy than a pasted page, so they win when the same job appears twice.
  const trust: Record<string, number> = {
    authorized_api: 0,
    public_board: 1,
    public_feed: 2,
    user_provided: 3,
    manual: 4,
    external_link: 5,
  };
  const ordered = collected
    .slice()
    .sort((a, b) => (trust[a.provenance.sourceType] ?? 9) - (trust[b.provenance.sourceType] ?? 9));

  const withKeys = await Promise.all(
    ordered.map(async (job) => ({
      job,
      sourceKey: job.provenance.adapterKey,
      externalJobId: job.externalJobId,
      canonicalUrl: job.canonicalUrl,
      company: job.company,
      title: job.title,
      location: job.location.raw ?? job.location.city ?? null,
      descriptionHash: await contentHash(job.description),
    })),
  );

  const { kept, removed } = dedupeBatch(withKeys);

  const sourcesSkipped = availability
    .filter((a) => !a.searchable)
    .map((a) => ({ adapterKey: a.adapterKey, name: a.name, reason: a.reason ?? 'Not available.' }));

  return {
    jobs: kept.map((k) => k.job),
    duplicatesRemoved: removed,
    sourcesQueried,
    sourcesFailed,
    sourcesSkipped,
    coverageNote: buildCoverageNote(sourcesQueried, sourcesSkipped, sourcesFailed),
  };
}

function buildCoverageNote(
  queried: SearchOutcome['sourcesQueried'],
  skipped: SearchOutcome['sourcesSkipped'],
  failed: SearchOutcome['sourcesFailed'],
): string {
  const parts: string[] = [];

  if (queried.length === 0) {
    parts.push('No source was searched.');
  } else {
    parts.push(`Searched ${queried.map((q) => q.name).join(', ')}.`);
  }
  if (failed.length > 0) {
    parts.push(`${failed.map((f) => f.name).join(', ')} could not be reached.`);
  }
  if (skipped.length > 0) {
    parts.push(`Not searched: ${skipped.map((s) => s.name).join(', ')}.`);
  }
  parts.push(
    'This is not an exhaustive search of every job on the internet — only of the sources listed above. ' +
      'You can always paste a job URL directly.',
  );

  return parts.join(' ');
}

/** Record a search for the user's history. Never throws. */
export async function recordSearch(
  userId: string,
  input: JobSearchInput,
  outcome: SearchOutcome,
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    await getDb().insert(jobSearches).values({
      userId,
      query: (input.query ?? '').slice(0, 500),
      filters: {
        titles: input.titles ?? [],
        keywords: input.keywords ?? [],
        locations: input.locations ?? [],
        companies: input.companies ?? [],
        workModes: input.workModes ?? [],
        postedWithinDays: input.postedWithinDays ?? null,
        minSalary: input.minSalary ?? null,
      },
      resultCount: outcome.jobs.length,
      sourcesUsed: outcome.sourcesQueried.map((s) => s.adapterKey),
    });

    await recordAudit({
      userId,
      action: 'job.searched',
      metadata: {
        resultCount: outcome.jobs.length,
        duplicatesRemoved: outcome.duplicatesRemoved,
        sourcesQueried: outcome.sourcesQueried.map((s) => s.adapterKey),
        sourcesSkipped: outcome.sourcesSkipped.map((s) => s.adapterKey),
      },
    });
  } catch (err) {
    console.error('[job-search] could not record search', err instanceof Error ? err.message : err);
  }
}

/* ------------------------------------------------------- source registry -- */

/** Resolve a source row id by adapter key, inserting it if absent. */
export async function ensureSourceId(adapterKey: string): Promise<string> {
  const db = getDb();
  const { eq } = await import('drizzle-orm');

  const existing = await db
    .select({ id: jobSources.id })
    .from(jobSources)
    .where(eq(jobSources.adapterKey, adapterKey))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const definition = JOB_SOURCE_REGISTRY.find((s) => s.adapterKey === adapterKey);
  if (!definition) {
    throw new JobSourceError(adapterKey, 'not_configured', `Unknown job source "${adapterKey}".`);
  }

  const inserted = await db
    .insert(jobSources)
    .values({
      name: definition.name,
      adapterKey: definition.adapterKey,
      sourceType: definition.sourceType,
      policyStatus: definition.policyStatus,
      policyNote: definition.policyNote,
      enabled: definition.enabledByDefault,
    })
    .returning({ id: jobSources.id });

  return inserted[0]!.id;
}

export { computeDedupeKey };
