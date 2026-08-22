import { describe, expect, it } from 'vitest';
import { analyzeResume, extractJobKeywords, groupFindings, type AtsContext } from '@/lib/resume/ats';
import { normalizeResumeText } from '@/lib/resume/normalize';
import { emptyResume } from '@/lib/resume/types';
import { STRONG_RESUME, WEAK_RESUME, SAMPLE_JOB_DESCRIPTION } from './fixtures/resumes';

const strong = normalizeResumeText(STRONG_RESUME).resume;
const weak = normalizeResumeText(WEAK_RESUME).resume;

const CTX: AtsContext = {
  targetTitles: ['Senior Backend Engineer', 'Staff Engineer'],
  preferredLocations: ['Bengaluru'],
  careerLevel: 'senior',
  yearsOfExperience: 7,
  profileSkills: ['TypeScript', 'PostgreSQL', 'Kafka', 'Kubernetes'],
};

describe('determinism and framing', () => {
  it('produces identical output for identical input', () => {
    expect(JSON.stringify(analyzeResume(strong, CTX))).toBe(JSON.stringify(analyzeResume(strong, CTX)));
  });

  it('always labels the score as a heuristic', () => {
    const report = analyzeResume(strong, CTX);
    expect(report.scoreKind).toBe('heuristic');
    expect(report.scoreExplanation).toMatch(/heuristic/i);
    expect(report.scoreExplanation).toMatch(/not the score/i);
  });

  it('scores within 0-100 and weights every signal', () => {
    for (const resume of [strong, weak, emptyResume()]) {
      const report = analyzeResume(resume, CTX);
      expect(report.overallScore).toBeGreaterThanOrEqual(0);
      expect(report.overallScore).toBeLessThanOrEqual(100);
      expect(report.signals).toHaveLength(14);
      for (const s of report.signals) {
        expect(s.score, s.key).toBeGreaterThanOrEqual(0);
        expect(s.score, s.key).toBeLessThanOrEqual(100);
        expect(s.weight, s.key).toBeGreaterThan(0);
        expect(s.explanation.length, s.key).toBeGreaterThan(0);
      }
    }
  });

  it('scores an empty resume very low without crashing', () => {
    const report = analyzeResume(emptyResume(), CTX);
    expect(report.overallScore).toBeLessThan(30);
    expect(report.findings.length).toBeGreaterThan(4);
  });
});

describe('relative scoring', () => {
  const strongReport = analyzeResume(strong, CTX);
  const weakReport = analyzeResume(weak, CTX);

  it('rates the well-formed resume clearly higher', () => {
    expect(strongReport.overallScore).toBeGreaterThan(weakReport.overallScore + 20);
  });

  it('rates contact completeness higher when a phone is present', () => {
    const s = strongReport.signals.find((x) => x.key === 'contact_completeness')!;
    const w = weakReport.signals.find((x) => x.key === 'contact_completeness')!;
    expect(s.score).toBeGreaterThan(w.score);
  });

  it('rewards quantified bullets', () => {
    const s = strongReport.signals.find((x) => x.key === 'measurable_achievements')!;
    const w = weakReport.signals.find((x) => x.key === 'measurable_achievements')!;
    expect(s.score).toBeGreaterThan(60);
    expect(w.score).toBe(0);
  });

  it('penalises weak openings and vague superlatives', () => {
    const s = strongReport.signals.find((x) => x.key === 'action_verbs')!;
    const w = weakReport.signals.find((x) => x.key === 'action_verbs')!;
    expect(s.score).toBeGreaterThan(w.score);
  });
});

