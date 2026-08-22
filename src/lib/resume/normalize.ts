/**
 * Deterministic resume normalisation: extracted text → `StructuredResume`.
 *
 * This runs with no AI involvement, which matters for three reasons: it works
 * without a provider key, it is reproducible, and it cannot invent content.
 * Everything it produces is a span of the original text, so provenance is
 * always 'parsed'.
 *
 * Where it cannot classify a block confidently, the block is preserved verbatim
 * in `unparsedSections` rather than guessed at or dropped. Losing a user's
 * content silently would be worse than admitting the parser is unsure.
 */
import {
  emptyResume,
  type ResumeCertification,
  type ResumeEducation,
  type ResumeExperience,
  type ResumeProject,
  type StructuredResume,
} from './types';

/* ------------------------------------------------------------- section map */

type SectionKey =
  | 'summary'
  | 'experience'
  | 'projects'
  | 'education'
  | 'skills'
  | 'certifications'
  | 'awards'
  | 'publications'
  | 'volunteer'
  | 'languages'
  | 'links'
  | 'additional';

/**
 * Heading synonyms, ordered so more specific patterns win.
 * Kept explicit rather than fuzzy: a wrong section assignment is worse than an
 * unclassified one, because it silently moves the user's content.
 */
const SECTION_PATTERNS: [SectionKey, RegExp][] = [
  ['summary', /^(professional\s+)?(summary|profile|objective|about\s*me|career\s+(summary|objective)|overview)$/i],
  ['experience', /^(work\s+|professional\s+|employment\s+|relevant\s+)?(experience|history|employment)$/i],
  ['experience', /^(career|positions?|roles?)$/i],
  ['projects', /^(personal\s+|key\s+|selected\s+|academic\s+|side\s+)?projects?$/i],
  ['education', /^(education|academics?|academic\s+(background|qualifications?)|qualifications?)$/i],
  ['skills', /^(technical\s+|core\s+|key\s+|professional\s+)?(skills|competenc(?:y|ies)|expertise|technologies|tech\s+stack|toolkit)$/i],
  ['certifications', /^(certificat(?:e|ion)s?|licen[cs]es?|credentials?|courses?|training)$/i],
  ['awards', /^(awards?|honou?rs?|achievements?|recognitions?|accomplishments?)$/i],
  ['publications', /^(publications?|papers?|research|patents?|talks?|presentations?)$/i],
  ['volunteer', /^(volunteer(ing)?|community|social\s+work|extra[\s-]?curricular|activities)$/i],
  ['languages', /^languages?$/i],
  ['links', /^(links?|profiles?|social|online\s+presence|portfolio)$/i],
  ['additional', /^(additional\s+information|interests?|hobbies|misc(ellaneous)?|others?|personal\s+details?)$/i],
];

interface Block {
  key: SectionKey | null;
  heading: string;
  lines: string[];
}

/* ----------------------------------------------------------------- helpers */

const MONTHS =
  '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)';

/** A date range like "Jan 2020 – Present" or "2019-2022" or "03/2021 - 05/2023". */
const DATE_RANGE = new RegExp(
  `(${MONTHS}\\.?\\s*'?\\d{2,4}|\\d{1,2}[/.-]\\d{4}|\\d{4})\\s*(?:-|–|—|to|until|through)\\s*(present|current|now|ongoing|${MONTHS}\\.?\\s*'?\\d{2,4}|\\d{1,2}[/.-]\\d{4}|\\d{4})`,
  'i',
);

const SINGLE_DATE = new RegExp(`(${MONTHS}\\.?\\s*'?\\d{2,4}|\\d{1,2}[/.-]\\d{4}|(?:19|20)\\d{2})`, 'i');

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// Deliberately conservative: 8+ digits with common separators, so years and
// small numbers in prose are not mistaken for phone numbers.
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?){2,4}\d{2,4}/;
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s,;)]+|(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|ai|co|in|me|app)\/[^\s,;)]*)/i;

