/**
 * User-provided job adapters.
 *
 *  - `ManualAdapter`     the user typed or pasted the description. No fetching.
 *  - `ExternalLinkAdapter` a link only, for platforms that do not permit
 *                        programmatic access (LinkedIn, Naukri, Indeed,
 *                        Glassdoor). Nothing is ever requested from them.
 *  - `UserUrlAdapter`    one SSRF-guarded fetch of a page the user explicitly
 *                        pasted, so they can confirm the details before saving.
 *
 * The split matters: `classifyPastedUrl` decides which of the last two applies,
 * and the no-fetch decision is enforced here, not merely documented.
 */
import { htmlToText, safeFetch, sanitizeImportedText, sanitizeLabel, validateUrl } from '@/lib/security';
import { classifyPastedUrl, isNoFetchHost } from '../registry';
import { extractJobFields, extractLocation } from '../extract';
import {
  emptyJob,
  JobSourceError,
  type JobDetails,
  type JobDetailsInput,
  type JobSearchResult,
  type JobSourceAdapter,
  type NormalizedJob,
} from '../types';

export interface ManualJobInput {
  title: string;
  company: string;
  description: string;
  location?: string;
  url?: string;
  employmentType?: string;
  workMode?: string;
  salaryText?: string;
}

/** Build a job from details the user supplied. Never fetches anything. */
export function buildManualJob(input: ManualJobInput, adapterKey: 'manual' | 'external_link'): NormalizedJob {
  const title = sanitizeLabel(input.title, 200);
  const company = sanitizeLabel(input.company, 200);
  const description = sanitizeImportedText(input.description ?? '', 60_000);
  const locationText = input.location ? sanitizeLabel(input.location, 160) : null;

  // Validate a supplied URL for storage, but do not fetch it.
  let canonicalUrl: string | null = null;
  if (input.url?.trim()) {
    try {
      canonicalUrl = validateUrl(input.url).href;
    } catch {
      // An unusable URL is dropped rather than blocking the import: the user's
      // typed details are the substance here.
      canonicalUrl = null;
    }
  }

  const fields = extractJobFields(title, `${description}\n${input.salaryText ?? ''}`, locationText);

  return emptyJob({
    externalJobId: null,
    canonicalUrl,
    applyUrl: canonicalUrl,
    title,
    company,
    description,
    location: extractLocation(locationText),
    ...fields,
    ...(input.employmentType ? { employmentType: input.employmentType } : {}),
    ...(input.workMode && input.workMode !== 'unknown'
      ? { workMode: input.workMode as NormalizedJob['workMode'] }
      : {}),
    provenance: {
      adapterKey,
      sourceType: adapterKey === 'manual' ? 'manual' : 'external_link',
      note:
        adapterKey === 'manual'
          ? 'You entered this job description yourself. Nothing was fetched.'
          : 'Stored as a link with the details you supplied. Nothing was fetched from the destination.',
      fetchedAt: new Date(),
    },
  });
}

export class ManualAdapter implements JobSourceAdapter {
  readonly id = 'manual';
  readonly name = 'Added manually by you';
  readonly capabilities = ['manual_entry'];

  async search(): Promise<JobSearchResult[]> {
    // Manual entry is not searchable: there is nothing to search.
    return [];
  }

  async getJobDetails(): Promise<JobDetails | null> {
    return null;
  }
}

export class ExternalLinkAdapter implements JobSourceAdapter {
  readonly id = 'external_link';
  readonly name = 'External link only';
  readonly capabilities = ['manual_entry'];

  async search(): Promise<JobSearchResult[]> {
    return [];
  }

  /**
   * Deliberately returns null rather than fetching.
   * This adapter exists precisely because the destination must not be read.
   */
  async getJobDetails(): Promise<JobDetails | null> {
    return null;
  }
}

