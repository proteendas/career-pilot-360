import { describe, expect, it } from 'vitest';
import { matchJob, realGaps, GAP_LABELS, type MatchInput } from '@/lib/jobs/match';
import { extractJobFields, extractSalary, extractSkills, structureDescription, extractExperienceYears, extractWorkMode, extractSeniority, extractVisaSponsorship, extractEmploymentType, parseDate } from '@/lib/jobs/extract';
import { normalizeResumeText } from '@/lib/resume/normalize';
import { emptyProfile, type FullProfile } from '@/lib/profile/types';
import { STRONG_RESUME, SAMPLE_JOB_DESCRIPTION } from './fixtures/resumes';
import type { JobWithSource } from '@/lib/jobs/service';

/* ------------------------------------------------------------------ helpers */

function makeJob(overrides: Partial<JobWithSource> = {}): JobWithSource {
  const fields = extractJobFields('Senior Backend Engineer', SAMPLE_JOB_DESCRIPTION, 'Bengaluru, India');
  return {
    id: 'job-1',
    sourceId: 'src-1',
    ownerUserId: null,
    externalJobId: 'ext-1',
    canonicalUrl: 'https://example.com/jobs/1',
    applyUrl: 'https://example.com/jobs/1',
    title: 'Senior Backend Engineer',
    company: 'Northwind Payments',
    companyDomain: null,
    description: SAMPLE_JOB_DESCRIPTION,
    responsibilities: fields.responsibilities,
    requirements: fields.requirements,
    preferredQualifications: fields.preferredQualifications,
    skills: fields.skills,
    salaryData: fields.salary,
    locationData: { city: 'Bengaluru', country: 'India', raw: 'Bengaluru, India' },
    workMode: fields.workMode,
    employmentType: fields.employmentType,
    seniority: fields.seniority,
    experienceMinYears: fields.experienceMinYears,
    experienceMaxYears: fields.experienceMaxYears,
    industry: null,
    visaSponsorship: fields.visaSponsorship,
    postedAt: new Date('2026-08-01T00:00:00Z'),
    expiresAt: null,
    descriptionHash: 'a'.repeat(64),
    dedupeKey: 'url:https://example.com/jobs/1',
    fetchedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    sourceName: 'Greenhouse job boards',
    sourceAdapterKey: 'greenhouse',
    sourceType: 'public_board',
    sourcePolicyNote: 'Public board.',
    sourceLabel: 'Public job board',
    saved: false,
    hidden: false,
    ...overrides,
  } as JobWithSource;
}

function makeProfile(overrides: Partial<FullProfile['professional']> = {}, prefs: Partial<FullProfile['jobPreferences']> = {}): FullProfile {
  const p = emptyProfile();
  p.professional = {
    ...p.professional,
    yearsOfExperience: 7,
    careerLevel: 'senior',
    skills: ['TypeScript', 'PostgreSQL', 'Kafka', 'Kubernetes', 'AWS', 'Docker', 'Terraform', 'Redis'],
    targetTitles: ['Senior Backend Engineer'],
    ...overrides,
  };
  p.jobPreferences = {
    ...p.jobPreferences,
    preferredLocations: ['Bengaluru'],
    minExpectedCtc: 4_000_000,
    currency: 'INR',
    noticePeriodDays: 60,
    needsVisaSponsorship: false,
    ...prefs,
  };
  return p;
}

const resume = normalizeResumeText(STRONG_RESUME).resume;

/**
 * A resume whose text mentions ONLY the given skills.
 *
 * Matching reads the whole document, not just the skills list — which is
 * correct, since a reviewer does too. So a fixture that merely edits the skills
 * array still "has" whatever its bullets and summary mention. Everything
 * narrative is cleared here so the test controls exactly what is evidenced.
 */
function resumeWithOnlySkills(skills: string[]) {
  const only = structuredClone(resume);
  only.summary = 'Backend engineer.';
  only.summarySource = 'user';
  only.skills = [{ id: '', category: '', skills, source: 'parsed' }];
  only.projects = [];
  only.certifications = [];
  only.experience = only.experience.map((e) => ({
    ...e,
    summary: '',
    technologies: [],
    bullets: [{ id: 'b', text: 'Built and operated backend services.', source: 'parsed' as const }],
  }));
  return only;
}