function isBulletLine(line: string): boolean {
  return /^[•▪●◦‣]\s*/.test(line.trim());
}

function stripBullet(line: string): string {
  return line.replace(/^[•▪●◦‣]\s*/, '').trim();
}

/**
 * Does this line look like a section heading?
 * Headings are short, contain no sentence punctuation, and are usually either
 * ALL CAPS or Title Case. We require a synonym match OR strong formatting.
 */
function detectHeading(line: string): { key: SectionKey | null; heading: string } | null {
  const raw = line.trim().replace(/[:\s]+$/, '');
  if (!raw || raw.length > 60) return null;
  if (isBulletLine(line)) return null;
  // A heading does not end a sentence or contain a date range.
  if (/[.!?]$/.test(raw) || DATE_RANGE.test(raw)) return null;

  const cleaned = raw.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z\s&/-]+$/, '').trim();
  if (!cleaned) return null;

  for (const [key, pattern] of SECTION_PATTERNS) {
    if (pattern.test(cleaned)) return { key, heading: raw };
  }

  // Unrecognised, but formatted like a heading: keep it as an unparsed section
  // so the content is never lost.
  //
  // The test is deliberately strict, and applies to the RAW line rather than
  // the cleaned one. An earlier version tested the cleaned string, which meant
  // "CGPA 8.4" became a heading once the digits were stripped — swallowing a
  // real value. A heading here must be all-caps letters with no digits.
  const isHeadingShaped = /^[A-Z][A-Z\s&/-]*$/.test(raw) && /[A-Z]{3,}/.test(raw);
  const wordCount = raw.split(/\s+/).length;
  if (isHeadingShaped && wordCount <= 5) return { key: null, heading: raw };

  return null;
}

/** Split the document into heading-delimited blocks. */
function splitIntoBlocks(lines: string[]): { header: string[]; blocks: Block[] } {
  const header: string[] = [];
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const line of lines) {
    const heading = detectHeading(line);
    if (heading) {
      current = { key: heading.key, heading: heading.heading, lines: [] };
      blocks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else header.push(line);
  }

  return { header, blocks };
}

/* --------------------------------------------------------------- contact -- */

/**
 * Contact lines are usually pipe- or bullet-delimited:
 *   "priya@example.com | +91 98765 43210 | Bengaluru, India"
 * Splitting into segments lets each field be identified independently, instead
 * of the whole line failing every single-purpose test.
 */
