/**
 * Adzuna aggregator adapter.
 *
 * WHY AN EXTERNAL SERVICE IS USED HERE, and why it is isolated behind this
 * adapter (per the project's constraint on external dependencies):
 *
 * The compliant sources that need no third party — Greenhouse, Lever and Ashby
 * boards — are addressed per company. That is genuinely useful when a user has
 * target companies in mind, but it cannot answer "what backend roles exist in
 * Bengaluru right now". The only lawful way to answer that is an aggregator
 * whose terms permit programmatic search. Adzuna publishes such an API with a
 * free developer tier and documented terms.
 *
 * It is therefore:
 *   - OPTIONAL. Disabled unless ADZUNA_APP_ID and ADZUNA_APP_KEY are set, and
 *     marked `requires_configuration` in the registry.
 *   - ISOLATED. Nothing outside this file knows Adzuna exists; the rest of the
 *     app sees `NormalizedJob`.
 *   - REPLACEABLE. Adding another authorised aggregator means adding a sibling
 *     file, with no change anywhere else.
 *
 * If the terms of any source change, the correct response is to disable the
 * adapter — never to work around the restriction.
 */
import { safeFetch, sanitizeLabel } from '@/lib/security';
import { env, featureFlags } from '@/lib/env';
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

interface AdzunaResult {
  id?: string;
  title?: string;
  description?: string;
  redirect_url?: string;
  created?: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string;
  contract_time?: string;
  contract_type?: string;
  category?: { label?: string };
}

/**
 * Country code for the API path. Adzuna partitions by country, so a location
 * hint has to be mapped to one; India is the default for this product.
 */
function countryFor(locations: string[] | undefined): string {
  const text = (locations ?? []).join(' ').toLowerCase();
  const map: [RegExp, string][] = [
    [/\b(india|bengaluru|bangalore|mumbai|delhi|hyderabad|chennai|pune|kolkata|noida|gurgaon|gurugram)\b/, 'in'],
    [/\b(united kingdom|uk|london|manchester|edinburgh)\b/, 'gb'],
    [/\b(united states|usa|us|new york|san francisco|seattle|austin)\b/, 'us'],
    [/\b(canada|toronto|vancouver)\b/, 'ca'],
    [/\b(australia|sydney|melbourne)\b/, 'au'],
    [/\b(germany|berlin|munich)\b/, 'de'],
    [/\b(singapore)\b/, 'sg'],
    [/\b(netherlands|amsterdam)\b/, 'nl'],
  ];
  for (const [pattern, code] of map) {
    if (pattern.test(text)) return code;
  }
  return 'in';
}

export class AdzunaAdapter implements JobSourceAdapter {
  readonly id = 'adzuna';
  readonly name = 'Adzuna (authorised API)';
  readonly capabilities = ['search', 'details'];

  /** Configured and therefore usable. */
  static isConfigured(): boolean {
    return featureFlags().externalJobSearch;
  }

  private credentials(): { appId: string; appKey: string } {
    const e = env();
    if (!e.ADZUNA_APP_ID || !e.ADZUNA_APP_KEY) {
      throw new JobSourceError(
        this.id,
        'not_configured',
        'Adzuna search is not configured. Set SEARCH_PROVIDER=adzuna with ADZUNA_APP_ID and ADZUNA_APP_KEY.',
      );
    }
    return { appId: e.ADZUNA_APP_ID, appKey: e.ADZUNA_APP_KEY };
  }

  private allowedHosts(): string[] {
    return findSourceDefinition('adzuna')?.allowedHosts ?? [];
  }