function run(overrides: Partial<MatchInput> = {}) {
  return matchJob({ job: makeJob(), resume, profile: makeProfile(), ...overrides });
}

/* ------------------------------------------------------- description parsing */

describe('job description extraction', () => {
  it('splits responsibilities, requirements and preferred qualifications', () => {
    const s = structureDescription(SAMPLE_JOB_DESCRIPTION);
    expect(s.responsibilities.join(' ')).toMatch(/high-throughput/i);
    expect(s.requirements.join(' ')).toMatch(/5\+ years/i);
    expect(s.preferredQualifications.join(' ')).toMatch(/fintech/i);
    // A requirement must not leak into responsibilities.
    expect(s.responsibilities.join(' ')).not.toMatch(/5\+ years/i);
  });

  it('extracts only known skills, never arbitrary capitalised words', () => {
    const skills = extractSkills(SAMPLE_JOB_DESCRIPTION);
    expect(skills).toContain('PostgreSQL');
    expect(skills).toContain('Kafka');
    expect(skills).toContain('Kubernetes');
    expect(skills).toContain('Terraform');
    // "Bengaluru" and "About" are capitalised but are not skills.
    expect(skills).not.toContain('Bengaluru');
    expect(skills).not.toContain('About');
  });

  it('collapses Golang to Go so matching does not double count', () => {
    const skills = extractSkills('We need a Golang engineer with Go experience.');
    expect(skills.filter((s) => s === 'Go')).toHaveLength(1);
    expect(skills).not.toContain('Golang');
  });

  it('reads an Indian lakh-scale salary range', () => {
    const salary = extractSalary('Compensation: 35,00,000 - 55,00,000 INR per annum');
    expect(salary.min).toBe(3_500_000);
    expect(salary.max).toBe(5_500_000);
    expect(salary.currency).toBe('INR');
    expect(salary.period).toBe('year');
  });

  it('reads an LPA shorthand range', () => {
    const salary = extractSalary('Salary: 35 - 55 LPA');
    expect(salary.min).toBe(3_500_000);
    expect(salary.max).toBe(5_500_000);
  });

  it('reads a USD k-scale range', () => {
    const salary = extractSalary('$120k – $160k per year');
    expect(salary.min).toBe(120_000);
    expect(salary.max).toBe(160_000);
    expect(salary.currency).toBe('USD');
  });

  it('asserts no figure when compensation is not stated', () => {
    const salary = extractSalary('We offer a competitive salary and great benefits.');
    expect(salary.min).toBeUndefined();
    expect(salary.max).toBeUndefined();
  });

  it('does not mistake an unrelated number for a salary', () => {
    const salary = extractSalary('You will work with 12 engineers on 3 services.');
    expect(salary.min).toBeUndefined();
  });

  it('extracts experience ranges and single minimums', () => {
    expect(extractExperienceYears('3-5 years of experience')).toEqual({ min: 3, max: 5 });
    expect(extractExperienceYears('5+ years building backend services')).toEqual({ min: 5, max: null });
    expect(extractExperienceYears('at least 8 years of relevant experience')).toEqual({ min: 8, max: null });
    expect(extractExperienceYears('no experience requirement stated')).toEqual({ min: null, max: null });
  });

  it('prefers hybrid over remote when both appear', () => {
    expect(extractWorkMode('This is a hybrid role with remote Fridays')).toBe('hybrid');
    expect(extractWorkMode('Fully remote position')).toBe('remote');
    expect(extractWorkMode('This is not a remote role')).toBe('onsite');
    expect(extractWorkMode('Great team, great mission')).toBe('unknown');
  });

  it('reads seniority from the title before the body', () => {
    expect(extractSeniority('Senior Backend Engineer', 'junior developers welcome')).toBe('senior');
    expect(extractSeniority('Staff Engineer', '')).toBe('principal');
    expect(extractSeniority('Backend Engineer', '')).toBeNull();
  });

  it('reads sponsorship only when stated, defaulting to unknown', () => {
    expect(extractVisaSponsorship('We do not sponsor visas for this role.')).toBe('no');
    expect(extractVisaSponsorship('Visa sponsorship is available.')).toBe('yes');
    expect(extractVisaSponsorship('Great benefits and a strong team.')).toBe('unknown');
  });

  it('reads employment type', () => {
    expect(extractEmploymentType('This is a full-time permanent role')).toBe('full_time');
    expect(extractEmploymentType('6-month contract')).toBe('contract');
    expect(extractEmploymentType('Summer internship')).toBe('internship');
  });

  it('rejects implausible provider dates', () => {
    expect(parseDate('1970-01-01')).toBeNull();
    expect(parseDate('not a date')).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate('2026-08-01T00:00:00Z')).toBeInstanceOf(Date);
  });
});