describe('specific findings', () => {
  const weakReport = analyzeResume(weak, CTX);

  it('flags a missing phone number as high priority', () => {
    const finding = weakReport.findings.find((f) => f.id === 'contact_phone');
    expect(finding?.priority).toBe('high');
  });

  it('flags weak bullet openings with the offending phrase', () => {
    const weakVerb = weakReport.findings.filter((f) => f.category === 'language');
    expect(weakVerb.length).toBeGreaterThan(0);
    const titles = weakVerb.map((f) => f.title).join(' ');
    expect(titles).toMatch(/responsible for|worked on|involved in|assisted with/i);
  });

  it('flags vague superlatives as unsupported claims', () => {
    expect(weakReport.unsupportedClaims.length).toBeGreaterThan(0);
    const text = weakReport.unsupportedClaims.map((c) => c.text).join(' ');
    expect(text).toMatch(/significantly improving|results-driven|self-starter|team player/i);
  });

  it('reports bullets that carry no measurable outcome', () => {
    expect(weakReport.bulletsMissingMetrics.length).toBeGreaterThan(0);
    expect(weakReport.bulletsMissingMetrics[0]!.path).toMatch(/^experience\[\d+\]\.bullets\[\d+\]$/);
  });

  it('never tells the user to invent a number', () => {
    const impact = weakReport.findings.find((f) => f.id === 'impact_few_metrics');
    expect(impact?.detail).toMatch(/will not invent/i);
  });

  it('flags inconsistent date formats', () => {
    // The weak fixture mixes "2021 - Present" with "Jul'19 - Feb 2021".
    const report = analyzeResume(weak, CTX);
    const ids = report.findings.map((f) => f.id);
    expect(ids).toContain('format_date_inconsistent');
  });

  it('reports ambiguous dates with the role they belong to', () => {
    expect(weakReport.ambiguousDates.length).toBeGreaterThan(0);
  });

  it('groups findings by priority', () => {
    const grouped = groupFindings(weakReport);
    expect(grouped.high.length + grouped.medium.length + grouped.low.length).toBe(weakReport.findings.length);
    expect(grouped.high.every((f) => f.priority === 'high')).toBe(true);
  });

  it('orders findings with high priority first', () => {
    const priorities = weakReport.findings.map((f) => f.priority);
    const firstMedium = priorities.indexOf('medium');
    const lastHigh = priorities.lastIndexOf('high');
    if (firstMedium >= 0 && lastHigh >= 0) expect(lastHigh).toBeLessThan(firstMedium);
  });
});

describe('keyword coverage against a job description', () => {
  it('extracts significant terms and skips stopwords', () => {
    const keywords = extractJobKeywords(SAMPLE_JOB_DESCRIPTION, 30);
    expect(keywords.join(' ')).toMatch(/postgresql/i);
    expect(keywords.join(' ')).toMatch(/kubernetes/i);
    expect(keywords).not.toContain('the');
    expect(keywords).not.toContain('experience');
    expect(keywords).not.toContain('requirements');
  });

  it('matches terms the resume genuinely contains', () => {
    const report = analyzeResume(strong, { ...CTX, jobDescription: SAMPLE_JOB_DESCRIPTION });
    const matched = report.keywords.matched.join(' ').toLowerCase();
    expect(matched).toMatch(/postgresql/);
    expect(matched).toMatch(/kubernetes/);
    expect(matched).toMatch(/terraform/);
  });

  it('reports terms the resume is missing, without adding them', () => {
    const report = analyzeResume(weak, { ...CTX, jobDescription: SAMPLE_JOB_DESCRIPTION });
    expect(report.keywords.missing.length).toBeGreaterThan(0);
    const finding = report.findings.find((f) => f.id === 'keyword_missing_from_job');
    expect(finding?.detail).toMatch(/only the ones you genuinely have/i);
  });

  it('scores keyword coverage higher for the matching resume', () => {
    const s = analyzeResume(strong, { ...CTX, jobDescription: SAMPLE_JOB_DESCRIPTION });
    const w = analyzeResume(weak, { ...CTX, jobDescription: SAMPLE_JOB_DESCRIPTION });
    const sk = s.signals.find((x) => x.key === 'keyword_coverage')!.score;
    const wk = w.signals.find((x) => x.key === 'keyword_coverage')!.score;
    expect(sk).toBeGreaterThan(wk);
  });

  it('explains itself honestly when there is nothing to compare against', () => {
    const report = analyzeResume(strong, {});
    const signal = report.signals.find((x) => x.key === 'keyword_coverage')!;
    expect(signal.explanation).toMatch(/no reference keywords/i);
    expect(signal.score).toBe(50);
  });

  it('detects keyword stuffing', () => {
    const stuffed = emptyResume();
    stuffed.contact.fullName = 'Test User';
    stuffed.summary = 'Kubernetes '.repeat(30);
    const report = analyzeResume(stuffed, CTX);
    expect(report.keywords.overused.some((o) => o.term === 'kubernetes')).toBe(true);
  });
});