function contactSegments(headerLines: string[]): string[] {
  return headerLines
    .flatMap((l) => l.split(/\s*[|•·]\s*|\s{3,}/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseContact(headerLines: string[], wholeText: string) {
  const contact = emptyResume().contact;
  const joinedHeader = headerLines.join('\n');
  const segments = contactSegments(headerLines);

  contact.email = (joinedHeader.match(EMAIL_RE) ?? wholeText.match(EMAIL_RE) ?? [''])[0];

  // Look for a phone number only in the header region, and only in segments
  // that are not obviously dates.
  for (const segment of segments) {
    if (DATE_RANGE.test(segment)) continue;
    const digits = segment.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) continue;
    const m = segment.match(PHONE_RE);
    if (m) {
      contact.phone = m[0].trim();
      break;
    }
  }

  for (const line of headerLines) {
    const matches = line.match(new RegExp(URL_RE.source, 'gi')) ?? [];
    for (const raw of matches) {
      const url = raw.replace(/[.,;)]+$/, '');
      const lower = url.toLowerCase();
      if (lower.includes('linkedin.') && !contact.linkedinUrl) contact.linkedinUrl = url;
      else if (lower.includes('github.') && !contact.githubUrl) contact.githubUrl = url;
      else if (!contact.portfolioUrl && !lower.includes('@')) contact.portfolioUrl = url;
    }
  }

  // The name is normally the first substantive line that is not contact data.
  for (const line of headerLines) {
    const t = line.trim();
    if (!t || t.length > 60) continue;
    if (EMAIL_RE.test(t) || URL_RE.test(t)) continue;
    if (/\d{4}/.test(t)) continue;
    if (t.replace(/\D/g, '').length > 5) continue;
    const words = t.split(/\s+/);
    if (words.length >= 1 && words.length <= 5 && /^[A-Za-z]/.test(t)) {
      contact.fullName = t.replace(/[|,]+$/, '').trim();
      break;
    }
  }

  // A headline is a short role-ish line directly after the name.
  const nameIndex = headerLines.findIndex((l) => l.trim() === contact.fullName);
  if (nameIndex >= 0) {
    for (let i = nameIndex + 1; i < Math.min(nameIndex + 3, headerLines.length); i++) {
      const t = headerLines[i]!.trim();
      if (!t || t.length > 90) continue;
      if (EMAIL_RE.test(t) || URL_RE.test(t) || t.replace(/\D/g, '').length > 5) continue;
      contact.headline = t;
      break;
    }
  }

  // Location: a segment with a comma and effectively no digits.
  for (const segment of segments) {
    if (!segment || segment === contact.fullName || segment === contact.headline) continue;
    if (EMAIL_RE.test(segment) || URL_RE.test(segment)) continue;
    if (segment.replace(/\D/g, '').length > 6) continue;
    if (/,/.test(segment) && segment.length <= 60 && /^[A-Za-z]/.test(segment)) {
      contact.location = segment.trim();
      break;
    }
  }

  return contact;
}

/* ------------------------------------------------------------ experience -- */

function splitDateRange(line: string): { startDate: string; endDate: string; current: boolean } | null {
  const m = line.match(DATE_RANGE);
  if (!m) return null;
  const end = (m[3] ?? '').trim();
  const isCurrent = /^(present|current|now|ongoing)$/i.test(end);
  return {
    startDate: (m[1] ?? '').trim(),
    endDate: isCurrent ? '' : end,
    current: isCurrent,
  };
}

/**
 * Group experience lines into roles.
 * A new role starts at a line carrying a date range, or a non-bullet line that
 * follows bullets.
 */
function parseExperience(lines: string[]): ResumeExperience[] {
  const roles: ResumeExperience[] = [];
  const template = () => ({
    id: '',
    title: '',
    company: '',
    location: '',
    startDate: '',
    endDate: '',
    current: false,
    summary: '',
    bullets: [] as ResumeExperience['bullets'],
    technologies: [] as string[],
    source: 'parsed' as const,
  });

  let currentRole: ResumeExperience | null = null;
  let sawBullet = false;
  let headerLinesForRole: string[] = [];

  const flushHeader = () => {
    if (!currentRole) return;
    // Distribute the collected header lines across title / company / location.
    const parts = headerLinesForRole
      .flatMap((l) => l.split(/\s{2,}|\s+[|·•–—]\s+|,\s(?=[A-Z])/))
      .map((p) => p.trim())
      .filter((p) => p && !DATE_RANGE.test(p));

    if (!currentRole.title && parts[0]) currentRole.title = parts[0];
    if (!currentRole.company && parts[1]) currentRole.company = parts[1];
    if (!currentRole.location && parts[2]) currentRole.location = parts[2];
    headerLinesForRole = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const dates = splitDateRange(line);
    const bullet = isBulletLine(raw);
    const isTechLine = /^(tech(nologies)?|stack|tools?|environment|built\s+with)\s*[:\-]/i.test(line);

    // A "Technologies: …" line always belongs to the role above it, whether or
    // not bullets have been seen. Checked before the new-role test, because it
    // is short and would otherwise look like the start of the next role.
    if (isTechLine && currentRole) {
      currentRole.technologies = splitList(line.replace(/^[^:\-]*[:\-]/, ''));
      continue;
    }

    // A dated line, or a plain line after bullets, begins a new role — UNLESS
    // the current role is still waiting for its dates. A header like
    //   "Senior Engineer, Acme — Bengaluru"
    //   "Mar 2021 - Present"
    // spans two lines, and treating the second as a new role orphans the first.
    const roleAwaitingDates =
      currentRole !== null && !currentRole.startDate && !currentRole.current && currentRole.bullets.length === 0;
    const startsNewRole =
      !bullet && !(dates !== null && roleAwaitingDates) && (dates !== null || (sawBullet && line.length < 120));

    if (startsNewRole) {
      flushHeader();
      currentRole = template();
      roles.push(currentRole);
      sawBullet = false;

      if (dates) {
        currentRole.startDate = dates.startDate;
        currentRole.endDate = dates.endDate;
        currentRole.current = dates.current;
        const withoutDates = line.replace(DATE_RANGE, '').replace(/[|·–—-]\s*$/, '').trim();
        if (withoutDates) headerLinesForRole.push(withoutDates);
      } else {
        headerLinesForRole.push(line);
      }
      continue;
    }

    if (!currentRole) {
      currentRole = template();
      roles.push(currentRole);
    }

    if (bullet) {
      sawBullet = true;
      flushHeader();
      const textValue = stripBullet(raw);
      if (textValue) {
        currentRole.bullets.push({ id: `b${roles.length}-${currentRole.bullets.length}`, text: textValue, source: 'parsed' });
      }
      continue;
    }

    // Non-bullet line before any bullet: more header context for this role.
    if (!sawBullet) {
      if (dates && !currentRole.startDate) {
        currentRole.startDate = dates.startDate;
        currentRole.endDate = dates.endDate;
        currentRole.current = dates.current;
        // The same line may also carry the title or company.
        const withoutDates = line.replace(DATE_RANGE, '').replace(/^[|·–—,-]+|[|·–—,-]+\s*$/g, '').trim();
        if (withoutDates) headerLinesForRole.push(withoutDates);
        continue;
      }
      headerLinesForRole.push(line);
      continue;
    }

    // A prose line after bullets: treat as a continuation of the last bullet.
    const last = currentRole.bullets[currentRole.bullets.length - 1];
    if (last) last.text = `${last.text} ${line}`.trim();
    else currentRole.summary = `${currentRole.summary} ${line}`.trim();
  }

  flushHeader();

  return roles.filter((r) => r.title || r.company || r.bullets.length > 0);
}

/* -------------------------------------------------------------- projects -- */

function parseProjects(lines: string[]): ResumeProject[] {
  const projects: ResumeProject[] = [];
  let current: ResumeProject | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (isBulletLine(raw)) {
      if (!current) {
        current = blankProject();
        projects.push(current);
      }
      const textValue = stripBullet(raw);
      if (textValue) {
        current.bullets.push({ id: `p${projects.length}-${current.bullets.length}`, text: textValue, source: 'parsed' });
      }
      continue;
    }

    if (/^(tech(nologies)?|stack|tools?|built\s+with)\s*[:\-]/i.test(line)) {
      if (current) current.technologies = splitList(line.replace(/^[^:\-]*[:\-]/, ''));
      continue;
    }

    // A short non-bullet line starts a new project.
    if (line.length < 120) {
      current = blankProject();
      projects.push(current);
      const urlMatch = line.match(URL_RE);
      if (urlMatch) current.url = urlMatch[0].replace(/[.,;)]+$/, '');
      const nameAndRole = line
        .replace(URL_RE, '')
        .split(/\s+[|·–—-]\s+/)
        .map((p) => p.trim())
        .filter(Boolean);
      current.name = nameAndRole[0] ?? line;
      if (nameAndRole[1]) current.role = nameAndRole[1];
      const dates = splitDateRange(line);
      if (dates) {
        current.startDate = dates.startDate;
        current.endDate = dates.endDate;
        current.name = current.name.replace(DATE_RANGE, '').trim();
      }
      continue;
    }

    if (current) current.description = `${current.description} ${line}`.trim();
  }

  return projects.filter((p) => p.name || p.bullets.length > 0);
}