/* ---------------------------------------------------------------- matching */

describe('deterministic scoring', () => {
  it('is reproducible', () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('reports a score in range and a deterministic mode', () => {
    const result = run();
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.mode).toBe('deterministic');
    expect(result.signals).toHaveLength(10);
  });

  it('scores a well-matched candidate highly', () => {
    expect(run().score).toBeGreaterThan(70);
  });

  it('excludes unscoreable signals rather than counting them as zero', () => {
    // A job with no salary, no experience minimum and no level stated.
    const bare = makeJob({
      salaryData: {},
      experienceMinYears: null,
      seniority: null,
      visaSponsorship: 'unknown',
    });
    const result = matchJob({ job: bare, resume, profile: makeProfile() });

    const nulls = result.signals.filter((s) => s.score === null);
    expect(nulls.length).toBeGreaterThan(0);
    // Those omissions must not drag the score to the floor.
    expect(result.score).toBeGreaterThan(60);
    expect(result.explanation).toMatch(/excluded rather than counted as zero/i);
  });

  it('explains itself', () => {
    const result = run();
    expect(result.explanation.length).toBeGreaterThan(30);
    for (const signal of result.signals) {
      expect(signal.explanation.length, signal.key).toBeGreaterThan(10);
    }
  });
});

describe('never infers a skill', () => {
  it('does not credit Kubernetes because the candidate has Docker', () => {
    const profile = makeProfile({ skills: ['Docker', 'TypeScript', 'PostgreSQL'] });
    const dockerResume = resumeWithOnlySkills(['Docker']);

    const result = matchJob({ job: makeJob(), resume: dockerResume, profile });

    expect(result.matchedRequiredSkills).not.toContain('kubernetes');
    const gap = result.gaps.find((g) => g.requirement === 'kubernetes');
    expect(gap).toBeDefined();
    // Docker is reported as adjacent context, not as a substitute.
    expect(gap!.relatedTo).toContain('docker');
    expect(result.transferable.some((t) => t.candidateHas === 'docker' && t.jobWants === 'kubernetes')).toBe(true);
  });

  it('labels transferable skills as context, not as a substitute', () => {
    const profile = makeProfile({ skills: ['Docker'] });
    const result = matchJob({ job: makeJob(), resume: resumeWithOnlySkills(['Docker']), profile });
    expect(result.transferable.length).toBeGreaterThan(0);
    for (const t of result.transferable) {
      expect(t.reason).toMatch(/not a substitute/i);
    }
  });

  it('only credits a skill the candidate actually claims', () => {
    const profile = makeProfile({ skills: ['TypeScript'] });
    const result = matchJob({ job: makeJob(), resume: resumeWithOnlySkills(['TypeScript']), profile });
    for (const matched of result.matchedRequiredSkills) {
      expect(['typescript'], `unexpectedly matched ${matched}`).toContain(matched);
    }
  });
});

