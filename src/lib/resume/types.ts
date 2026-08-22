/**
 * The canonical structured resume.
 *
 * This is the single representation every other module works against: the ATS
 * scorer reads it, the suggestion engine edits it, the PDF renderer draws it,
 * and the matching engine compares it to a job description.
 *
 * Provenance is first-class. Every bullet and every field carries a `source`
 * telling you where the text came from:
 *
 *   'parsed'     extracted from the uploaded document
 *   'profile'    taken from data the user typed into their profile
 *   'user'       written or edited by the user in the editor
 *   'suggested'  produced by a suggestion the user accepted
 *
 * Nothing may be marked 'parsed' unless it genuinely appeared in the upload.
 * This is what makes "never fabricate experience" checkable rather than
 * aspirational — see `assertNoFabrication`.
 */
import { z } from 'zod';

export const CONTENT_SOURCES = ['parsed', 'profile', 'user', 'suggested'] as const;
export type ContentSource = (typeof CONTENT_SOURCES)[number];

const text = (max: number) => z.string().trim().max(max);

export const contactSchema = z.object({
  fullName: text(160).default(''),
  headline: text(200).default(''),
  email: text(254).default(''),
  phone: text(40).default(''),
  location: text(160).default(''),
  linkedinUrl: text(400).default(''),
  githubUrl: text(400).default(''),
  portfolioUrl: text(400).default(''),
  websiteUrl: text(400).default(''),
});

export const bulletSchema = z.object({
  id: z.string().max(64).default(''),
  text: text(1000).default(''),
  source: z.enum(CONTENT_SOURCES).default('parsed'),
});

export const experienceSchema = z.object({
  id: z.string().max(64).default(''),
  title: text(200).default(''),
  company: text(200).default(''),
  location: text(160).default(''),
  startDate: text(40).default(''),
  endDate: text(40).default(''),
  /** True when `endDate` is absent because the role is ongoing. */
  current: z.boolean().default(false),
  summary: text(1000).default(''),
  bullets: z.array(bulletSchema).max(30).default([]),
  technologies: z.array(text(80)).max(60).default([]),
  source: z.enum(CONTENT_SOURCES).default('parsed'),
});

export const projectSchema = z.object({
  id: z.string().max(64).default(''),
  name: text(200).default(''),
  role: text(160).default(''),
  url: text(400).default(''),
  startDate: text(40).default(''),
  endDate: text(40).default(''),
  description: text(1500).default(''),
  bullets: z.array(bulletSchema).max(20).default([]),
  technologies: z.array(text(80)).max(60).default([]),
  source: z.enum(CONTENT_SOURCES).default('parsed'),
});

export const educationSchema = z.object({
  id: z.string().max(64).default(''),
  degree: text(200).default(''),
  field: text(200).default(''),
  institution: text(200).default(''),
  location: text(160).default(''),
  startDate: text(40).default(''),
  endDate: text(40).default(''),
  grade: text(80).default(''),
  details: z.array(text(400)).max(10).default([]),
  source: z.enum(CONTENT_SOURCES).default('parsed'),
});

export const certificationSchema = z.object({
  id: z.string().max(64).default(''),
  name: text(200).default(''),
  issuer: text(200).default(''),
  date: text(40).default(''),
  credentialId: text(120).default(''),
  url: text(400).default(''),
  source: z.enum(CONTENT_SOURCES).default('parsed'),
});

export const skillGroupSchema = z.object({
  id: z.string().max(64).default(''),
  category: text(120).default(''),
  skills: z.array(text(80)).max(80).default([]),
  source: z.enum(CONTENT_SOURCES).default('parsed'),
});

export const simpleEntrySchema = z.object({
  id: z.string().max(64).default(''),
  title: text(240).default(''),
  detail: text(1000).default(''),
  date: text(40).default(''),
  source: z.enum(CONTENT_SOURCES).default('parsed'),
});

