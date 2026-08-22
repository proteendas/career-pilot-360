import { describe, expect, it } from 'vitest';
import { normalizeResumeText, enrichContactFromProfile } from '@/lib/resume/normalize';
import { normalizeWhitespace } from '@/lib/resume/parse';
import { allSkills, allTechnologies, resumeToPlainText, findFabricatedMetrics, extractMetrics, checkGrounding, assertNoFabrication, emptyResume } from '@/lib/resume/types';
import { STRONG_RESUME, WEAK_RESUME, UNSTRUCTURED_RESUME } from './fixtures/resumes';

describe('normalizeWhitespace', () => {
  it('normalises bullet glyphs to a single form', () => {
    const out = normalizeWhitespace('‣ one\n▪ two\n● three\n* four');
    expect(out.split('\n').every((l) => l.startsWith('• '))).toBe(true);
  });

  it('expands PDF ligatures', () => {
    expect(normalizeWhitespace('eﬃcient workﬂow')).toBe('efficient workflow');
  });

  it('collapses exotic spaces but keeps line structure', () => {
    expect(normalizeWhitespace('a  b\nc')).toBe('a b\nc');
  });
});

describe('normalizeResumeText on a well-formed resume', () => {
  const { resume, warnings, detectedSections } = normalizeResumeText(STRONG_RESUME);

  it('extracts contact details', () => {
    expect(resume.contact.fullName).toBe('Priya Sharma');
    expect(resume.contact.email).toBe('priya.sharma@example.com');
    expect(resume.contact.phone).toContain('98765');
    expect(resume.contact.location).toContain('Bengaluru');
    expect(resume.contact.linkedinUrl).toContain('linkedin.com');
    expect(resume.contact.githubUrl).toContain('github.com');
  });

  it('detects the expected sections', () => {
    for (const s of ['summary', 'experience', 'skills', 'education', 'certifications', 'projects', 'awards']) {
      expect(detectedSections, s).toContain(s);
    }
  });

  it('extracts the summary as prose', () => {
    expect(resume.summary).toContain('Backend engineer with seven years');
    expect(resume.summary).not.toContain('\n');
  });

  it('extracts both roles with dates', () => {
    expect(resume.experience.length).toBeGreaterThanOrEqual(2);
    const current = resume.experience.find((e) => e.current);
    expect(current).toBeDefined();
    expect(current?.startDate).toMatch(/Mar 2021/i);

    const past = resume.experience.find((e) => e.endDate?.includes('2021'));
    expect(past?.startDate).toMatch(/Jul 2019/i);
  });

  it('attributes bullets to the right role', () => {
    const first = resume.experience[0]!;
    expect(first.bullets.length).toBeGreaterThanOrEqual(4);
    expect(first.bullets.map((b) => b.text).join(' ')).toContain('2,400 transactions');
    expect(first.bullets.every((b) => b.source === 'parsed')).toBe(true);
  });

  it('captures per-role technologies', () => {
    expect(resume.experience[0]!.technologies).toContain('Kubernetes');
    expect(resume.experience[0]!.technologies).not.toContain('');
  });

  it('groups skills by their category label', () => {
    const categories = resume.skills.map((g) => g.category);
    expect(categories).toContain('Languages');
    expect(categories).toContain('Infrastructure');
    const skills = allSkills(resume);
    expect(skills).toContain('TypeScript');
    expect(skills).toContain('Terraform');
  });

  it('extracts education with a degree and grade', () => {
    const edu = resume.education[0]!;
    expect(edu.degree).toMatch(/B\.E/i);
    expect(edu.institution).toContain('Anna University');
    expect(edu.grade).toMatch(/8\.4/);
  });

  it('extracts certifications and awards', () => {
    expect(resume.certifications[0]!.name).toContain('AWS Certified');
    expect(resume.certifications[0]!.date).toBe('2023');
    expect(resume.awards[0]!.title).toContain('Engineering Excellence');
  });

  it('extracts projects with a URL', () => {
    const project = resume.projects[0]!;
    expect(project.name).toContain('Ledger Reconciler');
    expect(project.url).toContain('github.com');
  });

  it('produces no missing-field warnings', () => {
    expect(warnings.filter((w) => /No (email|phone)/.test(w))).toHaveLength(0);
  });

  it('collects every technology across sections', () => {
    const tech = allTechnologies(resume).map((t) => t.toLowerCase());
    expect(tech).toContain('kafka');
    expect(tech).toContain('terraform');
  });

  it('round-trips to plain text containing the key facts', () => {
    const plain = resumeToPlainText(resume);
    expect(plain).toContain('Priya Sharma');
    expect(plain).toContain('Northwind Payments');
    expect(plain).toContain('2,400 transactions');
    expect(plain).toContain('EDUCATION');
  });
});

