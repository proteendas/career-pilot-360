/**
 * Deterministic job-description structuring.
 *
 * Pure, no AI, no network. Every adapter runs its raw description through this,
 * so a Greenhouse posting, a pasted URL and a hand-typed description all end up
 * in the same shape. An AI pass may later enrich the result, but nothing here
 * depends on one — the matching engine works on this output alone.
 */
import { sanitizeImportedText } from '@/lib/security';
import type { LocationData, SalaryData, VisaSponsorship, WorkMode } from './types';

/* ------------------------------------------------------------- section split */

type Bucket = 'responsibilities' | 'requirements' | 'preferred' | 'benefits' | 'about' | 'other';

const HEADING_PATTERNS: [Bucket, RegExp][] = [
  ['responsibilities', /^(what you(?:'ll| will) do|responsibilities|the role|your role|key responsibilities|duties|day[\s-]to[\s-]day|in this role|what the job involves)\b/i],
  ['requirements', /^(requirements?|qualifications?|what we(?:'re| are) looking for|must[\s-]haves?|who you are|skills? (?:and|&) experience|minimum qualifications?|basic qualifications?|you (?:should )?have|essential)\b/i],
  ['preferred', /^(preferred|nice[\s-]to[\s-]have|bonus|desirable|good to have|plus(?:es)?|preferred qualifications?|additional qualifications?|it would be great)\b/i],
  ['benefits', /^(benefits?|perks?|what we offer|compensation (?:and|&) benefits|why join)\b/i],
  ['about', /^(about (?:us|the company|the team)|who we are|our (?:mission|story|team))\b/i],
];

function classifyHeading(line: string): Bucket | null {
  const cleaned = line.trim().replace(/^[#*\-\s]+/, '').replace(/[:\s]+$/, '');
  if (!cleaned || cleaned.length > 80) return null;
  for (const [bucket, pattern] of HEADING_PATTERNS) {
    if (pattern.test(cleaned)) return bucket;
  }
  return null;
}

function isListItem(line: string): boolean {
  return /^\s*(?:[•▪●◦‣*\-–—]|\d+[.)])\s+/.test(line);
}

function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:[•▪●◦‣*\-–—]|\d+[.)])\s+/, '').trim();
}

export interface StructuredJob {
  responsibilities: string[];
  requirements: string[];
  preferredQualifications: string[];
  benefits: string[];
}

/**
 * Split a description into buckets by heading.
 * Bullets under a heading belong to that heading; bullets with no heading above
 * them are treated as requirements only when they read like requirements.
 */
export function structureDescription(description: string): StructuredJob {
  const text = sanitizeImportedText(description ?? '');
  const lines = text.split('\n');

  const out: StructuredJob = {
    responsibilities: [],
    requirements: [],
    preferredQualifications: [],
    benefits: [],
  };

  let bucket: Bucket | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const heading = classifyHeading(trimmed);
    if (heading) {
      bucket = heading;
      continue;
    }

    if (!isListItem(line)) {
      // A long prose paragraph usually ends the current list section.
      if (trimmed.length > 160) bucket = bucket === 'about' ? bucket : null;
      continue;
    }

    const item = stripListMarker(line);
    if (!item || item.length < 3) continue;
    const capped = item.slice(0, 500);

    switch (bucket) {
      case 'responsibilities':
        out.responsibilities.push(capped);
        break;
      case 'requirements':
        out.requirements.push(capped);
        break;
      case 'preferred':
        out.preferredQualifications.push(capped);
        break;
      case 'benefits':
        out.benefits.push(capped);
        break;
      default:
        // No heading: classify the bullet itself, conservatively.
        if (/\b(\d+\+?\s*years?|experience (?:with|in)|proficien|degree|must have|strong|familiar|knowledge of|expertise)\b/i.test(capped)) {
          out.requirements.push(capped);
        } else if (/\b(you will|design|build|own|develop|lead|collaborate|partner|maintain|operate|deliver|drive)\b/i.test(capped)) {
          out.responsibilities.push(capped);
        }
        break;
    }
  }

  const dedupe = (items: string[]) => [...new Set(items.map((i) => i.trim()))].slice(0, 40);
  return {
    responsibilities: dedupe(out.responsibilities),
    requirements: dedupe(out.requirements),
    preferredQualifications: dedupe(out.preferredQualifications),
    benefits: dedupe(out.benefits),
  };
}

/* ------------------------------------------------------------------ salary -- */

const CURRENCY_SYMBOLS: [RegExp, string][] = [
  [/₹|\bINR\b|\brs\.?\b|\brupees?\b/i, 'INR'],
  [/\$|\bUSD\b|\bdollars?\b/i, 'USD'],
  [/€|\bEUR\b|\beuros?\b/i, 'EUR'],
  [/£|\bGBP\b|\bpounds?\b/i, 'GBP'],
  [/\bAED\b|\bdirhams?\b/i, 'AED'],
  [/\bSGD\b/i, 'SGD'],
  [/\bAUD\b/i, 'AUD'],
  [/\bCAD\b/i, 'CAD'],
];

/** Expand Indian and Western magnitude suffixes into a plain number. */
function scaleNumber(value: number, suffix: string | undefined): number {
  const s = (suffix ?? '').toLowerCase().replace(/\s/g, '');
  if (!s) return value;
  if (s.startsWith('lakh') || s.startsWith('lac') || s === 'l') return value * 100_000;
  if (s.startsWith('crore') || s.startsWith('cr')) return value * 10_000_000;
  if (s === 'k') return value * 1_000;
  if (s === 'm' || s.startsWith('mn') || s.startsWith('million')) return value * 1_000_000;
  return value;
}

const NUM = String.raw`(\d[\d,.]*)\s*(lakhs?|lacs?|crores?|cr|k|m|mn|million|l)?`;

/**
 * Extract a compensation range from free text.
 *
 * Deliberately conservative: when a figure is ambiguous the raw text is kept
 * and no number is asserted, because a wrong salary is worse than none.
 */
export function extractSalary(text: string): SalaryData {
  const source = (text ?? '').slice(0, 6000);
  if (!source) return {};

  let currency: string | null = null;
  for (const [pattern, code] of CURRENCY_SYMBOLS) {
    if (pattern.test(source)) {
      currency = code;
      break;
    }
  }

  const period =
    /\bper\s+(hour|hr)\b|\/\s*(hour|hr)\b|\bhourly\b/i.test(source)
      ? 'hour'
      : /\bper\s+month\b|\/\s*month\b|\bmonthly\b|\bpm\b/i.test(source)
        ? 'month'
        : /\bper\s+(year|annum|yr)\b|\/\s*(year|yr)\b|\bannual(?:ly)?\b|\bp\.?a\.?\b|\blpa\b|\bctc\b/i.test(source)
          ? 'year'
          : null;

  // A range: "35,00,000 - 55,00,000" or "35 - 55 LPA" or "$120k–$160k".
  // A currency symbol may sit before either number: "$120k - $160k".
  const CUR = String.raw`[$₹€£]?\s*`;
  const rangeRe = new RegExp(`${CUR}${NUM}\\s*(?:-|–|—|to|up to)\\s*${CUR}${NUM}`, 'i');
  const range = source.match(rangeRe);

  if (range) {
    const minRaw = Number((range[1] ?? '').replace(/,/g, ''));
    const maxRaw = Number((range[3] ?? '').replace(/,/g, ''));
    if (Number.isFinite(minRaw) && Number.isFinite(maxRaw)) {
      // "35 - 55 LPA": the suffix after the second number applies to both.
      const suffix = range[4] ?? range[2];
      const min = scaleNumber(minRaw, range[2] ?? suffix);
      const max = scaleNumber(maxRaw, suffix);
      if (max >= min && min > 0) {
        return { min, max, currency, period, raw: range[0].trim() };
      }
    }
  }

  // A single figure, only when it is clearly compensation.
  const singleRe = new RegExp(
    `(?:salary|compensation|ctc|package|pay|offering|budget)[^.\\n]{0,40}?${NUM}`,
    'i',
  );
  const single = source.match(singleRe);
  if (single) {
    const raw = Number((single[1] ?? '').replace(/,/g, ''));
    if (Number.isFinite(raw) && raw > 0) {
      const value = scaleNumber(raw, single[2]);
      return { min: value, max: null, currency, period, raw: single[0].trim() };
    }
  }

  return currency || period ? { currency, period } : {};
}

/* ---------------------------------------------------------------- location -- */

export function extractWorkMode(text: string, locationText?: string): WorkMode {
  const source = `${locationText ?? ''} ${text ?? ''}`.slice(0, 4000);
  // Order matters: "hybrid" often appears alongside "remote".
  if (/\bhybrid\b/i.test(source)) return 'hybrid';
  if (/\b(fully remote|100% remote|remote[- ]first|work from home|wfh|remote)\b/i.test(source)) {
    // "no remote" / "not remote" is the opposite claim.
    // Allow an intervening article: "this is not a remote role".
    if (/\b(no|not|non)[\s-](?:a\s+|an\s+)?remote\b/i.test(source)) return 'onsite';
    return 'remote';
  }
  if (/\b(on[\s-]?site|in[\s-]office|in[\s-]person)\b/i.test(source)) return 'onsite';
  return 'unknown';
}

export function extractLocation(raw: string | null | undefined): LocationData {
  const value = (raw ?? '').trim();
  if (!value) return {};
  if (/^(remote|anywhere|worldwide)$/i.test(value)) return { raw: value, remote: true };

  const parts = value
    .split(/[,|]/)
    .map((p) => p.trim())
    .filter(Boolean);

  return {
    city: parts[0] ?? null,
    region: parts.length > 2 ? (parts[1] ?? null) : null,
    country: parts.length > 1 ? (parts[parts.length - 1] ?? null) : null,
    raw: value,
    remote: /remote/i.test(value),
  };
}

/* -------------------------------------------------------------- experience -- */

/** Years of experience required, when the posting states it. */
export function extractExperienceYears(text: string): { min: number | null; max: number | null } {
  const source = (text ?? '').slice(0, 8000);

  // "3-5 years", "3 to 5 years"
  const range = source.match(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (min <= max && max <= 40) return { min, max };
  }

  // "5+ years ..." — the explicit plus marks it as a minimum on its own.
  const plus = source.match(/(\d{1,2})\s*\+\s*(?:years?|yrs?)\b/i);
  if (plus) {
    const min = Number(plus[1]);
    if (min <= 40) return { min, max: null };
  }

  // "minimum 5 years of experience", "at least 5 years"
  const single = source.match(
    /(?:at least|minimum(?: of)?|min\.?|over)?\s*(\d{1,2})\s*(?:years?|yrs?)\b(?:\s+of)?\s*(?:relevant\s+|professional\s+|hands[\s-]on\s+)?(?:experience|exp\b)/i,
  );
  if (single) {
    const min = Number(single[1]);
    if (min <= 40) return { min, max: null };
  }

  return { min: null, max: null };
}

const SENIORITY_PATTERNS: [string, RegExp][] = [
  ['intern', /\b(intern|internship|trainee|apprentice)\b/i],
  ['executive', /\b(chief|cto|ceo|cfo|vp of|vice president|head of engineering)\b/i],
  ['director', /\b(director|head of)\b/i],
  ['manager', /\b(engineering manager|manager|team lead)\b/i],
  ['principal', /\b(principal|staff engineer|distinguished|architect)\b/i],
  ['lead', /\b(lead|tech lead)\b/i],
  ['senior', /\b(senior|sr\.?|experienced)\b/i],
  ['junior', /\b(junior|jr\.?|associate|graduate|entry[\s-]level|fresher)\b/i],
];

export function extractSeniority(title: string, description?: string): string | null {
  // The title is far more reliable than the body for seniority.
  for (const [level, pattern] of SENIORITY_PATTERNS) {
    if (pattern.test(title ?? '')) return level;
  }
  const desc = (description ?? '').slice(0, 1500);
  for (const [level, pattern] of SENIORITY_PATTERNS) {
    if (pattern.test(desc)) return level;
  }
  return null;
}

export function extractEmploymentType(text: string): string | null {
  const source = (text ?? '').slice(0, 3000);
  if (/\b(full[\s-]?time|permanent|fte)\b/i.test(source)) return 'full_time';
  if (/\b(part[\s-]?time)\b/i.test(source)) return 'part_time';
  if (/\b(contract|contractor|freelance|consultant|c2h|contract[\s-]to[\s-]hire)\b/i.test(source)) return 'contract';
  if (/\b(internship|intern)\b/i.test(source)) return 'internship';
  if (/\b(temporary|temp|seasonal)\b/i.test(source)) return 'temporary';
  return null;
}

/**
 * Whether the posting says anything about sponsorship.
 * 'unknown' is the honest default and by far the most common answer.
 */
export function extractVisaSponsorship(text: string): VisaSponsorship {
  const source = (text ?? '').slice(0, 8000);
  if (/\b(no|not|cannot|unable to|do not|does not|won't|will not)\b[^.\n]{0,40}\bsponsor/i.test(source)) return 'no';
  if (/\b(visa sponsorship (?:is )?(?:available|provided|offered)|we sponsor|will sponsor|sponsorship available)\b/i.test(source)) {
    return 'yes';
  }
  return 'unknown';
}

/* ------------------------------------------------------------------ skills -- */

/**
 * A curated technology vocabulary.
 *
 * Deliberately a fixed list rather than an open extractor: guessing that an
 * arbitrary capitalised word is a skill produces noise, and this list feeds the
 * matching engine, where a false skill is actively harmful.
 */
const SKILL_VOCABULARY = [
  // languages
  'TypeScript', 'JavaScript', 'Python', 'Java', 'Go', 'Golang', 'Rust', 'C++', 'C#', 'Ruby', 'PHP',
  'Kotlin', 'Swift', 'Scala', 'Elixir', 'Perl', 'R', 'MATLAB', 'Dart', 'Objective-C', 'Clojure', 'Haskell',
  // web / frontend
  'React', 'React Native', 'Next.js', 'Vue', 'Nuxt', 'Angular', 'Svelte', 'SolidJS', 'HTML', 'CSS',
  'Sass', 'Tailwind', 'Redux', 'Webpack', 'Vite', 'jQuery', 'Astro', 'Remix',
  // backend / frameworks
  'Node.js', 'Express', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Spring', 'Spring Boot', 'Rails',
  'Laravel', 'ASP.NET', '.NET', 'Gin', 'Phoenix', 'GraphQL', 'gRPC', 'REST', 'tRPC',
  // data
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Cassandra', 'DynamoDB', 'Elasticsearch', 'OpenSearch',
  'Snowflake', 'BigQuery', 'Redshift', 'ClickHouse', 'Kafka', 'RabbitMQ', 'SQS', 'Pulsar', 'Airflow',
  'dbt', 'Spark', 'Hadoop', 'Flink', 'SQL', 'NoSQL', 'Neo4j', 'SQLite', 'Oracle', 'MariaDB',
  // cloud / infra
  'AWS', 'GCP', 'Azure', 'Docker', 'Kubernetes', 'Terraform', 'Pulumi', 'Ansible', 'Helm', 'Jenkins',
  'GitHub Actions', 'GitLab CI', 'CircleCI', 'ArgoCD', 'Vercel', 'Netlify', 'Cloudflare', 'Lambda',
  'EC2', 'S3', 'RDS', 'EKS', 'Nginx', 'Linux', 'Bash', 'Prometheus', 'Grafana', 'Datadog', 'Sentry',
  'OpenTelemetry', 'Istio', 'Consul', 'Vault',
  // ml / ai
  'TensorFlow', 'PyTorch', 'scikit-learn', 'Pandas', 'NumPy', 'Keras', 'LangChain', 'Hugging Face',
  'MLflow', 'OpenCV', 'NLP', 'LLM',
  // mobile
  'iOS', 'Android', 'Flutter', 'SwiftUI', 'Jetpack Compose', 'Xamarin',
  // practices
  'CI/CD', 'TDD', 'Microservices', 'System Design', 'Agile', 'Scrum', 'DevOps', 'SRE', 'OAuth',
  'JWT', 'WebSockets', 'Event Sourcing', 'CQRS', 'Distributed Systems', 'Observability',
  // tools
  'Git', 'Jira', 'Figma', 'Postman', 'Swagger', 'Storybook', 'Jest', 'Vitest', 'Cypress', 'Playwright',
  'Selenium', 'pytest', 'JUnit',
];

/** Word-boundary match that tolerates the punctuation in names like Node.js. */
function mentionsSkill(text: string, skill: string): boolean {
  const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A trailing '+' or '#' cannot be followed by a word boundary, so the
  // lookarounds are written in terms of adjacent characters instead.
  return new RegExp(`(^|[^A-Za-z0-9+#.])${escaped}([^A-Za-z0-9+#]|$)`, 'i').test(text);
}

/** Skills named in the text, drawn only from the known vocabulary. */
export function extractSkills(text: string, limit = 40): string[] {
  const source = (text ?? '').slice(0, 20_000);
  if (!source) return [];

  const found: string[] = [];
  for (const skill of SKILL_VOCABULARY) {
    if (found.length >= limit) break;
    if (mentionsSkill(source, skill)) found.push(skill);
  }

  // Collapse aliases so matching does not double-count.
  const aliases: Record<string, string> = { Golang: 'Go', '.NET': 'ASP.NET' };
  const normalised = found.map((s) => aliases[s] ?? s);
  return [...new Set(normalised)];
}

export function isKnownSkill(value: string): boolean {
  const needle = value.trim().toLowerCase();
  return SKILL_VOCABULARY.some((s) => s.toLowerCase() === needle);
}

export const SKILL_VOCABULARY_SIZE = SKILL_VOCABULARY.length;

/* ------------------------------------------------------------------ dates -- */

/** Parse a provider timestamp defensively. */
export function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // Guard against obviously wrong values from loose provider data.
  const year = d.getUTCFullYear();
  if (year < 2000 || year > 2100) return null;
  return d;
}

/* --------------------------------------------------------------- full pass -- */

export interface ExtractedJobFields {
  responsibilities: string[];
  requirements: string[];
  preferredQualifications: string[];
  skills: string[];
  salary: SalaryData;
  workMode: WorkMode;
  employmentType: string | null;
  seniority: string | null;
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  visaSponsorship: VisaSponsorship;
}

/** Run every deterministic extractor over one description. */
export function extractJobFields(
  title: string,
  description: string,
  locationText?: string | null,
): ExtractedJobFields {
  const structured = structureDescription(description);
  const experience = extractExperienceYears(description);

  return {
    responsibilities: structured.responsibilities,
    requirements: structured.requirements,
    preferredQualifications: structured.preferredQualifications,
    skills: extractSkills(`${title}\n${description}`),
    salary: extractSalary(description),
    workMode: extractWorkMode(description, locationText ?? ''),
    employmentType: extractEmploymentType(`${title}\n${description}`),
    seniority: extractSeniority(title, description),
    experienceMinYears: experience.min,
    experienceMaxYears: experience.max,
    visaSponsorship: extractVisaSponsorship(description),
  };
}