export interface UrlImportResult {
  job: NormalizedJob;
  /** True when the page was read; false when policy forbade it. */
  fetched: boolean;
  /** Explanation shown to the user, verbatim. */
  note: string;
  /** Set when the page carried something resembling an injected instruction. */
  injectionWarning?: string;
}

export class UserUrlAdapter implements JobSourceAdapter {
  readonly id = 'user_url';
  readonly name = 'Job URL you provided';
  readonly capabilities = ['import_by_url', 'details'];

  async search(): Promise<JobSearchResult[]> {
    // A pasted URL is an import, not a search.
    return [];
  }

  async getJobDetails(input: JobDetailsInput): Promise<JobDetails | null> {
    if (!input.url) return null;
    const result = await this.importFromUrl(input.url);
    return result.fetched ? result.job : null;
  }

  /**
   * Fetch one page and pull what can be read from it.
   *
   * The extraction is intentionally shallow: a job page is arbitrary markup, so
   * we take the title, the visible text, and whatever the deterministic
   * extractors recognise. Anything uncertain is left for the user to correct on
   * a review screen before the job is saved.
   */
  async importFromUrl(rawUrl: string): Promise<UrlImportResult> {
    const validated = validateUrl(rawUrl);

    // The policy gate. LinkedIn, Naukri and friends stop here.
    if (isNoFetchHost(validated.hostname)) {
      const verdict = classifyPastedUrl(validated.hostname);
      return {
        job: buildManualJob(
          { title: '', company: '', description: '', url: validated.href },
          'external_link',
        ),
        fetched: false,
        note: verdict.reason,
      };
    }

    let body: string;
    let contentType: string;
    try {
      const res = await safeFetch(validated.href, {
        accept: 'text/html,application/xhtml+xml',
        maxBytes: 1_200_000,
        timeoutMs: 12_000,
      });
      if (res.status >= 400) {
        throw new JobSourceError(this.id, 'unreachable', `That page returned HTTP ${res.status}.`);
      }
      body = res.body;
      contentType = res.contentType;
    } catch (err) {
      if (err instanceof JobSourceError) throw err;
      throw new JobSourceError(
        this.id,
        'unreachable',
        err instanceof Error ? err.message : 'That page could not be read.',
      );
    }

    if (!/html|text|json/i.test(contentType) && contentType) {
      throw new JobSourceError(this.id, 'invalid_response', 'That URL did not return a readable page.');
    }

    const pageTitle = extractPageTitle(body);
    const text = htmlToText(body);
    const jsonLd = extractJobPosting(body);

    const title = sanitizeLabel(jsonLd?.title ?? pageTitle.title, 200);
    const company = sanitizeLabel(jsonLd?.company ?? pageTitle.company ?? '', 200);
    const description = sanitizeImportedText(jsonLd?.description ?? text, 60_000);
    const locationText = jsonLd?.location ?? null;

    const fields = extractJobFields(title, description, locationText);
    const injection = detectPageInjection(description);

    return {
      job: emptyJob({
        canonicalUrl: validated.href,
        applyUrl: validated.href,
        title,
        company,
        description,
        location: extractLocation(locationText),
        postedAt: jsonLd?.datePosted ?? null,
        ...fields,
        provenance: {
          adapterKey: this.id,
          sourceType: 'user_provided',
          note:
            'Read once from the URL you pasted, as plain text. Applying still happens on the employer’s own site, ' +
            'in your browser.',
          fetchedAt: new Date(),
        },
      }),
      fetched: true,
      note:
        'Read from the page you pasted. Check the details below and correct anything that came through wrong — ' +
        'job pages vary widely, and this extraction is deliberately conservative.',
      ...(injection ? { injectionWarning: injection } : {}),
    };
  }
}

/* -------------------------------------------------------------- extraction -- */