describe('normalizeResumeText on a weak resume', () => {
  const { resume, warnings } = normalizeResumeText(WEAK_RESUME);

  it('still extracts what is present', () => {
    expect(resume.contact.fullName).toBe('Priya Sharma');
    expect(resume.contact.email).toBe('priya.sharma@example.com');
    expect(resume.experience.length).toBeGreaterThanOrEqual(2);
  });

  it('warns about the missing phone number', () => {
    expect(warnings.join(' ')).toMatch(/phone/i);
  });

  it('recognises "Career objective" as the summary section', () => {
    expect(resume.summary).toContain('Results-driven');
  });

  it('does not invent skills that are absent', () => {
    expect(allSkills(resume)).toHaveLength(0);
  });
});

describe('normalizeResumeText on unstructured text', () => {
  const { resume, warnings } = normalizeResumeText(UNSTRUCTURED_RESUME);

  it('preserves the content verbatim rather than dropping it', () => {
    expect(resume.unparsedSections.length).toBeGreaterThan(0);
    expect(resume.unparsedSections[0]!.body).toContain('Anna University');
  });

  it('warns that no headings were recognised', () => {
    expect(warnings.join(' ')).toMatch(/No section headings/i);
  });

  it('still finds the contact details', () => {
    expect(resume.contact.email).toBe('priya.sharma@example.com');
  });
});

describe('enrichContactFromProfile', () => {
  it('fills only the gaps and reports what it filled', () => {
    const { resume } = normalizeResumeText(WEAK_RESUME);
    const { resume: enriched, filled } = enrichContactFromProfile(resume, {
      fullName: 'Someone Else',
      email: 'other@example.com',
      phone: '+91 90000 00000',
      city: 'Bengaluru',
      country: 'India',
      linkedinUrl: 'https://linkedin.com/in/priya',
    });

    // Existing values are never overwritten.
    expect(enriched.contact.fullName).toBe('Priya Sharma');
    expect(enriched.contact.email).toBe('priya.sharma@example.com');
    // Gaps are filled from the user's own profile.
    expect(enriched.contact.phone).toBe('+91 90000 00000');
    expect(enriched.contact.location).toBe('Bengaluru, India');
    expect(filled).toContain('phone');
    expect(filled).toContain('location');
    expect(filled).not.toContain('email');
  });
});

describe('fabrication guard', () => {
  const corpus = 'Reduced p99 latency from 840 ms to 210 ms. Mentored 4 engineers. Processes 2,400 transactions.';

  it('extracts quantified claims from text', () => {
    const metrics = extractMetrics('Improved throughput by 40% for 12,000 users and saved $5,000');
    expect(metrics.join(' ')).toMatch(/40%/);
    expect(metrics.join(' ')).toMatch(/12,000|12,000 users/);
  });

  it('accepts a rewrite that adds no new numbers', () => {
    expect(findFabricatedMetrics('Rewrote the settlement query path', corpus)).toEqual([]);
  });

  it('accepts a rewrite reusing a number already present', () => {
    expect(findFabricatedMetrics('Mentored 4 engineers through on-call', corpus)).toEqual([]);
  });

  it('rejects an invented percentage', () => {
    const bad = findFabricatedMetrics('Improved performance by 40%', corpus);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.join(' ')).toContain('40%');
  });

  it('rejects invented user counts, revenue and team size', () => {
    for (const claim of [
      'Served 50,000 users daily',
      'Generated $1,200,000 in revenue',
      'Led a team of 25 engineers',
      'Cut costs by 3x',
    ]) {
      expect(findFabricatedMetrics(claim, corpus).length, claim).toBeGreaterThan(0);
    }
  });

  it('tolerates the same figure written differently', () => {
    // "840" appears in the corpus, so referencing it is grounded.
    expect(findFabricatedMetrics('Brought 840 ms down substantially', corpus)).toEqual([]);
  });

  it('returns a finding with a user-facing reason', () => {
    const finding = checkGrounding('Improved conversion by 22%', corpus, 'experience[0].bullets[0]');
    expect(finding).not.toBeNull();
    expect(finding?.reason).toMatch(/will not add numbers/i);
    expect(finding?.unsupported.join(' ')).toContain('22%');
  });

  it('polices only system-authored content, not the user’s own words', () => {
    const resume = emptyResume();
    resume.experience = [
      {
        id: 'e0',
        title: 'Engineer',
        company: 'Acme',
        location: '',
        startDate: '2020',
        endDate: '',
        current: true,
        summary: '',
        technologies: [],
        source: 'parsed',
        bullets: [
          { id: 'b0', text: 'Improved throughput by 40%', source: 'user' },
          { id: 'b1', text: 'Improved latency by 99%', source: 'suggested' },
        ],
      },
    ];

    const findings = assertNoFabrication(resume, corpus);
    // The user's own claim is theirs to make; the suggested one is rejected.
    expect(findings).toHaveLength(1);
    expect(findings[0]!.text).toContain('99%');
  });
});