export const linkSchema = z.object({
  id: z.string().max(64).default(''),
  label: text(120).default(''),
  url: text(400).default(''),
  source: z.enum(CONTENT_SOURCES).default('parsed'),
});

export const structuredResumeSchema = z.object({
  contact: contactSchema.prefault({}),
  summary: text(3000).default(''),
  summarySource: z.enum(CONTENT_SOURCES).default('parsed'),
  experience: z.array(experienceSchema).max(40).default([]),
  projects: z.array(projectSchema).max(40).default([]),
  education: z.array(educationSchema).max(20).default([]),
  skills: z.array(skillGroupSchema).max(20).default([]),
  certifications: z.array(certificationSchema).max(40).default([]),
  awards: z.array(simpleEntrySchema).max(30).default([]),
  publications: z.array(simpleEntrySchema).max(30).default([]),
  volunteer: z.array(simpleEntrySchema).max(30).default([]),
  languages: z.array(text(80)).max(30).default([]),
  links: z.array(linkSchema).max(20).default([]),
  additional: text(3000).default(''),
  /** Sections the parser could not confidently classify, kept verbatim. */
  unparsedSections: z
    .array(z.object({ heading: text(160).default(''), body: text(8000).default('') }))
    .max(20)
    .default([]),
});

export type StructuredResume = z.infer<typeof structuredResumeSchema>;
export type ResumeContact = z.infer<typeof contactSchema>;
export type ResumeExperience = z.infer<typeof experienceSchema>;
export type ResumeProject = z.infer<typeof projectSchema>;
export type ResumeEducation = z.infer<typeof educationSchema>;
export type ResumeCertification = z.infer<typeof certificationSchema>;
export type ResumeSkillGroup = z.infer<typeof skillGroupSchema>;
export type ResumeBullet = z.infer<typeof bulletSchema>;

export function emptyResume(): StructuredResume {
  return structuredResumeSchema.parse({});
}

/** Parse whatever is stored in the database, never throwing. */
export function parseStructuredResume(value: unknown): StructuredResume {
  const result = structuredResumeSchema.safeParse(value ?? {});
  return result.success ? result.data : emptyResume();
}

/* --------------------------------------------------------------- helpers -- */

/** Every bullet across experience and projects, with its owner for context. */
export function allBullets(
  resume: StructuredResume,
): { bullet: ResumeBullet; owner: string; path: string }[] {
  const out: { bullet: ResumeBullet; owner: string; path: string }[] = [];
  resume.experience.forEach((exp, i) => {
    exp.bullets.forEach((b, j) => {
      out.push({ bullet: b, owner: `${exp.title} at ${exp.company}`.trim(), path: `experience[${i}].bullets[${j}]` });
    });
  });
  resume.projects.forEach((proj, i) => {
    proj.bullets.forEach((b, j) => {
      out.push({ bullet: b, owner: proj.name, path: `projects[${i}].bullets[${j}]` });
    });
  });
  return out;
}

/** Flattened, de-duplicated skill list from every skill group. */
export function allSkills(resume: StructuredResume): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of resume.skills) {
    for (const s of group.skills) {
      const key = s.toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(s.trim());
    }
  }
  return out;
}

/** Every technology mentioned anywhere: skills, roles and projects. */
export function allTechnologies(resume: StructuredResume): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (values: string[]) => {
    for (const v of values) {
      const key = v.toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(v.trim());
    }
  };
  add(allSkills(resume));
  for (const exp of resume.experience) add(exp.technologies);
  for (const proj of resume.projects) add(proj.technologies);
  return out;
}