describe('distinguishes kinds of absence', () => {
  it('flags a skill in the profile but absent from the resume', () => {
    // Terraform is in the profile but nowhere in the resume text.
    const profile = makeProfile({ skills: ['Terraform', 'TypeScript', 'PostgreSQL', 'Kafka'] });
    const result = matchJob({ job: makeJob(), resume: resumeWithOnlySkills(['TypeScript']), profile });

    const gap = result.gaps.find((g) => g.requirement === 'terraform');
    expect(gap?.kind).toBe('missing_from_resume');
    // The candidate HAS it, so it counts toward the score and is not a real gap.
    expect(gap?.countsAgainstScore).toBe(false);
    expect(result.matchedRequiredSkills).toContain('terraform');
    expect(realGaps(result).some((g) => g.requirement === 'terraform')).toBe(false);
    expect(result.explanation).toMatch(/missing from this resume/i);
  });

  it('says "probably missing from profile" when the profile is thin', () => {
    const thin = emptyProfile();
    thin.professional.skills = ['TypeScript'];
    const result = matchJob({ job: makeJob(), resume: resumeWithOnlySkills(['TypeScript']), profile: thin });
    const gaps = result.gaps.filter((g) => g.kind === 'missing_from_profile');
    expect(gaps.length).toBeGreaterThan(0);
  });

  it('says "explicitly not present" when the profile is substantial', () => {
    const full = makeProfile({
      skills: ['TypeScript', 'Redis', 'AWS', 'Docker', 'Jest', 'Git', 'Linux', 'REST', 'SQL'],
    });
    const result = matchJob({ job: makeJob(), resume: resumeWithOnlySkills(['TypeScript']), profile: full });
    const gaps = result.gaps.filter((g) => g.kind === 'not_present');
    expect(gaps.length).toBeGreaterThan(0);
  });

  it('marks soft requirements as unable to verify, and excludes them from real gaps', () => {
    const job = makeJob({
      requirements: [
        'Excellent communication skills',
        'Must be a team player who thrives in a fast-paced environment',
        'Strong PostgreSQL experience',
      ],
    });
    const result = matchJob({ job, resume, profile: makeProfile() });

    const unverifiable = result.gaps.filter((g) => g.kind === 'unable_to_verify');
    expect(unverifiable.length).toBeGreaterThanOrEqual(2);
    expect(realGaps(result).every((g) => g.kind !== 'unable_to_verify')).toBe(true);
  });

  it('has a human label and explanation for every gap kind', () => {
    for (const kind of ['missing_from_resume', 'missing_from_profile', 'not_present', 'unable_to_verify'] as const) {
      expect(GAP_LABELS[kind].length).toBeGreaterThan(5);
    }
  });
});

describe('experience and seniority', () => {
  it('penalises a shortfall and raises a concern', () => {
    const result = matchJob({
      job: makeJob({ experienceMinYears: 10 }),
      resume,
      profile: makeProfile({ yearsOfExperience: 3 }),
    });
    const signal = result.signals.find((s) => s.key === 'experience')!;
    expect(signal.score).toBeLessThan(60);
    expect(result.concerns.some((c) => /short of the stated minimum/i.test(c.title))).toBe(true);
  });

  it('does not penalise being over the minimum, but notes it', () => {
    const result = matchJob({
      job: makeJob({ experienceMinYears: 2 }),
      resume,
      profile: makeProfile({ yearsOfExperience: 12 }),
    });
    const signal = result.signals.find((s) => s.key === 'experience')!;
    expect(signal.score).toBe(100);
    expect(result.concerns.some((c) => /over-levelled/i.test(c.title))).toBe(true);
  });

  it('scores seniority by distance between levels', () => {
    const aligned = matchJob({ job: makeJob({ seniority: 'senior' }), resume, profile: makeProfile() });
    const mismatched = matchJob({ job: makeJob({ seniority: 'executive' }), resume, profile: makeProfile() });

    const a = aligned.signals.find((s) => s.key === 'seniority')!.score;
    const m = mismatched.signals.find((s) => s.key === 'seniority')!.score;
    expect(a).toBe(100);
    expect(m).toBeLessThan(a!);
  });
});

