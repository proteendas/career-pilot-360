import { describe, expect, it } from 'vitest';
import {
  canonicalizeJobUrl,
  compareJobs,
  computeDedupeKey,
  dedupeBatch,
  normalizeCompany,
  normalizeLocation,
  normalizeTitle,
  type DedupeInput,
} from '@/lib/jobs/dedupe';
import { classifyPastedUrl, isNoFetchHost, findSourceDefinition, JOB_SOURCE_REGISTRY } from '@/lib/jobs/registry';

const base: DedupeInput = {
  sourceKey: 'greenhouse',
  externalJobId: null,
  canonicalUrl: null,
  company: 'Northwind Payments',
  title: 'Senior Backend Engineer',
  location: 'Bengaluru, India',
  descriptionHash: 'a'.repeat(64),
};

describe('canonicalizeJobUrl', () => {
  it('drops tracking parameters and normalises the host', () => {
    const a = canonicalizeJobUrl('https://WWW.Example.com/jobs/12?utm_source=li&gh_src=abc&id=7#apply');
    expect(a).toBe('https://example.com/jobs/12?id=7');
  });

  it('sorts remaining query parameters so ordering does not matter', () => {
    expect(canonicalizeJobUrl('https://x.com/j?b=2&a=1')).toBe(canonicalizeJobUrl('https://x.com/j?a=1&b=2'));
  });

  it('upgrades scheme and removes a trailing slash', () => {
    expect(canonicalizeJobUrl('http://example.com/jobs/12/')).toBe('https://example.com/jobs/12');
  });

  it('keeps a bare root path intact', () => {
    expect(canonicalizeJobUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('returns null for empty input and passes through unparseable values', () => {
    expect(canonicalizeJobUrl('')).toBeNull();
    expect(canonicalizeJobUrl(null)).toBeNull();
    expect(canonicalizeJobUrl('not a url')).toBe('not a url');
  });
});

describe('normalisers', () => {
  it('collapses company suffixes', () => {
    expect(normalizeCompany('Acme, Inc.')).toBe(normalizeCompany('acme'));
    expect(normalizeCompany('Northwind Technologies Pvt Ltd')).toBe(normalizeCompany('Northwind'));
  });

  it('strips work-mode and urgency noise from titles', () => {
    expect(normalizeTitle('Senior Backend Engineer (Remote)')).toBe(normalizeTitle('senior backend engineer'));
    expect(normalizeTitle('URGENT Hiring: Backend Engineer - Full Time')).toContain('backend-engineer');
  });

  it('preserves meaningful title characters', () => {
    expect(normalizeTitle('C++ Developer')).toBe('c++-developer');
    expect(normalizeTitle('C# / .NET Engineer')).toContain('c#');
  });

  it('treats all remote phrasings as the same location', () => {
    for (const v of ['Remote', 'remote - anywhere', 'Work From Home', 'WFH']) {
      expect(normalizeLocation(v)).toBe('remote');
    }
  });

  it('uses the first location segment', () => {
    expect(normalizeLocation('Bengaluru, Karnataka, India')).toBe('bengaluru');
    expect(normalizeLocation('')).toBe('unspecified');
    expect(normalizeLocation(null)).toBe('unspecified');
  });
});

describe('computeDedupeKey', () => {
  it('prefers the canonical URL when present', () => {
    const key = computeDedupeKey({ ...base, canonicalUrl: 'https://example.com/jobs/1?utm_source=x' });
    expect(key).toBe('url:https://example.com/jobs/1');
  });

  it('falls back to source and external id', () => {
    expect(computeDedupeKey({ ...base, externalJobId: '4055' })).toBe('src:greenhouse:4055');
  });

  it('falls back to a fingerprint when there is no stable identifier', () => {
    const key = computeDedupeKey(base);
    expect(key.startsWith('fp:')).toBe(true);
    expect(key).toContain('northwind-payments');
    expect(key).toContain('senior-backend-engineer');
    expect(key).toContain('bengaluru');
  });

  it('is deterministic', () => {
    expect(computeDedupeKey(base)).toBe(computeDedupeKey({ ...base }));
  });

  it('keeps two same-titled roles at one company distinct when the body differs', () => {
    const a = computeDedupeKey(base);
    const b = computeDedupeKey({ ...base, descriptionHash: 'b'.repeat(64) });
    expect(a).not.toBe(b);
  });
});

describe('compareJobs', () => {
  it('matches on canonical URL across different sources', () => {
    const a = { ...base, sourceKey: 'greenhouse', canonicalUrl: 'https://acme.com/jobs/9?utm_source=a' };
    const b = { ...base, sourceKey: 'adzuna', canonicalUrl: 'https://acme.com/jobs/9?utm_medium=b' };
    expect(compareJobs(a, b)).toEqual({ duplicate: true, rule: 'canonical_url', confidence: 'exact' });
  });

  it('matches on external id only within the same source', () => {
    const a = { ...base, sourceKey: 'lever', externalJobId: '77' };
    const b = { ...base, sourceKey: 'ashby', externalJobId: '77' };
    expect(compareJobs(a, b).rule).not.toBe('source_external_id');
    expect(compareJobs(a, { ...a }).rule).toBe('source_external_id');
  });

  it('matches on fingerprint when everything meaningful agrees', () => {
    const a = { ...base, company: 'Acme, Inc.', title: 'Backend Engineer (Remote)', location: 'Remote' };
    const b = { ...base, company: 'acme', title: 'backend engineer', location: 'remote - india' };
    expect(compareJobs(a, b)).toEqual({ duplicate: true, rule: 'fingerprint', confidence: 'high' });
  });

  it('reports no duplicate for genuinely different roles', () => {
    const a = base;
    const b = { ...base, title: 'Frontend Engineer', descriptionHash: 'c'.repeat(64) };
    expect(compareJobs(a, b)).toEqual({ duplicate: false, rule: 'none', confidence: 'none' });
  });
});

describe('dedupeBatch', () => {
  it('keeps the first occurrence and reports how many were dropped', () => {
    const items: DedupeInput[] = [
      { ...base, canonicalUrl: 'https://a.com/1' },
      { ...base, canonicalUrl: 'https://a.com/1?utm_source=x' },
      { ...base, canonicalUrl: 'https://a.com/2' },
    ];
    const { kept, removed } = dedupeBatch(items);
    expect(kept).toHaveLength(2);
    expect(removed).toBe(1);
    expect(kept[0]!.canonicalUrl).toBe('https://a.com/1');
  });

  it('handles an empty batch', () => {
    expect(dedupeBatch([])).toEqual({ kept: [], removed: 0 });
  });
});

describe('source registry compliance rules', () => {
  it('identifies platforms that must never be fetched', () => {
    for (const host of [
      'linkedin.com',
      'www.linkedin.com',
      'in.linkedin.com',
      'naukri.com',
      'www.naukri.com',
      'indeed.com',
      'glassdoor.co.in',
    ]) {
      expect(isNoFetchHost(host)).toBe(true);
    }
  });

  it('does not block ordinary ATS and company hosts', () => {
    for (const host of ['boards.greenhouse.io', 'jobs.lever.co', 'api.ashbyhq.com', 'careers.acme.com']) {
      expect(isNoFetchHost(host)).toBe(false);
    }
  });

  it('routes a LinkedIn URL to link-only handling with no fetch', () => {
    const verdict = classifyPastedUrl('www.linkedin.com');
    expect(verdict.adapterKey).toBe('external_link');
    expect(verdict.mayFetch).toBe(false);
    expect(verdict.reason).toMatch(/does not permit programmatic access/);
  });

  it('allows a single fetch for an ordinary company careers page', () => {
    const verdict = classifyPastedUrl('careers.acme.com');
    expect(verdict.adapterKey).toBe('user_url');
    expect(verdict.mayFetch).toBe(true);
  });

  it('has no registry entry that permits crawling', () => {
    for (const src of JOB_SOURCE_REGISTRY) {
      expect(src.capabilities).not.toContain('crawl');
      // Sources with an outbound fetch must declare their allowed hosts,
      // except the explicit user-pasted-URL adapter.
      if (src.capabilities.includes('search') && src.adapterKey !== 'user_url') {
        expect(src.allowedHosts.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the opt-in aggregator disabled by default', () => {
    const adzuna = findSourceDefinition('adzuna');
    expect(adzuna?.enabledByDefault).toBe(false);
    expect(adzuna?.policyStatus).toBe('requires_configuration');
  });

  it('exposes every registry key uniquely', () => {
    const keys = JOB_SOURCE_REGISTRY.map((s) => s.adapterKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