  private toJob(raw: AdzunaResult): NormalizedJob | null {
    const title = sanitizeLabel(raw.title ?? '', 200);
    if (!title) return null;

    const description = raw.description ?? '';
    const locationText = raw.location?.display_name ?? null;
    const fields = extractJobFields(title, description, locationText);

    // A predicted salary is a model output, not a stated figure. Recording it
    // as if the employer said it would be a fabrication, so it is dropped and
    // the fact noted in the raw field instead.
    const predicted = raw.salary_is_predicted === '1';
    const salary =
      !predicted && (raw.salary_min || raw.salary_max)
        ? {
            min: raw.salary_min ?? null,
            max: raw.salary_max ?? null,
            currency: null,
            period: 'year',
            raw: null,
          }
        : predicted
          ? { raw: 'The aggregator estimated this salary; the posting did not state one.' }
          : fields.salary;

    return emptyJob({
      externalJobId: raw.id ?? null,
      canonicalUrl: raw.redirect_url ?? null,
      applyUrl: raw.redirect_url ?? null,
      title,
      company: sanitizeLabel(raw.company?.display_name ?? 'Unknown company', 200),
      description,
      location: extractLocation(locationText),
      industry: raw.category?.label ?? null,
      postedAt: parseDate(raw.created),
      ...fields,
      salary,
      employmentType: normaliseContract(raw.contract_time, raw.contract_type) ?? fields.employmentType,
      provenance: {
        adapterKey: this.id,
        sourceType: 'authorized_api',
        note:
          'Found through the Adzuna API, which permits programmatic search. The link opens the original posting on ' +
          'the employer’s or aggregator’s own site.',
        fetchedAt: new Date(),
      },
    });
  }

  async search(input: JobSearchInput): Promise<JobSearchResult[]> {
    const { appId, appKey } = this.credentials();
    const country = countryFor(input.locations);

    const what = [...(input.titles ?? []), ...(input.keywords ?? []), input.query ?? '']
      .filter(Boolean)
      .join(' ')
      .trim()
      .slice(0, 200);

    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: String(Math.min(50, input.limit ?? 30)),
      'content-type': 'application/json',
    });
    if (what) params.set('what', what);
    if (input.locations?.[0]) params.set('where', input.locations[0].slice(0, 100));
    if (input.minSalary) params.set('salary_min', String(Math.round(input.minSalary)));
    if (input.postedWithinDays) params.set('max_days_old', String(Math.min(90, input.postedWithinDays)));
    if (input.workModes?.length === 1 && input.workModes[0] === 'remote') params.set('what_or', 'remote');

    let body: string;
    try {
      const res = await safeFetch(`https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params.toString()}`, {
        allowedHosts: this.allowedHosts(),
        accept: 'application/json',
        maxBytes: 3_000_000,
      });
      if (res.status === 401 || res.status === 403) {
        throw new JobSourceError(this.id, 'not_allowed', 'Adzuna rejected the configured credentials.');
      }
      if (res.status !== 200) {
        throw new JobSourceError(this.id, 'unreachable', `Adzuna returned HTTP ${res.status}.`);
      }
      body = res.body;
    } catch (err) {
      if (err instanceof JobSourceError) throw err;
      throw new JobSourceError(this.id, 'unreachable', 'Adzuna could not be reached.');
    }

    let parsed: { results?: AdzunaResult[] };
    try {
      parsed = JSON.parse(body) as { results?: AdzunaResult[] };
    } catch {
      throw new JobSourceError(this.id, 'invalid_response', 'Adzuna returned a response that could not be read.');
    }

    const excluded = new Set((input.excludedCompanies ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean));

    const out: JobSearchResult[] = [];
    for (const raw of parsed.results ?? []) {
      const job = this.toJob(raw);
      if (!job) continue;
      if (excluded.has(job.company.toLowerCase())) continue;
      out.push({ job });
    }
    return out;
  }

  async getJobDetails(input: JobDetailsInput): Promise<JobDetails | null> {
    // The search API is the only documented read path; there is no per-id
    // endpoint on the free tier. Re-searching by id is not supported, so the
    // honest answer is null and the caller falls back to the stored record.
    if (!input.externalJobId) return null;
    return null;
  }
}

function normaliseContract(time: string | undefined, type: string | undefined): string | null {
  const t = `${time ?? ''} ${type ?? ''}`.toLowerCase();
  if (t.includes('part_time') || t.includes('part time')) return 'part_time';
  if (t.includes('full_time') || t.includes('full time')) return 'full_time';
  if (t.includes('contract')) return 'contract';
  if (t.includes('intern')) return 'internship';
  return null;
}