describe('location, salary and authorisation', () => {
  it('treats a remote role as unconstrained by location', () => {
    const result = matchJob({
      job: makeJob({ workMode: 'remote' }),
      resume,
      profile: makeProfile({}, { preferredLocations: ['Berlin'] }),
    });
    expect(result.signals.find((s) => s.key === 'location')!.score).toBe(100);
  });

  it('softens a location mismatch when the user will relocate', () => {
    const wont = matchJob({
      job: makeJob({ workMode: 'onsite' }),
      resume,
      profile: makeProfile({}, { preferredLocations: ['Berlin'], willingToRelocate: false }),
    });
    const will = matchJob({
      job: makeJob({ workMode: 'onsite' }),
      resume,
      profile: makeProfile({}, { preferredLocations: ['Berlin'], willingToRelocate: true }),
    });
    expect(will.signals.find((s) => s.key === 'location')!.score).toBeGreaterThan(
      wont.signals.find((s) => s.key === 'location')!.score!,
    );
  });

  it('refuses to compare salaries across currencies', () => {
    const result = matchJob({
      job: makeJob({ salaryData: { min: 120_000, max: 160_000, currency: 'USD', period: 'year' } }),
      resume,
      profile: makeProfile({}, { minExpectedCtc: 4_000_000, currency: 'INR' }),
    });
    const signal = result.signals.find((s) => s.key === 'salary')!;
    expect(signal.score).toBeNull();
    expect(signal.explanation).toMatch(/no conversion is applied/i);
  });

  it('flags a stated range below the user minimum', () => {
    const result = matchJob({
      job: makeJob({ salaryData: { min: 1_000_000, max: 2_000_000, currency: 'INR', period: 'year' } }),
      resume,
      profile: makeProfile({}, { minExpectedCtc: 4_000_000, currency: 'INR' }),
    });
    expect(result.concerns.some((c) => /below your minimum/i.test(c.title))).toBe(true);
  });

  it('does not score salary when the posting states none', () => {
    const result = matchJob({ job: makeJob({ salaryData: {} }), resume, profile: makeProfile() });
    expect(result.signals.find((s) => s.key === 'salary')!.score).toBeNull();
  });

  it('treats an explicit no-sponsorship posting as a hard blocker', () => {
    const result = matchJob({
      job: makeJob({ visaSponsorship: 'no' }),
      resume,
      profile: makeProfile({}, { needsVisaSponsorship: true }),
    });
    expect(result.signals.find((s) => s.key === 'work_authorization')!.score).toBe(0);
    expect(result.concerns.some((c) => c.severity === 'high' && /sponsor/i.test(c.title))).toBe(true);
  });

  it('ignores authorisation entirely when sponsorship is not needed', () => {
    const result = matchJob({
      job: makeJob({ visaSponsorship: 'no' }),
      resume,
      profile: makeProfile({}, { needsVisaSponsorship: false }),
    });
    expect(result.signals.find((s) => s.key === 'work_authorization')!.score).toBe(100);
  });
});

describe('fairness', () => {
  it('reads no protected characteristic', () => {
    const withDemographics = makeProfile();
    withDemographics.applicationProfile = {
      ...withDemographics.applicationProfile,
      dateOfBirth: '1990-01-01',
      pronouns: 'she/her',
      diversityInfo: 'Some disability information',
    };

    const baseline = matchJob({ job: makeJob(), resume, profile: makeProfile() });
    const withDemo = matchJob({ job: makeJob(), resume, profile: withDemographics });

    // Identical scoring: those fields are not inputs to any signal.
    expect(withDemo.score).toBe(baseline.score);
    expect(JSON.stringify(withDemo.signals)).toBe(JSON.stringify(baseline.signals));
  });
});

describe('resume recommendation', () => {
  it('recommends the version with the most overlapping skills', () => {
    const result = matchJob({
      job: makeJob(),
      resume,
      profile: makeProfile(),
      resumeVersions: [
        { id: 'v-frontend', name: 'Frontend', plainText: 'React Vue CSS HTML design systems' },
        { id: 'v-backend', name: 'Backend', plainText: 'PostgreSQL Kafka Kubernetes Terraform TypeScript Go' },
      ],
    });
    expect(result.recommendedResumeVersionId).toBe('v-backend');
  });

  it('returns null when there are no versions to choose from', () => {
    expect(run({ resumeVersions: [] }).recommendedResumeVersionId).toBeNull();
  });
});