function blankProject(): ResumeProject {
  return {
    id: '',
    name: '',
    role: '',
    url: '',
    startDate: '',
    endDate: '',
    description: '',
    bullets: [],
    technologies: [],
    source: 'parsed',
  };
}

/* ------------------------------------------------------------- education -- */

const DEGREE_RE =
  /\b(b\.?tech|b\.?e\.?|b\.?sc|b\.?com|b\.?a\.?|b\.?b\.?a|bachelor'?s?|m\.?tech|m\.?e\.?|m\.?sc|m\.?com|m\.?a\.?|m\.?b\.?a|master'?s?|ph\.?d|doctorate|diploma|associate|hsc|ssc|12th|10th)\b/i;

function parseEducation(lines: string[]): ResumeEducation[] {
  const entries: ResumeEducation[] = [];
  let current: ResumeEducation | null = null;

  const blank = (): ResumeEducation => ({
    id: '',
    degree: '',
    field: '',
    institution: '',
    location: '',
    startDate: '',
    endDate: '',
    grade: '',
    details: [],
    source: 'parsed',
  });

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (isBulletLine(raw)) {
      if (current) current.details.push(stripBullet(raw));
      continue;
    }

    const hasDegree = DEGREE_RE.test(line);
    if (hasDegree || !current) {
      current = blank();
      entries.push(current);
    }

    const dates = splitDateRange(line);
    if (dates) {
      current.startDate = dates.startDate;
      current.endDate = dates.endDate;
    } else {
      const single = line.match(SINGLE_DATE);
      if (single && !current.endDate) current.endDate = single[0];
    }

    const gradeMatch = line.match(/\b(cgpa|gpa|percentage|score|grade)\b\s*[:\-]?\s*([\d.]+\s*(?:\/\s*[\d.]+)?%?)/i);
    if (gradeMatch) current.grade = `${gradeMatch[1]} ${gradeMatch[2]}`.trim();

    const cleaned = line
      .replace(DATE_RANGE, '')
      .replace(/\b(cgpa|gpa|percentage|score|grade)\b\s*[:\-]?\s*[\d.]+\s*(?:\/\s*[\d.]+)?%?/gi, '')
      .replace(/[|,–—-]\s*$/, '')
      .trim();

    if (hasDegree) {
      const degreeMatch = cleaned.match(DEGREE_RE);
      current.degree = degreeMatch?.[0] ?? '';
      // Removing "B.E." from "B.E. Computer Science" leaves a stray period.
      const rest = cleaned
        .replace(DEGREE_RE, '')
        .replace(/^[\s.,;:–—-]+/, '')
        .replace(/^\s*(in|of)\s+/i, '')
        .trim();
      const parts = rest.split(/\s+[|·–—,]\s+|,\s(?=[A-Z])/).map((p) => p.trim()).filter(Boolean);
      if (parts[0]) current.field = parts[0].replace(/^[.,\s]+/, '');
      if (parts[1]) current.institution = parts[1];
    } else if (!current.institution && cleaned) {
      current.institution = cleaned;
    } else if (cleaned) {
      current.details.push(cleaned);
    }
  }

  return entries.filter((e) => e.degree || e.institution);
}

