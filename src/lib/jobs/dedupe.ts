/**
 * Job deduplication. Pure and unit-tested.
 *
 * The same opening frequently arrives from several places: a company's
 * Greenhouse board, an aggregator API, and a URL the user pasted. We want one
 * row per real opening, without collapsing two genuinely different roles.
 *
 * Strategy — first stable identity wins:
 *   1. canonical URL      (strongest: the employer's own address for the role)
 *   2. source + external id
 *   3. company + title + location + description hash
 *
 * The fallback deliberately includes the description hash: two "Software
 * Engineer" roles at the same company in the same city are usually different
 * teams, and merging them would lose one.
 */

export interface DedupeInput {
  sourceKey: string;
  externalJobId?: string | null;
  canonicalUrl?: string | null;
  company: string;
  title: string;
  location?: string | null;
  descriptionHash: string;
}

/** Tracking parameters that change per visit but never identify the job. */
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'gh_src', 'gh_jid', 'lever-source', 'source', 'ref', 'referrer', 'trk', 'trkInfo',
  'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid', '_ga',
];

/**
 * Reduce a job URL to a stable identity.
 * Lowercases the host, drops tracking parameters, sorts the rest, and strips
 * a trailing slash. Never throws: an unparseable value is returned trimmed.
 */
export function canonicalizeJobUrl(raw: string | null | undefined): string | null {
  const input = (raw ?? '').trim();
  if (!input) return null;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input.toLowerCase() || null;
  }

  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  url.protocol = 'https:';
  url.port = '';

  const kept = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.includes(k.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));

  const search = new URLSearchParams();
  for (const [k, v] of kept) search.append(k, v);
  url.search = search.toString();

  let out = url.toString();
  if (out.endsWith('/') && url.pathname !== '/') out = out.slice(0, -1);
  return out;
}

/** Normalise a company name so "Acme, Inc." and "acme inc" collide. */
export function normalizeCompany(raw: string): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|gmbh|pvt|private|plc|co|company|technologies|technology|labs|group|holdings)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

/** Normalise a job title: strip seniority noise that varies between sources. */
export function normalizeTitle(raw: string): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(remote|hybrid|onsite|on-site|contract|full[-\s]?time|part[-\s]?time|urgent|hiring|immediate joiner)\b/g, ' ')
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

/** Normalise a location to its most significant token. */
export function normalizeLocation(raw: string | null | undefined): string {
  const s = (raw ?? '').toLowerCase().trim();
  if (!s) return 'unspecified';
  if (/\b(remote|anywhere|work from home|wfh)\b/.test(s)) return 'remote';
  return s
    .split(/[,/|]/)[0]!
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-') || 'unspecified';
}

/**
 * Compute the stable dedupe key stored on `jobs.dedupe_key` (unique index).
 * Deterministic: the same opening always yields the same key.
 */
export function computeDedupeKey(input: DedupeInput): string {
  const canonical = canonicalizeJobUrl(input.canonicalUrl);
  if (canonical) return `url:${canonical}`;

  const external = (input.externalJobId ?? '').trim();
  if (external) return `src:${input.sourceKey}:${external}`;

  return [
    'fp',
    normalizeCompany(input.company),
    normalizeTitle(input.title),
    normalizeLocation(input.location),
    input.descriptionHash.slice(0, 16),
  ].join(':');
}

export interface DuplicateVerdict {
  duplicate: boolean;
  /** Which rule matched, for display and for tests. */
  rule: 'canonical_url' | 'source_external_id' | 'fingerprint' | 'none';
  confidence: 'exact' | 'high' | 'none';
}

/** Compare two jobs directly, for reporting why a row was merged. */
export function compareJobs(a: DedupeInput, b: DedupeInput): DuplicateVerdict {
  const urlA = canonicalizeJobUrl(a.canonicalUrl);
  const urlB = canonicalizeJobUrl(b.canonicalUrl);
  if (urlA && urlB && urlA === urlB) {
    return { duplicate: true, rule: 'canonical_url', confidence: 'exact' };
  }

  if (
    a.sourceKey === b.sourceKey &&
    a.externalJobId &&
    b.externalJobId &&
    a.externalJobId.trim() === b.externalJobId.trim()
  ) {
    return { duplicate: true, rule: 'source_external_id', confidence: 'exact' };
  }

  const sameCompany = normalizeCompany(a.company) === normalizeCompany(b.company);
  const sameTitle = normalizeTitle(a.title) === normalizeTitle(b.title);
  const sameLocation = normalizeLocation(a.location) === normalizeLocation(b.location);
  const sameBody = a.descriptionHash === b.descriptionHash;

  if (sameCompany && sameTitle && sameLocation && sameBody) {
    return { duplicate: true, rule: 'fingerprint', confidence: 'high' };
  }

  return { duplicate: false, rule: 'none', confidence: 'none' };
}

/**
 * Collapse a batch of freshly-imported results before they reach the database.
 * Keeps the first occurrence, which callers should order by source trust.
 */
export function dedupeBatch<T extends DedupeInput>(items: T[]): { kept: T[]; removed: number } {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const item of items) {
    const key = computeDedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
  }
  return { kept, removed: items.length - kept.length };
}
