/**
 * Public ATS job-board adapters: Greenhouse, Lever and Ashby.
 *
 * These read the documented public board endpoints that a company enables for
 * its own openings. There is no crawling: each request targets one named
 * company board, hosts are allowlisted per adapter in `registry.ts`, and every
 * request goes through `safeFetch` with a byte cap and timeout.
 *
 * Because a board is addressed by company slug, these adapters are only useful
 * when the user names companies they care about — which is the honest shape of
 * the capability, rather than pretending to search everywhere.
 */
import { htmlToText, safeFetch } from '@/lib/security';
import { findSourceDefinition } from '../registry';
import { extractJobFields, extractLocation, parseDate } from '../extract';
import {
  emptyJob,
  JobSourceError,
  type JobDetails,
  type JobDetailsInput,
  type JobSearchInput,
  type JobSearchResult,
  type JobSourceAdapter,
  type NormalizedJob,
} from '../types';

const MAX_BOARDS_PER_SEARCH = 8;
const MAX_JOBS_PER_BOARD = 40;

/** Company slugs are user input: keep them to a shape a board URL accepts. */
function safeSlug(value: string): string | null {
  const slug = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9-]/g, '');
  return slug.length >= 2 && slug.length <= 60 ? slug : null;
}

/** Does this posting plausibly match what the user asked for? */
function matchesQuery(job: NormalizedJob, input: JobSearchInput): boolean {
  const needles = [
    ...(input.titles ?? []),
    ...(input.keywords ?? []),
    ...(input.skills ?? []),
    ...(input.query ? [input.query] : []),
  ]
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.length > 1);

  if (needles.length === 0) return true;

  const haystack = `${job.title}\n${job.description}\n${job.skills.join(' ')}`.toLowerCase();
  // Any-match rather than all-match: a board is a small set, and over-filtering
  // here would hide roles the scoring engine should be allowed to rank.
  return needles.some((n) => haystack.includes(n));
}

function withinPostedWindow(job: NormalizedJob, days: number | null | undefined): boolean {
  if (!days || !job.postedAt) return true;
  return Date.now() - job.postedAt.getTime() <= days * 24 * 60 * 60 * 1000;
}

/* --------------------------------------------------------------- greenhouse */

interface GreenhouseJob {
  id?: number;
  title?: string;
  absolute_url?: string;
  updated_at?: string;
  content?: string;
  location?: { name?: string };
  metadata?: unknown;
  departments?: { name?: string }[];
}

export class GreenhouseAdapter implements JobSourceAdapter {
  readonly id = 'greenhouse';
  readonly name = 'Greenhouse job boards';
  readonly capabilities = ['search', 'details'];

  private allowedHosts(): string[] {
    return findSourceDefinition('greenhouse')?.allowedHosts ?? [];
  }

  private toJob(raw: GreenhouseJob, company: string): NormalizedJob | null {
    const title = (raw.title ?? '').trim();
    if (!title) return null;

    // Greenhouse returns the description as escaped HTML.
    const description = htmlToText(raw.content ?? '');
    const locationText = raw.location?.name ?? null;
    const fields = extractJobFields(title, description, locationText);

    return emptyJob({
      externalJobId: raw.id ? String(raw.id) : null,
      canonicalUrl: raw.absolute_url ?? null,
      applyUrl: raw.absolute_url ?? null,
      title,
      company,
      description,
      location: extractLocation(locationText),
      industry: raw.departments?.[0]?.name ?? null,
      postedAt: parseDate(raw.updated_at),
      ...fields,
      provenance: {
        adapterKey: this.id,
        sourceType: 'public_board',
        note: `Read from ${company}'s public Greenhouse board.`,
        fetchedAt: new Date(),
      },
    });
  }