/* ---------------------------------------------------------------- skills -- */

function splitList(value: string): string[] {
  return (value ?? '')
    .split(/[,;|·••]|\s{3,}|\s+\/\s+/)
    .map((s) => s.replace(/^[\s\-–—]+|[\s.]+$/g, '').trim())
    .filter((s) => s.length > 0 && s.length <= 80);
}

function parseSkills(lines: string[]): StructuredResume['skills'] {
  const groups: StructuredResume['skills'] = [];
  let ungrouped: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const cleaned = isBulletLine(raw) ? stripBullet(raw) : line;
    const colon = cleaned.match(/^([A-Za-z][A-Za-z0-9 &/+#.-]{1,40}?)\s*:\s*(.+)$/);

    if (colon) {
      const skills = splitList(colon[2]!);
      if (skills.length) {
        groups.push({ id: '', category: colon[1]!.trim(), skills, source: 'parsed' });
        continue;
      }
    }
    ungrouped.push(...splitList(cleaned));
  }

  ungrouped = [...new Set(ungrouped)];
  if (ungrouped.length) {
    groups.push({ id: '', category: groups.length ? 'Other' : '', skills: ungrouped, source: 'parsed' });
  }
  return groups;
}

/* -------------------------------------------------------- simple sections -- */

function parseCertifications(lines: string[]): ResumeCertification[] {
  const out: ResumeCertification[] = [];
  for (const raw of lines) {
    const line = isBulletLine(raw) ? stripBullet(raw) : raw.trim();
    if (!line) continue;
    const date = line.match(SINGLE_DATE)?.[0] ?? '';
    const withoutDate = line.replace(SINGLE_DATE, '').replace(/[(),|–—-]+\s*$/, '').trim();
    const parts = withoutDate.split(/\s+[|·–—]\s+|\s+[-–]\s+|,\s(?=[A-Z])/).map((p) => p.trim()).filter(Boolean);
    out.push({
      id: '',
      name: parts[0] ?? withoutDate,
      issuer: parts[1] ?? '',
      date,
      credentialId: '',
      url: line.match(URL_RE)?.[0] ?? '',
      source: 'parsed',
    });
  }
  return out.filter((c) => c.name);
}

function parseSimpleEntries(lines: string[]): StructuredResume['awards'] {
  const out: StructuredResume['awards'] = [];
  for (const raw of lines) {
    const line = isBulletLine(raw) ? stripBullet(raw) : raw.trim();
    if (!line) continue;
    const date = line.match(SINGLE_DATE)?.[0] ?? '';
    const withoutDate = line.replace(SINGLE_DATE, '').replace(/[(),|–—-]+\s*$/, '').trim();
    const split = withoutDate.split(/\s+[|·–—]\s+|\s+[-–]\s+/);
    out.push({
      id: '',
      title: (split[0] ?? withoutDate).trim(),
      detail: split.slice(1).join(' — ').trim(),
      date,
      source: 'parsed',
    });
  }
  return out.filter((e) => e.title);
}

function parseLinks(lines: string[]): StructuredResume['links'] {
  const out: StructuredResume['links'] = [];
  for (const raw of lines) {
    const line = isBulletLine(raw) ? stripBullet(raw) : raw.trim();
    if (!line) continue;
    const url = line.match(URL_RE)?.[0]?.replace(/[.,;)]+$/, '') ?? '';
    if (!url) continue;
    const label = line.replace(URL_RE, '').replace(/[:\-–—|]+\s*$/, '').trim();
    out.push({ id: '', label, url, source: 'parsed' });
  }
  return out;
}

/* ---------------------------------------------------------------- entry --- */

export interface NormalizeResult {
  resume: StructuredResume;
  warnings: string[];
  /** Which canonical sections the parser actually located. */
  detectedSections: string[];
}

/**
 * Normalise extracted resume text into the canonical structure.
 * Pure and synchronous — safe to unit test and to call from anywhere.
 */
export function normalizeResumeText(rawText: string): NormalizeResult {
  const text = (rawText ?? '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const resume = emptyResume();
  const warnings: string[] = [];

  const { header, blocks } = splitIntoBlocks(lines);

  resume.contact = parseContact(header.length ? header : lines.slice(0, 12), text);

  const detected = new Set<string>();

  for (const block of blocks) {
    const body = block.lines;
    const joined = body.join('\n').trim();
    if (!joined) continue;

    switch (block.key) {
      case 'summary':
        resume.summary = joined.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
        resume.summarySource = 'parsed';
        detected.add('summary');
        break;
      case 'experience':
        resume.experience.push(...parseExperience(body));
        detected.add('experience');
        break;
      case 'projects':
        resume.projects.push(...parseProjects(body));
        detected.add('projects');
        break;
      case 'education':
        resume.education.push(...parseEducation(body));
        detected.add('education');
        break;
      case 'skills':
        resume.skills.push(...parseSkills(body));
        detected.add('skills');
        break;
      case 'certifications':
        resume.certifications.push(...parseCertifications(body));
        detected.add('certifications');
        break;
      case 'awards':
        resume.awards.push(...parseSimpleEntries(body));
        detected.add('awards');
        break;
      case 'publications':
        resume.publications.push(...parseSimpleEntries(body));
        detected.add('publications');
        break;
      case 'volunteer':
        resume.volunteer.push(...parseSimpleEntries(body));
        detected.add('volunteer');
        break;
      case 'languages':
        resume.languages.push(...splitList(joined.replace(/\n/g, ', ')));
        detected.add('languages');
        break;
      case 'links':
        resume.links.push(...parseLinks(body));
        detected.add('links');
        break;
      case 'additional':
        resume.additional = joined.replace(/\n+/g, ' ').trim();
        detected.add('additional');
        break;
      default:
        // Unrecognised heading: keep the content verbatim rather than guessing.
        resume.unparsedSections.push({ heading: block.heading, body: joined.slice(0, 8000) });
        break;
    }
  }

  // No headings at all: keep everything so nothing is silently lost.
  if (blocks.length === 0 && text.trim().length > 0) {
    warnings.push(
      'No section headings were recognised, so the resume could not be split into sections. ' +
        'Adding standard headings (Summary, Experience, Skills, Education) improves both ATS parsing and this analysis.',
    );
    resume.unparsedSections.push({ heading: 'Document', body: text.slice(0, 8000) });
  }

  if (!resume.contact.email) warnings.push('No email address was found in the resume.');
  if (!resume.contact.phone) warnings.push('No phone number was found in the resume.');
  if (!resume.contact.fullName) warnings.push('Your name could not be identified at the top of the resume.');
  if (resume.experience.length === 0 && !detected.has('experience')) {
    warnings.push('No work experience section was recognised.');
  }
  if (resume.skills.length === 0) warnings.push('No skills section was recognised.');
  if (resume.unparsedSections.length > 0) {
    warnings.push(
      `${resume.unparsedSections.length} section(s) could not be classified and were kept verbatim: ` +
        resume.unparsedSections.map((s) => s.heading).filter(Boolean).join(', '),
    );
  }

  return { resume, warnings, detectedSections: [...detected] };
}

/**
 * Merge profile data into a parsed resume for fields the document did not
 * supply. Anything filled this way is marked `source: 'profile'` so the UI can
 * show where it came from — this is not fabrication, it is the user's own data.
 */
export function enrichContactFromProfile(
  resume: StructuredResume,
  profile: {
    fullName?: string;
    email?: string;
    phone?: string;
    city?: string;
    country?: string;
    linkedinUrl?: string;
    githubUrl?: string;
    portfolioUrl?: string;
    websiteUrl?: string;
    headline?: string;
  },
): { resume: StructuredResume; filled: string[] } {
  const filled: string[] = [];
  const c = resume.contact;

  const fill = (key: keyof typeof c, value: string | undefined, label: string) => {
    if (!c[key] && value) {
      c[key] = value;
      filled.push(label);
    }
  };

  fill('fullName', profile.fullName, 'name');
  fill('email', profile.email, 'email');
  fill('phone', profile.phone, 'phone');
  fill('headline', profile.headline, 'headline');
  fill('linkedinUrl', profile.linkedinUrl, 'LinkedIn URL');
  fill('githubUrl', profile.githubUrl, 'GitHub URL');
  fill('portfolioUrl', profile.portfolioUrl, 'portfolio URL');
  fill('websiteUrl', profile.websiteUrl, 'website');

  if (!c.location) {
    const loc = [profile.city, profile.country].filter(Boolean).join(', ');
    if (loc) {
      c.location = loc;
      filled.push('location');
    }
  }

  return { resume, filled };
}