describe('alignment signals', () => {
  it('scores title relevance from the user’s own target titles', () => {
    const report = analyzeResume(strong, CTX);
    const signal = report.signals.find((x) => x.key === 'title_relevance')!;
    expect(signal.score).toBeGreaterThan(70);
  });

  it('flags internal level codes as unclear titles', () => {
    const resume = emptyResume();
    resume.experience = [
      {
        id: '', title: 'SDE 2', company: 'Acme', location: '', startDate: '2020', endDate: '2023',
        current: false, summary: '', bullets: [], technologies: [], source: 'parsed',
      },
    ];
    const report = analyzeResume(resume, CTX);
    expect(report.unclearTitles).toContain('SDE 2');
  });

  it('scores location alignment against preferred locations', () => {
    const aligned = analyzeResume(strong, CTX).signals.find((x) => x.key === 'location_alignment')!;
    const misaligned = analyzeResume(strong, { ...CTX, preferredLocations: ['Berlin'] }).signals.find(
      (x) => x.key === 'location_alignment',
    )!;
    expect(aligned.score).toBe(100);
    expect(misaligned.score).toBeLessThan(100);
  });

  it('treats openness to remote work as non-restrictive', () => {
    const signal = analyzeResume(strong, { ...CTX, preferredLocations: ['Remote (India)'] }).signals.find(
      (x) => x.key === 'location_alignment',
    )!;
    expect(signal.score).toBe(100);
  });

  it('scores seniority from title terms', () => {
    const senior = analyzeResume(strong, CTX).signals.find((x) => x.key === 'seniority_alignment')!;
    expect(senior.score).toBe(100);

    const asExecutive = analyzeResume(strong, { ...CTX, careerLevel: 'executive' }).signals.find(
      (x) => x.key === 'seniority_alignment',
    )!;
    expect(asExecutive.score).toBeLessThan(100);
  });

  it('says so plainly when it has no basis to score', () => {
    const report = analyzeResume(strong, {});
    const seniority = report.signals.find((x) => x.key === 'seniority_alignment')!;
    expect(seniority.explanation).toMatch(/add a career level/i);
  });
});

describe('parsing compatibility', () => {
  it('rates a cleanly-parsed resume highly', () => {
    const signal = analyzeResume(strong, CTX).signals.find((x) => x.key === 'parsing_compatibility')!;
    expect(signal.score).toBeGreaterThan(75);
  });

  it('detects words running together, a sign of a damaged text layer', () => {
    const resume = emptyResume();
    resume.contact.fullName = 'Test User';
    resume.contact.email = 'a@b.com';
    resume.summary = Array.from({ length: 20 }, (_, i) => `wordRunTogether${i}Here`).join(' ');
    const report = analyzeResume(resume, CTX);
    expect(report.findings.map((f) => f.id)).toContain('parse_glued_words');
  });

  it('flags roles missing a title or company after parsing', () => {
    const resume = emptyResume();
    resume.experience = [
      {
        id: '', title: '', company: '', location: '', startDate: '2020', endDate: '2021',
        current: false, summary: '', bullets: [{ id: 'b', text: 'Did a thing', source: 'parsed' }],
        technologies: [], source: 'parsed',
      },
    ];
    const report = analyzeResume(resume, CTX);
    expect(report.findings.map((f) => f.id)).toContain('parse_incomplete_roles');
  });
});

describe('report statistics', () => {
  it('reports counts a user can sanity-check', () => {
    const report = analyzeResume(strong, CTX);
    expect(report.stats.roleCount).toBe(strong.experience.length);
    expect(report.stats.bulletCount).toBeGreaterThan(5);
    expect(report.stats.wordCount).toBeGreaterThan(100);
    expect(report.stats.estimatedPages).toBeGreaterThanOrEqual(1);
    expect(report.stats.skillCount).toBeGreaterThan(5);
  });

  it('lists strengths only for genuinely strong signals', () => {
    const report = analyzeResume(strong, CTX);
    expect(report.strengths.length).toBeGreaterThan(0);
    for (const s of report.strengths) expect(s).toContain(':');
  });
});