  async search(input: JobSearchInput): Promise<JobSearchResult[]> {
    const slugs = (input.companies ?? [])
      .map(safeSlug)
      .filter((s): s is string => Boolean(s))
      .slice(0, MAX_BOARDS_PER_SEARCH);

    if (slugs.length === 0) return [];

    const results: JobSearchResult[] = [];

    for (const slug of slugs) {
      try {
        const res = await safeFetch(
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
          {
            allowedHosts: this.allowedHosts(),
            accept: 'application/json',
            maxBytes: 3_000_000,
            ...(input.signal ? {} : {}),
          },
        );
        if (res.status !== 200) continue;

        const body = JSON.parse(res.body) as { jobs?: GreenhouseJob[] };
        for (const raw of (body.jobs ?? []).slice(0, MAX_JOBS_PER_BOARD)) {
          const job = this.toJob(raw, slug);
          if (!job) continue;
          if (!matchesQuery(job, input)) continue;
          if (!withinPostedWindow(job, input.postedWithinDays)) continue;
          results.push({ job });
        }
      } catch {
        // One unreachable board must not fail the whole search.
        continue;
      }
    }

    return results.slice(0, input.limit ?? 60);
  }

  async getJobDetails(input: JobDetailsInput): Promise<JobDetails | null> {
    const slug = safeSlug(input.company ?? '');
    if (!slug || !input.externalJobId) return null;

    try {
      const res = await safeFetch(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(input.externalJobId)}`,
        { allowedHosts: this.allowedHosts(), accept: 'application/json' },
      );
      if (res.status !== 200) return null;
      return this.toJob(JSON.parse(res.body) as GreenhouseJob, slug);
    } catch (err) {
      throw new JobSourceError(this.id, 'unreachable', err instanceof Error ? err.message : 'Board unreachable.');
    }
  }
}

/* -------------------------------------------------------------------- lever */

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  descriptionPlain?: string;
  description?: string;
  categories?: { location?: string; team?: string; commitment?: string };
  lists?: { text?: string; content?: string }[];
}

export class LeverAdapter implements JobSourceAdapter {
  readonly id = 'lever';
  readonly name = 'Lever job boards';
  readonly capabilities = ['search', 'details'];

  private allowedHosts(): string[] {
    return findSourceDefinition('lever')?.allowedHosts ?? [];
  }

  private toJob(raw: LeverPosting, company: string): NormalizedJob | null {
    const title = (raw.text ?? '').trim();
    if (!title) return null;

    // Lever splits the posting into a body plus titled lists; the lists carry
    // the requirements, so they must be folded back in with their headings.
    const listText = (raw.lists ?? [])
      .map((l) => `${l.text ?? ''}\n${htmlToText(l.content ?? '')}`)
      .join('\n\n');
    const description = [raw.descriptionPlain ?? htmlToText(raw.description ?? ''), listText]
      .filter(Boolean)
      .join('\n\n')
      .trim();

    const locationText = raw.categories?.location ?? null;
    const fields = extractJobFields(title, description, locationText);

    return emptyJob({
      externalJobId: raw.id ?? null,
      canonicalUrl: raw.hostedUrl ?? null,
      applyUrl: raw.applyUrl ?? raw.hostedUrl ?? null,
      title,
      company,
      description,
      location: extractLocation(locationText),
      industry: raw.categories?.team ?? null,
      postedAt: parseDate(raw.createdAt),
      ...fields,
      // The provider states commitment explicitly; prefer it over inference.
      employmentType: normaliseCommitment(raw.categories?.commitment) ?? fields.employmentType,
      provenance: {
        adapterKey: this.id,
        sourceType: 'public_board',
        note: `Read from ${company}'s public Lever board.`,
        fetchedAt: new Date(),
      },
    });
  }

  async search(input: JobSearchInput): Promise<JobSearchResult[]> {
    const slugs = (input.companies ?? [])
      .map(safeSlug)
      .filter((s): s is string => Boolean(s))
      .slice(0, MAX_BOARDS_PER_SEARCH);

    if (slugs.length === 0) return [];

    const results: JobSearchResult[] = [];

    for (const slug of slugs) {
      try {
        const res = await safeFetch(
          `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
          { allowedHosts: this.allowedHosts(), accept: 'application/json', maxBytes: 3_000_000 },
        );
        if (res.status !== 200) continue;

        const body = JSON.parse(res.body) as LeverPosting[];
        for (const raw of (Array.isArray(body) ? body : []).slice(0, MAX_JOBS_PER_BOARD)) {
          const job = this.toJob(raw, slug);
          if (!job) continue;
          if (!matchesQuery(job, input)) continue;
          if (!withinPostedWindow(job, input.postedWithinDays)) continue;
          results.push({ job });
        }
      } catch {
        continue;
      }
    }

    return results.slice(0, input.limit ?? 60);
  }

  async getJobDetails(input: JobDetailsInput): Promise<JobDetails | null> {
    const slug = safeSlug(input.company ?? '');
    if (!slug || !input.externalJobId) return null;
    try {
      const res = await safeFetch(
        `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}/${encodeURIComponent(input.externalJobId)}`,
        { allowedHosts: this.allowedHosts(), accept: 'application/json' },
      );
      if (res.status !== 200) return null;
      return this.toJob(JSON.parse(res.body) as LeverPosting, slug);
    } catch (err) {
      throw new JobSourceError(this.id, 'unreachable', err instanceof Error ? err.message : 'Board unreachable.');
    }
  }
}

function normaliseCommitment(value: string | undefined): string | null {
  const v = (value ?? '').toLowerCase();
  if (!v) return null;
  if (v.includes('full')) return 'full_time';
  if (v.includes('part')) return 'part_time';
  if (v.includes('contract')) return 'contract';
  if (v.includes('intern')) return 'internship';
  if (v.includes('temp')) return 'temporary';
  return null;
}

/* -------------------------------------------------------------------- ashby */

interface AshbyPosting {
  id?: string;
  title?: string;
  jobUrl?: string;
  applyUrl?: string;
  publishedAt?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  location?: string;
  department?: string;
  employmentType?: string;
  isRemote?: boolean;
  isListed?: boolean;
}

export class AshbyAdapter implements JobSourceAdapter {
  readonly id = 'ashby';
  readonly name = 'Ashby job boards';
  readonly capabilities = ['search', 'details'];

  private allowedHosts(): string[] {
    return findSourceDefinition('ashby')?.allowedHosts ?? [];
  }

  private toJob(raw: AshbyPosting, company: string): NormalizedJob | null {
    const title = (raw.title ?? '').trim();
    if (!title) return null;

    const description = raw.descriptionPlain ?? htmlToText(raw.descriptionHtml ?? '');
    const locationText = raw.location ?? null;
    const fields = extractJobFields(title, description, locationText);

    return emptyJob({
      externalJobId: raw.id ?? null,
      canonicalUrl: raw.jobUrl ?? null,
      applyUrl: raw.applyUrl ?? raw.jobUrl ?? null,
      title,
      company,
      description,
      location: extractLocation(locationText),
      industry: raw.department ?? null,
      postedAt: parseDate(raw.publishedAt),
      ...fields,
      employmentType: normaliseCommitment(raw.employmentType) ?? fields.employmentType,
      workMode: raw.isRemote === true ? 'remote' : fields.workMode,
      provenance: {
        adapterKey: this.id,
        sourceType: 'public_board',
        note: `Read from ${company}'s public Ashby board.`,
        fetchedAt: new Date(),
      },
    });
  }

  async search(input: JobSearchInput): Promise<JobSearchResult[]> {
    const slugs = (input.companies ?? [])
      .map(safeSlug)
      .filter((s): s is string => Boolean(s))
      .slice(0, MAX_BOARDS_PER_SEARCH);

    if (slugs.length === 0) return [];

    const results: JobSearchResult[] = [];

    for (const slug of slugs) {
      try {
        const res = await safeFetch(
          `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`,
          { allowedHosts: this.allowedHosts(), accept: 'application/json', maxBytes: 3_000_000 },
        );
        if (res.status !== 200) continue;

        const body = JSON.parse(res.body) as { jobs?: AshbyPosting[] };
        for (const raw of (body.jobs ?? []).slice(0, MAX_JOBS_PER_BOARD)) {
          // Ashby marks unlisted drafts; those are not public openings.
          if (raw.isListed === false) continue;
          const job = this.toJob(raw, slug);
          if (!job) continue;
          if (!matchesQuery(job, input)) continue;
          if (!withinPostedWindow(job, input.postedWithinDays)) continue;
          results.push({ job });
        }
      } catch {
        continue;
      }
    }

    return results.slice(0, input.limit ?? 60);
  }

  async getJobDetails(input: JobDetailsInput): Promise<JobDetails | null> {
    const slug = safeSlug(input.company ?? '');
    if (!slug || !input.externalJobId) return null;
    const all = await this.search({ companies: [slug], limit: MAX_JOBS_PER_BOARD });
    return all.find((r) => r.job.externalJobId === input.externalJobId)?.job ?? null;
  }
}
