/**
 * Job source adapter contract.
 *
 * Every adapter is a thin, auditable translation from one permitted source into
 * `NormalizedJob`. An adapter may only reach the hosts declared for it in
 * `registry.ts`, and only through `safeFetch`, so the compliance boundary is a
 * property of the architecture rather than a convention.
 */
import type { JobSourceType } from './registry';

export interface SalaryData {
  min?: number | null;
  max?: number | null;
  currency?: string | null;
  /** 'year' | 'month' | 'day' | 'hour' */
  period?: string | null;
  /** The provider's own text, kept verbatim when we cannot parse it. */
  raw?: string | null;
}

export interface LocationData {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  raw?: string | null;
  remote?: boolean | null;
}

export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'unknown';
export type VisaSponsorship = 'yes' | 'no' | 'unknown';

/**
 * A job as the rest of the app sees it, regardless of where it came from.
 * `provenance` is not optional: a job with no traceable origin must not exist.
 */
export interface NormalizedJob {
  /** Provider's own id, when it has one. */
  externalJobId: string | null;
  canonicalUrl: string | null;
  /** Where a human should go to apply. Often the same as canonicalUrl. */
  applyUrl: string | null;
  title: string;
  company: string;
  companyDomain: string | null;
  description: string;
  responsibilities: string[];
  requirements: string[];
  preferredQualifications: string[];
  skills: string[];
  salary: SalaryData;
  location: LocationData;
  workMode: WorkMode;
  employmentType: string | null;
  seniority: string | null;
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  industry: string | null;
  visaSponsorship: VisaSponsorship;
  postedAt: Date | null;
  expiresAt: Date | null;
  provenance: {
    adapterKey: string;
    sourceType: JobSourceType;
    /** Shown to the user verbatim. */
    note: string;
    fetchedAt: Date;
  };
}

export interface JobSearchInput {
  /** Free-text query. */
  query?: string;
  titles?: string[];
  keywords?: string[];
  skills?: string[];
  locations?: string[];
  workModes?: WorkMode[];
  employmentTypes?: string[];
  seniority?: string[];
  /** Company board slugs, for the ATS board adapters. */
  companies?: string[];
  excludedCompanies?: string[];
  minSalary?: number | null;
  currency?: string | null;
  experienceYears?: number | null;
  postedWithinDays?: number | null;
  limit?: number;
  /** Abort signal so one slow source cannot hold the whole search open. */
  signal?: AbortSignal;
}

export interface JobSearchResult {
  job: NormalizedJob;
  /** Adapter's own relevance hint, if any. Never used as the match score. */
  sourceRelevance?: number;
}

export interface JobDetailsInput {
  externalJobId?: string | null;
  url?: string | null;
  company?: string | null;
  signal?: AbortSignal;
}

export type JobDetails = NormalizedJob;

/** The interface required by the spec, implemented by every adapter. */
export interface JobSourceAdapter {
  id: string;
  name: string;
  capabilities: string[];
  search(input: JobSearchInput): Promise<JobSearchResult[]>;
  getJobDetails(input: JobDetailsInput): Promise<JobDetails | null>;
}

export class JobSourceError extends Error {
  readonly adapterKey: string;
  readonly code: 'not_configured' | 'unreachable' | 'not_allowed' | 'invalid_response' | 'not_found';

  constructor(
    adapterKey: string,
    code: JobSourceError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'JobSourceError';
    this.adapterKey = adapterKey;
    this.code = code;
  }
}

/* ------------------------------------------------------------- utilities -- */

export function emptyJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    externalJobId: null,
    canonicalUrl: null,
    applyUrl: null,
    title: '',
    company: '',
    companyDomain: null,
    description: '',
    responsibilities: [],
    requirements: [],
    preferredQualifications: [],
    skills: [],
    salary: {},
    location: {},
    workMode: 'unknown',
    employmentType: null,
    seniority: null,
    experienceMinYears: null,
    experienceMaxYears: null,
    industry: null,
    visaSponsorship: 'unknown',
    postedAt: null,
    expiresAt: null,
    provenance: {
      adapterKey: 'manual',
      sourceType: 'manual',
      note: 'Entered manually.',
      fetchedAt: new Date(),
    },
    ...overrides,
  };
}