/** Render the resume to plain text, for hashing, search and AI grounding. */
export function resumeToPlainText(resume: StructuredResume): string {
  const lines: string[] = [];
  const c = resume.contact;

  if (c.fullName) lines.push(c.fullName);
  if (c.headline) lines.push(c.headline);
  const contactBits = [c.email, c.phone, c.location].filter(Boolean);
  if (contactBits.length) lines.push(contactBits.join(' | '));
  const linkBits = [c.linkedinUrl, c.githubUrl, c.portfolioUrl, c.websiteUrl].filter(Boolean);
  if (linkBits.length) lines.push(linkBits.join(' | '));

  if (resume.summary) {
    lines.push('', 'SUMMARY', resume.summary);
  }

  if (resume.experience.length) {
    lines.push('', 'EXPERIENCE');
    for (const exp of resume.experience) {
      const dates = [exp.startDate, exp.current ? 'Present' : exp.endDate].filter(Boolean).join(' – ');
      lines.push([exp.title, exp.company].filter(Boolean).join(' — '));
      const meta = [exp.location, dates].filter(Boolean).join(' | ');
      if (meta) lines.push(meta);
      if (exp.summary) lines.push(exp.summary);
      for (const b of exp.bullets) if (b.text) lines.push(`• ${b.text}`);
      if (exp.technologies.length) lines.push(`Technologies: ${exp.technologies.join(', ')}`);
      lines.push('');
    }
  }

  if (resume.projects.length) {
    lines.push('PROJECTS');
    for (const p of resume.projects) {
      lines.push([p.name, p.role].filter(Boolean).join(' — '));
      if (p.description) lines.push(p.description);
      for (const b of p.bullets) if (b.text) lines.push(`• ${b.text}`);
      if (p.technologies.length) lines.push(`Technologies: ${p.technologies.join(', ')}`);
      lines.push('');
    }
  }

  if (resume.skills.length) {
    lines.push('SKILLS');
    for (const g of resume.skills) {
      lines.push(g.category ? `${g.category}: ${g.skills.join(', ')}` : g.skills.join(', '));
    }
    lines.push('');
  }

  if (resume.education.length) {
    lines.push('EDUCATION');
    for (const e of resume.education) {
      lines.push([e.degree, e.field].filter(Boolean).join(', '));
      lines.push([e.institution, [e.startDate, e.endDate].filter(Boolean).join(' – ')].filter(Boolean).join(' | '));
      if (e.grade) lines.push(e.grade);
      for (const d of e.details) lines.push(`• ${d}`);
      lines.push('');
    }
  }

  const simple: [string, { title: string; detail: string; date: string }[]][] = [
    ['CERTIFICATIONS', resume.certifications.map((c2) => ({ title: c2.name, detail: c2.issuer, date: c2.date }))],
    ['AWARDS', resume.awards.map((a) => ({ title: a.title, detail: a.detail, date: a.date }))],
    ['PUBLICATIONS', resume.publications.map((p) => ({ title: p.title, detail: p.detail, date: p.date }))],
    ['VOLUNTEER', resume.volunteer.map((v) => ({ title: v.title, detail: v.detail, date: v.date }))],
  ];
  for (const [heading, entries] of simple) {
    if (!entries.length) continue;
    lines.push(heading);
    for (const e of entries) {
      lines.push([e.title, e.detail, e.date].filter(Boolean).join(' — '));
    }
    lines.push('');
  }

  if (resume.languages.length) lines.push('LANGUAGES', resume.languages.join(', '), '');
  if (resume.links.length) {
    lines.push('LINKS');
    for (const l of resume.links) lines.push([l.label, l.url].filter(Boolean).join(': '));
    lines.push('');
  }
  if (resume.additional) lines.push('ADDITIONAL', resume.additional, '');

  for (const s of resume.unparsedSections) {
    if (!s.heading && !s.body) continue;
    lines.push(s.heading.toUpperCase(), s.body, '');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ------------------------------------------------------- fabrication guard */

export interface FabricationFinding {
  path: string;
  text: string;
  reason: string;
  /** The specific tokens that are not supported by any source material. */
  unsupported: string[];
}

/** Numbers and quantified claims that must never be introduced by the system. */
const METRIC_PATTERN =
  /(\d+(?:\.\d+)?\s?%|\d+(?:\.\d+)?\s?x\b|\$\s?\d[\d,.]*|₹\s?\d[\d,.]*|\b\d[\d,]{2,}\b|\b\d+(?:\.\d+)?\s?(?:k|m|mn|bn|lakh|lakhs|crore|crores)\b|\b\d+\s*(?:users|customers|clients|requests|transactions|engineers|developers|people|members|hours|days|weeks|months)\b)/gi;

/** Extract quantified claims from a piece of text. */
export function extractMetrics(value: string): string[] {
  const matches = (value ?? '').match(METRIC_PATTERN) ?? [];
  return [...new Set(matches.map((m) => m.trim().toLowerCase()))];
}

/**
 * Verify that `candidate` introduces no quantified claim absent from
 * `sourceCorpus` (the original resume text plus the user's profile).
 *
 * This is the enforcement point for the product's central promise. It is
 * intentionally conservative: a number the system cannot find in the user's own
 * material is treated as fabricated, even if a model produced it confidently.
 */
export function findFabricatedMetrics(candidate: string, sourceCorpus: string): string[] {
  const corpus = (sourceCorpus ?? '').toLowerCase();

  return extractMetrics(candidate).filter((metric) => {
    if (corpus.includes(metric)) return false;

    const digits = metric.replace(/[^0-9.]/g, '');
    if (!digits) return true;

    // Accept the same figure written another way, but only in a form that
    // carries the same MEANING. Matching a bare number would be far too loose:
    // "99%" must not be considered grounded by the "p99" in "p99 latency".
    const escaped = digits.replace(/\./g, '\\.');
    const withSeparators = `${escaped}|${digits.replace(/\B(?=(\d{3})+(?!\d))/g, '[,\\s]?')}`;
    let alternates: RegExp;

    if (/%/.test(metric)) {
      alternates = new RegExp(`(^|[^0-9.])(${escaped})\\s*(%|percent|per\\s?cent)`, 'i');
    } else if (/\bx$/.test(metric) || /\dx\b/.test(metric)) {
      alternates = new RegExp(`(^|[^0-9.])(${escaped})\\s*(x\\b|times|fold)`, 'i');
    } else {
      // Counts and currency: the number itself must appear as its own token,
      // with or without thousands separators.
      alternates = new RegExp(`(^|[^0-9.])(${withSeparators})([^0-9.]|$)`, 'i');
    }

    return !alternates.test(corpus);
  });
}

/**
 * Assert that a rewritten bullet is grounded in the user's own material.
 * Returns a finding when it is not, so the caller can reject the suggestion
 * rather than surface it.
 */
export function checkGrounding(
  candidate: string,
  sourceCorpus: string,
  path: string,
): FabricationFinding | null {
  const unsupported = findFabricatedMetrics(candidate, sourceCorpus);
  if (unsupported.length === 0) return null;
  return {
    path,
    text: candidate,
    reason:
      'This rewrite introduces figures that do not appear in your resume or profile. ' +
      'CareerPilot360 will not add numbers you have not provided.',
    unsupported,
  };
}

/** Scan a whole resume for unsupported metrics in non-parsed content. */
export function assertNoFabrication(resume: StructuredResume, sourceCorpus: string): FabricationFinding[] {
  const findings: FabricationFinding[] = [];
  for (const { bullet, path } of allBullets(resume)) {
    // Text the user typed themselves is theirs to assert; only system-authored
    // content is policed.
    if (bullet.source !== 'suggested') continue;
    const finding = checkGrounding(bullet.text, sourceCorpus, path);
    if (finding) findings.push(finding);
  }
  if (resume.summarySource === 'suggested') {
    const finding = checkGrounding(resume.summary, sourceCorpus, 'summary');
    if (finding) findings.push(finding);
  }
  return findings;
}