/** `<title>` split on the common "Role at Company" / "Role - Company" shapes. */
export function extractPageTitle(html: string): { title: string; company: string | null } {
  const match = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  const raw = htmlToText(match?.[1] ?? '').trim();
  if (!raw) return { title: '', company: null };

  const separators = [' at ', ' | ', ' - ', ' – ', ' — ', ' @ ', ' :: '];
  for (const sep of separators) {
    const idx = raw.toLowerCase().indexOf(sep.toLowerCase());
    if (idx > 2) {
      return {
        title: raw.slice(0, idx).trim(),
        company: raw.slice(idx + sep.length).trim() || null,
      };
    }
  }
  return { title: raw, company: null };
}

interface JsonLdJob {
  title?: string;
  company?: string;
  description?: string;
  location?: string;
  datePosted?: Date | null;
}

/**
 * Read schema.org JobPosting markup when the page publishes it.
 * Many ATS-hosted pages do, and it is far more reliable than scraping the DOM —
 * it is structured data the site chose to expose.
 */
export function extractJobPosting(html: string): JsonLdJob | null {
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];

  for (const block of blocks) {
    const jsonText = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      continue;
    }

    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      const node = candidate as Record<string, unknown> | null;
      if (!node || typeof node !== 'object') continue;

      const graph = Array.isArray(node['@graph']) ? (node['@graph'] as Record<string, unknown>[]) : [node];
      for (const entry of graph) {
        const type = entry['@type'];
        const isJob = Array.isArray(type) ? type.includes('JobPosting') : type === 'JobPosting';
        if (!isJob) continue;

        const org = entry.hiringOrganization as Record<string, unknown> | undefined;
        const loc = entry.jobLocation as Record<string, unknown> | Record<string, unknown>[] | undefined;
        const firstLoc = Array.isArray(loc) ? loc[0] : loc;
        const address = firstLoc?.address as Record<string, unknown> | undefined;

        const locationParts = [
          typeof address?.addressLocality === 'string' ? address.addressLocality : null,
          typeof address?.addressRegion === 'string' ? address.addressRegion : null,
          typeof address?.addressCountry === 'string'
            ? address.addressCountry
            : typeof (address?.addressCountry as Record<string, unknown>)?.name === 'string'
              ? ((address?.addressCountry as Record<string, unknown>).name as string)
              : null,
        ].filter(Boolean);

        const rawDate = entry.datePosted;
        const datePosted =
          typeof rawDate === 'string' && !Number.isNaN(new Date(rawDate).getTime()) ? new Date(rawDate) : null;

        return {
          ...(typeof entry.title === 'string' ? { title: entry.title } : {}),
          ...(typeof org?.name === 'string' ? { company: org.name } : {}),
          ...(typeof entry.description === 'string' ? { description: htmlToText(entry.description) } : {}),
          ...(locationParts.length ? { location: locationParts.join(', ') } : {}),
          datePosted,
        };
      }
    }
  }

  return null;
}

/**
 * Warn when an imported page carries text shaped like an instruction.
 *
 * This is a notice, not a block: a job description legitimately discussing AI
 * safety is not an attack. The structural defences in `ai/prompts.ts` are what
 * actually contain it — this exists so the user knows.
 */
function detectPageInjection(text: string): string | null {
  const patterns: [RegExp, string][] = [
    [/ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i, 'an instruction-override phrase'],
    [/\byou\s+are\s+now\s+a\b/i, 'a role-reassignment phrase'],
    [/\bsystem\s*:\s*/i, 'a forged system prompt'],
    [/\b(reveal|output|print)\b[^.\n]{0,30}\b(api[\s_-]?key|secret|token|password)/i, 'a request for secrets'],
    [/\bmark\b[^.\n]{0,30}\bas\s+submitted\b/i, 'an attempt to forge a submission'],
  ];

  const found = patterns.filter(([re]) => re.test(text)).map(([, label]) => label);
  if (found.length === 0) return null;

  return (
    `This page contains ${found.join(' and ')}. It has been stored as plain text and cannot instruct the ` +
    'assistant, but read the description below before using it.'
  );
}
