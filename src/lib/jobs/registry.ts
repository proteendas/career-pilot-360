/**
 * The job-source registry: the authoritative list of where CareerPilot360 is
 * allowed to get a job from, and what each source is permitted to do.
 *
 * Compliance model
 * ────────────────
 * Every job in the database points at exactly one row here, and the UI always
 * shows the resulting label. There is deliberately no "web crawler" entry.
 *
 *  authorized_api  A provider whose terms permit programmatic search, used with
 *                  the operator's own API credentials.
 *  public_board    An ATS (Greenhouse, Lever, Ashby) publishing a company's own
 *                  openings through a documented public JSON endpoint that the
 *                  company chose to expose.
 *  public_feed     A published feed (RSS/JSON) intended for syndication.
 *  user_provided   A URL the user pasted. Fetched once, with SSRF protection,
 *                  to help the user fill in the details they are importing.
 *  manual          The user typed or pasted the description themselves.
 *  external_link   A link only. No content is imported at all.
 *
 * LinkedIn, Naukri, Indeed and Glassdoor appear ONLY as `external_link` /
 * `user_provided`: their listings are never crawled, their pages are never
 * automated, and their private data is never touched.
 */

export type JobSourceType =
  | 'authorized_api'
  | 'public_board'
  | 'public_feed'
  | 'user_provided'
  | 'manual'
  | 'external_link';

export type PolicyStatus = 'allowed' | 'requires_configuration' | 'link_only';

export interface JobSourceDefinition {
  adapterKey: string;
  name: string;
  sourceType: JobSourceType;
  policyStatus: PolicyStatus;
  /** Shown verbatim in the UI so the user always knows the provenance. */
  policyNote: string;
  enabledByDefault: boolean;
  /** What this source can do, used to build the search plan. */
  capabilities: ('search' | 'details' | 'import_by_url' | 'manual_entry')[];
  /** Hosts this adapter is allowed to contact. Empty = no outbound fetch. */
  allowedHosts: string[];
}

export const JOB_SOURCE_REGISTRY: JobSourceDefinition[] = [
  {
    adapterKey: 'greenhouse',
    name: 'Greenhouse job boards',
    sourceType: 'public_board',
    policyStatus: 'allowed',
    policyNote:
      'Read from the public job-board API that a company enables for its own listings. One request per board, no crawling.',
    enabledByDefault: true,
    capabilities: ['search', 'details'],
    allowedHosts: ['boards-api.greenhouse.io', 'boards.greenhouse.io'],
  },
  {
    adapterKey: 'lever',
    name: 'Lever job boards',
    sourceType: 'public_board',
    policyStatus: 'allowed',
    policyNote: 'Read from Lever’s documented public postings endpoint for a named company.',
    enabledByDefault: true,
    capabilities: ['search', 'details'],
    allowedHosts: ['api.lever.co', 'jobs.lever.co'],
  },
  {
    adapterKey: 'ashby',
    name: 'Ashby job boards',
    sourceType: 'public_board',
    policyStatus: 'allowed',
    policyNote: 'Read from Ashby’s public posting API for a named company board.',
    enabledByDefault: true,
    capabilities: ['search', 'details'],
    allowedHosts: ['api.ashbyhq.com', 'jobs.ashbyhq.com'],
  },
  {
    adapterKey: 'adzuna',
    name: 'Adzuna (authorised API)',
    sourceType: 'authorized_api',
    policyStatus: 'requires_configuration',
    policyNote:
      'Aggregator search via Adzuna’s official API. Disabled until ADZUNA_APP_ID and ADZUNA_APP_KEY are configured.',
    enabledByDefault: false,
    capabilities: ['search', 'details'],
    allowedHosts: ['api.adzuna.com'],
  },
  {
    adapterKey: 'user_url',
    name: 'Job URL you provided',
    sourceType: 'user_provided',
    policyStatus: 'allowed',
    policyNote:
      'A single page you asked us to read, fetched once with SSRF protection so you can confirm the details. ' +
      'Applying still happens on the employer’s own site, in your browser.',
    enabledByDefault: true,
    capabilities: ['import_by_url', 'details'],
    // Intentionally empty: any public host is permitted for a URL the user
    // explicitly pasted, but only through `safeFetch`, and only once.
    allowedHosts: [],
  },
  {
    adapterKey: 'manual',
    name: 'Added manually by you',
    sourceType: 'manual',
    policyStatus: 'allowed',
    policyNote: 'You entered this job description yourself. Nothing was fetched.',
    enabledByDefault: true,
    capabilities: ['manual_entry'],
    allowedHosts: [],
  },
  {
    adapterKey: 'external_link',
    name: 'External link only',
    sourceType: 'external_link',
    policyStatus: 'link_only',
    policyNote:
      'Stored as a link with the details you supplied. Nothing is fetched or parsed from the destination. ' +
      'Used for platforms that do not permit programmatic access, including LinkedIn and Naukri.',
    enabledByDefault: true,
    capabilities: ['manual_entry'],
    allowedHosts: [],
  },
];

export function findSourceDefinition(adapterKey: string): JobSourceDefinition | undefined {
  return JOB_SOURCE_REGISTRY.find((s) => s.adapterKey === adapterKey);
}

/** Human label for the source badge shown on every job card. */
export const SOURCE_TYPE_LABELS: Record<JobSourceType, string> = {
  authorized_api: 'Official API',
  public_board: 'Public job board',
  public_feed: 'Authorised public feed',
  user_provided: 'External user-provided listing',
  manual: 'Added manually',
  external_link: 'External link only',
};

export const SOURCE_TYPE_TONES: Record<JobSourceType, 'success' | 'info' | 'accent' | 'neutral' | 'warning'> = {
  authorized_api: 'success',
  public_board: 'success',
  public_feed: 'info',
  user_provided: 'warning',
  manual: 'neutral',
  external_link: 'neutral',
};

/**
 * Hosts we recognise as platforms that must never be crawled. Pasting a URL
 * from one of these is fine — it becomes an `external_link` record — but no
 * adapter will ever fetch or parse it.
 */
export const NO_FETCH_HOSTS = [
  'linkedin.com',
  'naukri.com',
  'indeed.com',
  'glassdoor.com',
  'glassdoor.co.in',
  'monster.com',
  'shine.com',
  'ziprecruiter.com',
] as const;

export function isNoFetchHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return NO_FETCH_HOSTS.some((blocked) => h === blocked || h.endsWith(`.${blocked}`));
}

/**
 * Decide how a pasted URL must be handled.
 * Returns the adapter key that is allowed to process it.
 */
export function classifyPastedUrl(hostname: string): {
  adapterKey: 'external_link' | 'user_url';
  mayFetch: boolean;
  reason: string;
} {
  if (isNoFetchHost(hostname)) {
    return {
      adapterKey: 'external_link',
      mayFetch: false,
      reason:
        `${hostname} does not permit programmatic access, so nothing is fetched from it. ` +
        'Paste the details you want to keep, and open the listing yourself to apply.',
    };
  }
  return {
    adapterKey: 'user_url',
    mayFetch: true,
    reason: 'Fetched once, as plain text, so you can confirm the details before saving.',
  };
}
