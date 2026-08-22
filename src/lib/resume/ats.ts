/**
 * Heuristic ATS scoring. Pure, deterministic, no AI, no network.
 *
 * IMPORTANT FRAMING: this score is CareerPilot360's own heuristic. It is not
 * the score any particular employer's applicant tracking system will produce,
 * and the UI must never imply otherwise. What it gives you is a reproducible,
 * fully-explained read on the things ATS pipelines and human screeners
 * demonstrably struggle with.
 *
 * Every signal below returns a 0–100 sub-score plus the evidence behind it, and
 * the overall score is their weighted mean. Because it is deterministic, the
 * same resume always scores the same, and a change in score is always
 * attributable to a specific edit.
 */
import {
  allBullets,
  allSkills,
  allTechnologies,
  resumeToPlainText,
  type StructuredResume,
} from './types';

/* ------------------------------------------------------------------ types -- */

export type SignalKey =
  | 'contact_completeness'
  | 'section_completeness'
  | 'keyword_coverage'
  | 'skill_clarity'
  | 'title_relevance'
  | 'experience_relevance'
  | 'measurable_achievements'
  | 'action_verbs'
  | 'formatting_consistency'
  | 'readability'
  | 'location_alignment'
  | 'seniority_alignment'
  | 'education_relevance'
  | 'parsing_compatibility';

export type Priority = 'high' | 'medium' | 'low';

export interface SignalResult {
  key: SignalKey;
  label: string;
  score: number;
  weight: number;
  /** Plain-language explanation of how this score was reached. */
  explanation: string;
  /** Concrete things found that support the score. */
  evidence: string[];
}

export interface AtsFinding {
  id: string;
  category:
    | 'contact'
    | 'sections'
    | 'keywords'
    | 'skills'
    | 'impact'
    | 'language'
    | 'formatting'
    | 'dates'
    | 'claims'
    | 'parsing'
    | 'alignment';
  priority: Priority;
  title: string;
  detail: string;
  /** Where in the resume this applies, when it is location-specific. */
  path?: string;
  /** The offending text, when there is a specific span. */
  excerpt?: string;
}

export interface KeywordCoverage {
  matched: string[];
  missing: string[];
  overused: { term: string; count: number }[];
}

export interface AtsReport {
  overallScore: number;
  /** Always 'heuristic' — stated explicitly so the UI cannot overclaim. */
  scoreKind: 'heuristic';
  scoreExplanation: string;
  signals: SignalResult[];
  strengths: string[];
  findings: AtsFinding[];
  keywords: KeywordCoverage;
  /** Dates that could not be interpreted, or that read ambiguously. */
  ambiguousDates: string[];
  /** Bullets with no quantified outcome, which the user may be able to supply. */
  bulletsMissingMetrics: { path: string; text: string }[];
  /** Job titles that are unclear or internal-jargon. */
  unclearTitles: string[];
  /** Claims that assert an outcome with no supporting detail. */
  unsupportedClaims: { path: string; text: string; reason: string }[];
  /** Word and character counts, for the readability panel. */
  stats: {
    wordCount: number;
    bulletCount: number;
    averageBulletWords: number;
    longestBulletWords: number;
    roleCount: number;
    skillCount: number;
    estimatedPages: number;
  };
}

export interface AtsContext {
  /** Target titles from the user's profile, used for title relevance. */
  targetTitles?: string[];
  /** Preferred locations, used for location alignment. */
  preferredLocations?: string[];
  /** Career level, used for seniority alignment. */
  careerLevel?: string;
  yearsOfExperience?: number;
  /** When scoring against a specific job, its text drives keyword coverage. */
  jobDescription?: string;
  jobTitle?: string;
  /** Skills the user claims in their profile but which may be missing here. */
  profileSkills?: string[];
}

/* ---------------------------------------------------------------- vocabulary */

const STRONG_ACTION_VERBS = new Set([
  'architected', 'automated', 'built', 'consolidated', 'converted', 'created',
  'debugged', 'decreased', 'delivered', 'deployed', 'designed', 'developed',
  'diagnosed', 'eliminated', 'engineered', 'established', 'expanded',
  'implemented', 'improved', 'increased', 'initiated', 'integrated',
  'introduced', 'launched', 'led', 'maintained', 'managed', 'migrated',
  'modernised', 'modernized', 'negotiated', 'optimised', 'optimized',
  'orchestrated', 'overhauled', 'owned', 'partnered', 'pioneered', 'prototyped',
  'reduced', 'refactored', 'rearchitected', 'released', 'resolved',
  'restructured', 'scaled', 'shipped', 'simplified', 'standardised',
  'standardized', 'streamlined', 'supported', 'tested', 'trained', 'upgraded',
  'wrote', 'authored', 'coordinated', 'drove', 'executed', 'facilitated',
  'mentored', 'reviewed', 'spearheaded',
  // Produced by the deterministic rewrites in resume/suggestions.ts. Keeping
  // these in sync matters: a rewrite the scorer does not credit is advice that
  // cannot improve the score.
  'contributed', 'delivered',
]);

/** Openings that describe presence rather than contribution. */
const WEAK_OPENINGS = [
  'responsible for',
  'worked on',
  'worked with',
  'helped with',
  'helped to',
  'involved in',
  'participated in',
  'assisted with',
  'assisted in',
  'tasked with',
  'duties included',
  'part of a team that',
  'exposure to',
  'familiar with',
  'handled',
];

/**
 * Claims that assert an outcome but carry no supporting substance.
 *
 * Patterns rather than literals, because the same empty claim arrives in every
 * tense: "significantly improved", "significantly improving", "will
 * significantly improve". Matching only one form lets the rest through.
 */
const VAGUE_CLAIM_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(significantly|greatly|dramatically|substantially|massively|drastically)\s+\w+(ed|ing|e|s)?\b/i, label: 'an unquantified intensifier' },
  { pattern: /\bbest[\s-]in[\s-]class\b/i, label: 'best in class' },
  { pattern: /\bworld[\s-]class\b/i, label: 'world class' },
  { pattern: /\bcutting[\s-]edge\b/i, label: 'cutting edge' },
  { pattern: /\bstate[\s-]of[\s-]the[\s-]art\b/i, label: 'state of the art' },
  { pattern: /\b(highly|massively|infinitely)\s+scalable\b/i, label: 'vaguely scalable' },
  { pattern: /\bextensive experience\b/i, label: 'extensive experience' },
  { pattern: /\bexpert[\s-]level\b/i, label: 'expert level' },
  { pattern: /\b(guru|ninja|rockstar|wizard)\b/i, label: 'a self-applied superlative' },
  { pattern: /\bsynerg(y|ies|istic)\b/i, label: 'synergy' },
  { pattern: /\bthink(ing)? outside the box\b/i, label: 'thinking outside the box' },
  { pattern: /\bgo[\s-]to person\b/i, label: 'go-to person' },
  { pattern: /\bresults[\s-]driven\b/i, label: 'results-driven' },
  { pattern: /\bself[\s-]starter\b/i, label: 'self-starter' },
  { pattern: /\bteam player\b/i, label: 'team player' },
  { pattern: /\bhard[\s-]work(er|ing)\b/i, label: 'hard worker' },
  { pattern: /\bdetail[\s-]oriented\b/i, label: 'detail-oriented' },
  { pattern: /\bproven track record\b/i, label: 'proven track record' },
  { pattern: /\bpassionate about\b/i, label: 'passionate about' },
];

/** First vague claim found in a piece of text, or null. */
function findVagueClaim(value: string): string | null {
  for (const { pattern, label } of VAGUE_CLAIM_PATTERNS) {
    if (pattern.test(value)) return label;
  }
  return null;
}

/** Words too generic to count as keywords when comparing against a job. */
const STOPWORDS = new Set([
  'a','about','above','across','after','against','all','also','am','an','and','any','are','as','at','be','because',
  'been','before','being','below','between','both','but','by','can','cannot','could','did','do','does','doing','down',
  'during','each','few','for','from','further','had','has','have','having','he','her','here','hers','him','his','how',
  'i','if','in','into','is','it','its','itself','just','me','more','most','my','no','nor','not','now','of','off','on',
  'once','only','or','other','our','ours','out','over','own','same','she','should','so','some','such','than','that',
  'the','their','theirs','them','then','there','these','they','this','those','through','to','too','under','until','up',
  'very','was','we','were','what','when','where','which','while','who','whom','why','will','with','would','you','your',
  'yours','role','job','work','team','teams','years','year','experience','strong','good','great','plus','etc','using',
  'ability','able','including','include','includes','well','new','across','within','via','per','end','ensure','ensuring',
  'must','need','needs','required','requirements','preferred','responsibilities','qualifications','candidate','ideal',
  'looking','join','help','build','building','make','making','one','two','three','company','opportunity','position',
]);

const SENIORITY_TERMS: Record<string, string[]> = {
  student: ['intern', 'trainee', 'student'],
  entry: ['junior', 'associate', 'graduate', 'entry', 'trainee'],
  junior: ['junior', 'associate', 'graduate'],
  mid: ['engineer', 'developer', 'analyst', 'specialist'],
  senior: ['senior', 'sr', 'lead'],
  lead: ['lead', 'principal', 'staff', 'architect'],
  principal: ['principal', 'staff', 'architect', 'distinguished'],
  manager: ['manager', 'head', 'lead'],
  director: ['director', 'head', 'vp'],
  executive: ['vp', 'chief', 'cto', 'ceo', 'president', 'director'],
};

/* ---------------------------------------------------------------- utilities */

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9+#.]*/g) ?? []).filter((w) => w.length > 1);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Tokenise a job description into candidate keywords, most significant first.
 *
 * Frequency alone ranks badly on job posts: the technology that matters most
 * often appears exactly once ("Terraform"), while filler repeats. So proper
 * nouns and technology-shaped tokens are weighted up. Without this, a plain
 * frequency sort pushes the actual requirements out of the list and ties are
 * broken alphabetically, which is arbitrary.
 */
export function extractJobKeywords(jobText: string, limit = 40): string[] {
  const counts = new Map<string, number>();
  const text = jobText ?? '';

  // Multi-word technical phrases first: they carry more signal than singles.
  const phrases = text.toLowerCase().match(/\b[a-z][a-z0-9+#.]*(?:[ -][a-z][a-z0-9+#.]*){1,2}\b/g) ?? [];
  for (const phrase of phrases) {
    const parts = phrase.split(/[ -]/);
    if (parts.length < 2) continue;
    if (parts.some((p) => STOPWORDS.has(p))) continue;
    counts.set(phrase, (counts.get(phrase) ?? 0) + 2);
  }

  for (const w of words(text)) {
    if (STOPWORDS.has(w) || w.length < 3) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }

  /** A token written with internal or leading capitals is almost always a name. */
  const properNoun = new Set<string>();
  for (const token of text.match(/\b[A-Z][A-Za-z0-9+#.]{2,}\b/g) ?? []) {
    properNoun.add(token.toLowerCase());
  }
  // Mixed-case and all-caps forms (PostgreSQL, AWS, CI/CD) are stronger still.
  const strongProperNoun = new Set<string>();
  for (const token of text.match(/\b(?:[A-Z]{2,}|[A-Z][a-z]+[A-Z][A-Za-z]*)\b/g) ?? []) {
    strongProperNoun.add(token.toLowerCase());
  }

  const weighted = [...counts.entries()].map(([term, count]) => {
    let score = count;
    if (strongProperNoun.has(term)) score += 4;
    else if (properNoun.has(term)) score += 2;
    // Version- and symbol-bearing tokens (c++, es6, k8s) are technologies.
    if (/[+#]|\d/.test(term)) score += 1;
    return [term, score] as const;
  });

  return weighted
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

/** Does the resume mention this term? Word-boundary aware, case-insensitive. */
function mentions(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

/* ------------------------------------------------------------------ signals */

function scoreContact(resume: StructuredResume, findings: AtsFinding[]): SignalResult {
  const c = resume.contact;
  const checks: [string, boolean, Priority, string][] = [
    ['Name', Boolean(c.fullName), 'high', 'Add your full name as the first line of the resume.'],
    ['Email', Boolean(c.email), 'high', 'Add a professional email address.'],
    ['Phone', Boolean(c.phone), 'high', 'Add a phone number with its country code.'],
    ['Location', Boolean(c.location), 'medium', 'Add your city and country — many filters use it.'],
    [
      'LinkedIn or portfolio',
      Boolean(c.linkedinUrl || c.portfolioUrl || c.githubUrl || c.websiteUrl),
      'low',
      'Add a LinkedIn profile or portfolio link.',
    ],
  ];

  const present = checks.filter(([, ok]) => ok);
  for (const [label, ok, priority, detail] of checks) {
    if (ok) continue;
    findings.push({
      id: `contact_${label.toLowerCase().replace(/\s+/g, '_')}`,
      category: 'contact',
      priority,
      title: `${label} is missing`,
      detail,
    });
  }

  if (c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) {
    findings.push({
      id: 'contact_email_malformed',
      category: 'contact',
      priority: 'high',
      title: 'The email address looks malformed',
      detail: 'Parsers frequently mangle emails split across lines. Check it reads correctly.',
      excerpt: c.email,
    });
  }

  return {
    key: 'contact_completeness',
    label: 'Contact information',
    score: clamp((present.length / checks.length) * 100),
    weight: 8,
    explanation: `${present.length} of ${checks.length} expected contact fields are present.`,
    evidence: present.map(([label]) => label),
  };
}

function scoreSections(resume: StructuredResume, findings: AtsFinding[]): SignalResult {
  const checks: [string, boolean, Priority, string][] = [
    [
      'Professional summary',
      resume.summary.trim().length >= 40,
      'medium',
      'Add a two- or three-sentence summary naming your role, years of experience and focus.',
    ],
    [
      'Work experience',
      resume.experience.length > 0,
      'high',
      'Add a work experience section with one entry per role.',
    ],
    ['Skills', allSkills(resume).length >= 5, 'high', 'List at least five concrete skills or technologies.'],
    ['Education', resume.education.length > 0, 'medium', 'Add your education, even if it is brief.'],
    [
      'Projects or certifications',
      resume.projects.length > 0 || resume.certifications.length > 0,
      'low',
      'Projects or certifications help when your experience is short.',
    ],
  ];

  const present = checks.filter(([, ok]) => ok);
  for (const [label, ok, priority, detail] of checks) {
    if (ok) continue;
    findings.push({
      id: `section_${label.toLowerCase().replace(/[^a-z]+/g, '_')}`,
      category: 'sections',
      priority,
      title: `${label} section is missing or too thin`,
      detail,
    });
  }

  if (resume.unparsedSections.length > 0) {
    findings.push({
      id: 'section_unclassified',
      category: 'parsing',
      priority: 'medium',
      title: `${resume.unparsedSections.length} section heading(s) were not recognised`,
      detail:
        'Unrecognised headings were kept verbatim, but an ATS may not map them either. ' +
        'Standard headings — Summary, Experience, Skills, Education — parse most reliably. Unrecognised: ' +
        resume.unparsedSections.map((s) => s.heading).filter(Boolean).join(', '),
    });
  }

  return {
    key: 'section_completeness',
    label: 'Section completeness',
    score: clamp((present.length / checks.length) * 100),
    weight: 9,
    explanation: `${present.length} of ${checks.length} expected sections are present and substantive.`,
    evidence: present.map(([label]) => label),
  };
}

function scoreKeywords(
  resume: StructuredResume,
  plain: string,
  ctx: AtsContext,
  findings: AtsFinding[],
): { signal: SignalResult; coverage: KeywordCoverage } {
  const jobText = ctx.jobDescription?.trim();
  const keywords = jobText
    ? extractJobKeywords(jobText, 40)
    : // With no job in hand, the user's own target titles and profile skills are
      // the only defensible reference set. We do not invent an industry list.
      [...new Set([...(ctx.targetTitles ?? []), ...(ctx.profileSkills ?? [])])]
        .map((s) => s.toLowerCase())
        .filter((s) => s.length > 2);

  const matched: string[] = [];
  const missing: string[] = [];
  for (const kw of keywords) {
    if (mentions(plain, kw)) matched.push(kw);
    else missing.push(kw);
  }

  // Overuse: a term repeated far more than it needs to be reads as stuffing.
  const counts = new Map<string, number>();
  for (const w of words(plain)) {
    if (STOPWORDS.has(w) || w.length < 4) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const totalWords = Math.max(1, words(plain).length);
  const overused = [...counts.entries()]
    .filter(([, n]) => n >= 8 && n / totalWords > 0.012)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([term, count]) => ({ term, count }));

  for (const { term, count } of overused) {
    findings.push({
      id: `keyword_overused_${term}`,
      category: 'keywords',
      priority: 'low',
      title: `"${term}" appears ${count} times`,
      detail:
        'Heavy repetition of one term reads as keyword stuffing to a human reviewer without helping a parser. ' +
        'Vary the wording, or cut the weaker mentions.',
      excerpt: term,
    });
  }

  if (keywords.length === 0) {
    return {
      signal: {
        key: 'keyword_coverage',
        label: 'Keyword coverage',
        score: 50,
        weight: 12,
        explanation:
          'No reference keywords available. Add target job titles and skills to your profile, ' +
          'or analyse this resume against a specific job, to score keyword coverage properly.',
        evidence: [],
      },
      coverage: { matched, missing, overused },
    };
  }

  const ratio = matched.length / keywords.length;
  if (missing.length > 0 && jobText) {
    findings.push({
      id: 'keyword_missing_from_job',
      category: 'keywords',
      priority: missing.length > keywords.length / 2 ? 'high' : 'medium',
      title: `${missing.length} term(s) from the job description do not appear in your resume`,
      detail:
        'Add only the ones you genuinely have. Missing: ' +
        missing.slice(0, 15).join(', ') +
        (missing.length > 15 ? `, and ${missing.length - 15} more.` : '.'),
    });
  }

  return {
    signal: {
      key: 'keyword_coverage',
      label: 'Keyword coverage',
      score: clamp(ratio * 100),
      weight: 12,
      explanation: jobText
        ? `${matched.length} of ${keywords.length} significant terms from the job description appear in your resume.`
        : `${matched.length} of ${keywords.length} of your own target titles and profile skills appear in your resume.`,
      evidence: matched.slice(0, 20),
    },
    coverage: { matched, missing, overused },
  };
}

function scoreSkillClarity(resume: StructuredResume, findings: AtsFinding[]): SignalResult {
  const skills = allSkills(resume);
  const grouped = resume.skills.filter((g) => g.category).length;
  const evidence: string[] = [];

  let score = 0;
  if (skills.length >= 8) {
    score += 45;
    evidence.push(`${skills.length} skills listed`);
  } else if (skills.length >= 5) {
    score += 30;
    evidence.push(`${skills.length} skills listed`);
  } else if (skills.length > 0) {
    score += 12;
    evidence.push(`only ${skills.length} skills listed`);
  }

  if (grouped > 0) {
    score += 25;
    evidence.push(`${grouped} categorised group(s)`);
  }

  // Skills that also appear in a role or project read as evidenced rather than
  // asserted, which is what a reviewer actually looks for.
  const roleText = [
    ...resume.experience.flatMap((e) => [e.summary, ...e.bullets.map((b) => b.text), ...e.technologies]),
    ...resume.projects.flatMap((p) => [p.description, ...p.bullets.map((b) => b.text), ...p.technologies]),
  ]
    .join(' ')
    .toLowerCase();

  const evidenced = skills.filter((s) => mentions(roleText, s));
  if (skills.length > 0) {
    const ratio = evidenced.length / skills.length;
    score += Math.round(ratio * 30);
    evidence.push(`${evidenced.length} of ${skills.length} skills also appear in your experience`);

    if (ratio < 0.35 && skills.length >= 6) {
      findings.push({
        id: 'skills_unevidenced',
        category: 'skills',
        priority: 'medium',
        title: 'Most listed skills do not appear anywhere in your experience',
        detail:
          'A skills list carries far more weight when the same technology shows up in a role or project bullet. ' +
          'Reviewers read an unevidenced list as aspirational.',
      });
    }
  }

  if (skills.length < 5) {
    findings.push({
      id: 'skills_too_few',
      category: 'skills',
      priority: 'high',
      title: 'Too few skills listed',
      detail: 'List at least five to eight concrete tools, languages or platforms you can speak to in an interview.',
    });
  }

  if (skills.some((s) => s.split(/\s+/).length > 6)) {
    findings.push({
      id: 'skills_prose',
      category: 'skills',
      priority: 'low',
      title: 'Some skill entries are full sentences',
      detail: 'Keep skills as short noun phrases. Sentences in a skills list parse unpredictably.',
    });
  }

  return {
    key: 'skill_clarity',
    label: 'Skill clarity',
    score: clamp(score),
    weight: 9,
    explanation: 'Scores the number of skills, whether they are grouped, and whether your experience evidences them.',
    evidence,
  };
}

function scoreTitleRelevance(resume: StructuredResume, ctx: AtsContext, findings: AtsFinding[]): SignalResult {
  const titles = resume.experience.map((e) => e.title).filter(Boolean);
  const targets = (ctx.targetTitles ?? []).filter(Boolean);
  const jobTitle = ctx.jobTitle?.trim();
  const reference = [...targets, ...(jobTitle ? [jobTitle] : [])];

  const unclear: string[] = [];
  for (const t of titles) {
    // Internal-jargon titles that mean nothing outside the company.
    if (/\b(engineer|developer|manager|analyst|designer|architect|scientist|consultant|lead|director|intern|specialist|administrator|officer|associate)\b/i.test(t)) {
      continue;
    }
    if (/\b(level|grade|band|tier|l\d|t\d|sde\s?\d|ic\d)\b/i.test(t) || t.length < 4) {
      unclear.push(t);
    }
  }

  for (const t of unclear) {
    findings.push({
      id: `title_unclear_${t.toLowerCase().replace(/\W+/g, '_')}`,
      category: 'alignment',
      priority: 'medium',
      title: `"${t}" may not be understood outside your company`,
      detail:
        'Internal grade names and level codes do not map to anything a recruiter searches for. ' +
        'Use the recognised equivalent, and keep the internal title in brackets if you want it recorded.',
      excerpt: t,
    });
  }

  if (titles.length === 0) {
    return {
      key: 'title_relevance',
      label: 'Job title relevance',
      score: 0,
      weight: 8,
      explanation: 'No job titles were found in your experience section.',
      evidence: [],
    };
  }

  if (reference.length === 0) {
    return {
      key: 'title_relevance',
      label: 'Job title relevance',
      score: 55,
      weight: 8,
      explanation:
        'No target titles to compare against. Add target job titles to your profile, or analyse against a specific job.',
      evidence: titles.slice(0, 5),
    };
  }

  // Word-overlap between each of your titles and the reference titles.
  const refWords = new Set(reference.flatMap((r) => words(r)).filter((w) => !STOPWORDS.has(w)));
  let best = 0;
  const matchedWords: string[] = [];
  for (const t of titles) {
    const tw = words(t).filter((w) => !STOPWORDS.has(w));
    if (tw.length === 0) continue;
    const hits = tw.filter((w) => refWords.has(w));
    const ratio = hits.length / tw.length;
    if (ratio > best) {
      best = ratio;
      matchedWords.splice(0, matchedWords.length, ...hits);
    }
  }

  const penalty = unclear.length > 0 ? 12 : 0;
  return {
    key: 'title_relevance',
    label: 'Job title relevance',
    score: clamp(best * 100 - penalty),
    weight: 8,
    explanation: `Your closest title shares ${Math.round(best * 100)}% of its significant words with your target titles.`,
    evidence: matchedWords.length ? [`Matched: ${[...new Set(matchedWords)].join(', ')}`] : [],
  };
}

function scoreExperienceRelevance(
  resume: StructuredResume,
  ctx: AtsContext,
  findings: AtsFinding[],
): { signal: SignalResult; ambiguousDates: string[] } {
  const roles = resume.experience;
  const ambiguousDates: string[] = [];
  const evidence: string[] = [];

  let dated = 0;
  for (const r of roles) {
    const label = [r.title, r.company].filter(Boolean).join(' at ') || 'a role';
    if (r.startDate && (r.endDate || r.current)) {
      dated += 1;
      // A start with no year is ambiguous even if it looks complete.
      if (!/\d{4}/.test(r.startDate)) ambiguousDates.push(`${label}: start "${r.startDate}" has no year`);
      if (r.endDate && !/\d{4}/.test(r.endDate)) ambiguousDates.push(`${label}: end "${r.endDate}" has no year`);
    } else if (r.startDate || r.endDate) {
      ambiguousDates.push(`${label}: only one side of the date range was found`);
    } else {
      ambiguousDates.push(`${label}: no dates found`);
    }
  }

  for (const d of ambiguousDates) {
    findings.push({
      id: `dates_${d.slice(0, 40).toLowerCase().replace(/\W+/g, '_')}`,
      category: 'dates',
      priority: 'medium',
      title: 'Employment dates are unclear',
      detail: `${d}. Use an unambiguous "Mon YYYY – Mon YYYY" format; gaps and missing years get flagged by screeners.`,
    });
  }

  if (roles.length === 0) {
    return {
      signal: {
        key: 'experience_relevance',
        label: 'Experience depth',
        score: 0,
        weight: 10,
        explanation: 'No roles were found.',
        evidence: [],
      },
      ambiguousDates,
    };
  }

  let score = 0;
  const withBullets = roles.filter((r) => r.bullets.length >= 2).length;
  score += Math.round((withBullets / roles.length) * 45);
  evidence.push(`${withBullets} of ${roles.length} roles have two or more bullets`);

  score += Math.round((dated / roles.length) * 30);
  evidence.push(`${dated} of ${roles.length} roles have a complete date range`);

  const withTech = roles.filter((r) => r.technologies.length > 0 || r.bullets.some((b) => /[A-Z][a-z]*[A-Z]|\b(sql|api|aws|gcp|k8s)\b/i.test(b.text))).length;
  score += Math.round((withTech / roles.length) * 25);
  evidence.push(`${withTech} of ${roles.length} roles name specific technologies`);

  if (withBullets < roles.length) {
    findings.push({
      id: 'experience_thin_roles',
      category: 'impact',
      priority: 'high',
      title: `${roles.length - withBullets} role(s) have fewer than two bullets`,
      detail:
        'Each role needs at least two or three bullets describing what you actually built or changed. ' +
        'A title with no detail gives a reviewer nothing to assess.',
    });
  }

  if (ctx.yearsOfExperience !== undefined && roles.length > 0) {
    evidence.push(`${ctx.yearsOfExperience} years of experience declared in your profile`);
  }

  return {
    signal: {
      key: 'experience_relevance',
      label: 'Experience depth',
      score: clamp(score),
      weight: 10,
      explanation: 'Scores whether each role is dated, detailed with bullets, and names concrete technologies.',
      evidence,
    },
    ambiguousDates,
  };
}

function scoreAchievements(
  resume: StructuredResume,
  findings: AtsFinding[],
): { signal: SignalResult; missing: { path: string; text: string }[] } {
  const bullets = allBullets(resume);
  const missing: { path: string; text: string }[] = [];

  if (bullets.length === 0) {
    return {
      signal: {
        key: 'measurable_achievements',
        label: 'Measurable impact',
        score: 0,
        weight: 11,
        explanation: 'No bullets were found to assess.',
        evidence: [],
      },
      missing,
    };
  }

  const METRIC = /(\d+(?:\.\d+)?\s?%|\d+(?:\.\d+)?\s?x\b|[$₹€£]\s?\d|\b\d[\d,]{2,}\b|\b\d+(?:\.\d+)?\s?(?:k|m|mn|bn|lakh|crore)\b|\b\d+\s*(?:users|customers|clients|requests|transactions|engineers|developers|people|hours|days|weeks|months|services|endpoints|tables|queries)\b)/i;

  const quantified = bullets.filter(({ bullet }) => METRIC.test(bullet.text));
  for (const { bullet, path } of bullets) {
    if (!METRIC.test(bullet.text)) missing.push({ path, text: bullet.text });
  }

  const ratio = quantified.length / bullets.length;

  if (ratio < 0.3) {
    findings.push({
      id: 'impact_few_metrics',
      category: 'impact',
      priority: 'high',
      title: `Only ${quantified.length} of ${bullets.length} bullets contain a measurable outcome`,
      detail:
        'Add scale or result where you genuinely know it — throughput, latency, volume, team size, time saved. ' +
        'CareerPilot360 will not invent these numbers for you: supply the ones you can stand behind.',
    });
  }

  return {
    signal: {
      key: 'measurable_achievements',
      label: 'Measurable impact',
      score: clamp(ratio * 130), // ~77% quantified reaches full marks
      weight: 11,
      explanation: `${quantified.length} of ${bullets.length} bullets contain a number, scale or measurable result.`,
      evidence: quantified.slice(0, 5).map(({ bullet }) => bullet.text.slice(0, 90)),
    },
    missing,
  };
}

function scoreActionVerbs(
  resume: StructuredResume,
  findings: AtsFinding[],
): { signal: SignalResult; unsupportedClaims: AtsReport['unsupportedClaims'] } {
  const bullets = allBullets(resume);
  const unsupportedClaims: AtsReport['unsupportedClaims'] = [];

  if (bullets.length === 0) {
    return {
      signal: {
        key: 'action_verbs',
        label: 'Action language',
        score: 0,
        weight: 8,
        explanation: 'No bullets were found to assess.',
        evidence: [],
      },
      unsupportedClaims,
    };
  }

  let strong = 0;
  const weakFound: { path: string; text: string; phrase: string }[] = [];

  for (const { bullet, path } of bullets) {
    const lower = bullet.text.toLowerCase().trim();
    const firstWord = lower.split(/\s+/)[0]?.replace(/[^a-z]/g, '') ?? '';
    if (STRONG_ACTION_VERBS.has(firstWord)) strong += 1;

    const weak = WEAK_OPENINGS.find((w) => lower.startsWith(w) || lower.includes(` ${w} `));
    if (weak) weakFound.push({ path, text: bullet.text, phrase: weak });

    const claim = findVagueClaim(bullet.text);
    if (claim) {
      unsupportedClaims.push({
        path,
        text: bullet.text,
        reason: `This uses ${claim} in place of evidence. State what actually changed, or remove it.`,
      });
    }
  }

  // The summary is where empty self-description concentrates, so it is checked
  // too — not just the bullets.
  const summaryClaim = findVagueClaim(resume.summary);
  if (summaryClaim) {
    unsupportedClaims.push({
      path: 'summary',
      text: resume.summary,
      reason:
        `Your summary uses ${summaryClaim}. Reviewers discount this kind of phrasing; ` +
        'say what you have actually done instead.',
    });
  }

  for (const w of weakFound.slice(0, 12)) {
    findings.push({
      id: `verb_weak_${w.path.replace(/\W+/g, '_')}`,
      category: 'language',
      priority: 'medium',
      title: `"${w.phrase}" describes presence, not contribution`,
      detail:
        'Lead with what you did: designed, built, migrated, reduced, owned. ' +
        'This is a wording change only — it must not change what the bullet claims.',
      path: w.path,
      excerpt: w.text,
    });
  }

  for (const c of unsupportedClaims.slice(0, 10)) {
    findings.push({
      id: `claim_unsupported_${c.path.replace(/\W+/g, '_')}`,
      category: 'claims',
      priority: 'medium',
      title: 'Unsupported superlative',
      detail: c.reason,
      path: c.path,
      excerpt: c.text,
    });
  }

  const strongRatio = strong / bullets.length;
  const weakPenalty = Math.min(35, (weakFound.length / bullets.length) * 70);
  const claimPenalty = Math.min(20, unsupportedClaims.length * 5);

  return {
    signal: {
      key: 'action_verbs',
      label: 'Action language',
      score: clamp(strongRatio * 110 - weakPenalty - claimPenalty),
      weight: 8,
      explanation:
        `${strong} of ${bullets.length} bullets open with a strong action verb; ` +
        `${weakFound.length} use a weak opening and ${unsupportedClaims.length} contain an unsupported superlative.`,
      evidence: bullets
        .filter(({ bullet }) => STRONG_ACTION_VERBS.has(bullet.text.toLowerCase().split(/\s+/)[0]?.replace(/[^a-z]/g, '') ?? ''))
        .slice(0, 5)
        .map(({ bullet }) => bullet.text.slice(0, 80)),
    },
    unsupportedClaims,
  };
}

function scoreFormatting(resume: StructuredResume, plain: string, findings: AtsFinding[]): SignalResult {
  const evidence: string[] = [];
  let score = 100;

  // Date format consistency across roles.
  const formats = new Set<string>();
  for (const r of resume.experience) {
    for (const d of [r.startDate, r.endDate]) {
      if (!d) continue;
      if (/^[A-Za-z]{3,9}\.?\s+\d{4}$/.test(d)) formats.add('Month YYYY');
      else if (/^\d{4}$/.test(d)) formats.add('YYYY');
      else if (/^\d{1,2}[/.-]\d{4}$/.test(d)) formats.add('MM/YYYY');
      else if (/^[A-Za-z]{3}'?\d{2}$/.test(d)) formats.add("Mon'YY");
      else formats.add('other');
    }
  }
  if (formats.size > 1) {
    score -= 22;
    findings.push({
      id: 'format_date_inconsistent',
      category: 'formatting',
      priority: 'medium',
      title: 'Dates use more than one format',
      detail: `Found: ${[...formats].join(', ')}. Pick one format and use it everywhere — inconsistency is a common parser failure.`,
    });
  } else if (formats.size === 1) {
    evidence.push(`Consistent date format: ${[...formats][0]}`);
  }

  // Bullet length consistency.
  const bulletWordCounts = allBullets(resume).map(({ bullet }) => bullet.text.split(/\s+/).length);
  const overlong = bulletWordCounts.filter((n) => n > 45).length;
  if (overlong > 0) {
    score -= Math.min(20, overlong * 6);
    findings.push({
      id: 'format_long_bullets',
      category: 'formatting',
      priority: 'low',
      title: `${overlong} bullet(s) run past 45 words`,
      detail: 'Long bullets get skimmed past. Split them, or cut to the change you actually made.',
    });
  }

  // Characters that signal layout tricks or copy-paste damage.
  if (/[│┃┆┊╎▌▐■□▶►]/.test(plain)) {
    score -= 15;
    findings.push({
      id: 'format_box_drawing',
      category: 'parsing',
      priority: 'medium',
      title: 'Box-drawing or decorative characters found',
      detail: 'These usually come from tables or graphical layout, both of which extract unpredictably.',
    });
  }
  if (/\t/.test(plain)) {
    score -= 8;
    findings.push({
      id: 'format_tabs',
      category: 'formatting',
      priority: 'low',
      title: 'Tab characters found in the text',
      detail: 'Tabs are often used for column layout, which parsers read out of order.',
    });
  }

  const allCapsBullets = allBullets(resume).filter(
    ({ bullet }) => bullet.text.length > 20 && bullet.text === bullet.text.toUpperCase(),
  ).length;
  if (allCapsBullets > 0) {
    score -= 10;
    findings.push({
      id: 'format_all_caps',
      category: 'formatting',
      priority: 'low',
      title: `${allCapsBullets} bullet(s) are entirely in capitals`,
      detail: 'Full capitals reduce readability and are sometimes normalised away by parsers.',
    });
  }

  return {
    key: 'formatting_consistency',
    label: 'Formatting consistency',
    score: clamp(score),
    weight: 7,
    explanation: 'Checks date-format consistency, bullet length, and characters that signal fragile layout.',
    evidence,
  };
}

function scoreReadability(resume: StructuredResume, plain: string, findings: AtsFinding[]): SignalResult {
  const wordCount = words(plain).length;
  const bullets = allBullets(resume);
  const avgBullet = bullets.length
    ? bullets.reduce((n, { bullet }) => n + bullet.text.split(/\s+/).length, 0) / bullets.length
    : 0;

  const evidence = [`${wordCount} words`, bullets.length ? `average bullet ${Math.round(avgBullet)} words` : 'no bullets'];
  let score = 100;

  if (wordCount < 200) {
    score -= 40;
    findings.push({
      id: 'read_too_short',
      category: 'sections',
      priority: 'high',
      title: 'The resume is very short',
      detail: `About ${wordCount} words. Most reviewers expect 400–800 for an experienced candidate.`,
    });
  } else if (wordCount > 1200) {
    score -= 25;
    findings.push({
      id: 'read_too_long',
      category: 'sections',
      priority: 'medium',
      title: 'The resume is long',
      detail: `About ${wordCount} words. Cut to the roles and detail relevant to the jobs you are targeting.`,
    });
  }

  if (avgBullet > 32) {
    score -= 18;
  } else if (bullets.length > 0 && avgBullet < 8) {
    score -= 15;
    findings.push({
      id: 'read_terse_bullets',
      category: 'impact',
      priority: 'medium',
      title: 'Bullets are very short',
      detail: 'A bullet under about eight words rarely conveys what you did or why it mattered.',
    });
  }

  // Paragraph blocks in a summary are fine; in experience they parse poorly.
  const proseRoles = resume.experience.filter((r) => r.summary.length > 300 && r.bullets.length === 0).length;
  if (proseRoles > 0) {
    score -= 12;
    findings.push({
      id: 'read_prose_experience',
      category: 'formatting',
      priority: 'medium',
      title: `${proseRoles} role(s) use a paragraph instead of bullets`,
      detail: 'Bullets are scanned; paragraphs are skipped. Break the paragraph into three or four bullets.',
    });
  }

  return {
    key: 'readability',
    label: 'Readability',
    score: clamp(score),
    weight: 6,
    explanation: 'Scores overall length and bullet density against what reviewers actually read.',
    evidence,
  };
}

function scoreLocation(resume: StructuredResume, ctx: AtsContext): SignalResult {
  const resumeLocation = resume.contact.location.toLowerCase();
  const preferred = (ctx.preferredLocations ?? []).map((l) => l.toLowerCase()).filter(Boolean);

  if (!resumeLocation) {
    return {
      key: 'location_alignment',
      label: 'Location clarity',
      score: 0,
      weight: 4,
      explanation: 'No location is stated on the resume. Many filters and recruiters look for one.',
      evidence: [],
    };
  }
  if (preferred.length === 0) {
    return {
      key: 'location_alignment',
      label: 'Location clarity',
      score: 70,
      weight: 4,
      explanation: 'A location is stated. Add preferred locations to your profile to score alignment as well.',
      evidence: [resume.contact.location],
    };
  }

  const aligned = preferred.some((p) => {
    const token = p.split(/[,(]/)[0]!.trim();
    return token.length > 2 && (resumeLocation.includes(token) || token.includes(resumeLocation));
  });
  const remoteWanted = preferred.some((p) => p.includes('remote'));

  return {
    key: 'location_alignment',
    label: 'Location clarity',
    score: aligned || remoteWanted ? 100 : 55,
    weight: 4,
    explanation: aligned
      ? 'The location on your resume matches one of your preferred locations.'
      : remoteWanted
        ? 'You are open to remote work, so the stated location is less restrictive.'
        : 'The location on your resume does not match any of your preferred locations. That is fine, but be explicit about relocation.',
    evidence: [resume.contact.location],
  };
}

function scoreSeniority(resume: StructuredResume, ctx: AtsContext, findings: AtsFinding[]): SignalResult {
  const level = ctx.careerLevel;
  const titles = resume.experience.map((e) => e.title.toLowerCase()).filter(Boolean);

  if (!level || titles.length === 0) {
    return {
      key: 'seniority_alignment',
      label: 'Seniority signal',
      score: titles.length ? 60 : 0,
      weight: 5,
      explanation: level
        ? 'No job titles were found to compare against your stated career level.'
        : 'Add a career level to your profile to score seniority alignment.',
      evidence: [],
    };
  }

  const expected = SENIORITY_TERMS[level] ?? [];
  const matches = expected.filter((term) => titles.some((t) => mentions(t, term)));

  if (matches.length === 0 && expected.length > 0) {
    findings.push({
      id: 'seniority_mismatch',
      category: 'alignment',
      priority: 'low',
      title: `Your titles do not signal a ${level} level`,
      detail:
        `None of your titles contain a term a reviewer associates with "${level}" (${expected.join(', ')}). ` +
        'If your title understates your actual scope, say so in your summary rather than changing the title.',
    });
  }

  return {
    key: 'seniority_alignment',
    label: 'Seniority signal',
    score: matches.length > 0 ? 100 : 45,
    weight: 5,
    explanation:
      matches.length > 0
        ? `Your titles contain seniority terms consistent with "${level}": ${matches.join(', ')}.`
        : `Your titles do not contain a term typically associated with "${level}".`,
    evidence: titles.slice(0, 4),
  };
}

function scoreEducation(resume: StructuredResume, ctx: AtsContext): SignalResult {
  const hasEducation = resume.education.length > 0;
  const hasCerts = resume.certifications.length > 0;
  const complete = resume.education.filter((e) => e.degree && e.institution).length;
  const evidence: string[] = [];

  let score = 0;
  if (hasEducation) {
    score += 55;
    evidence.push(`${resume.education.length} education entr${resume.education.length === 1 ? 'y' : 'ies'}`);
    score += Math.round((complete / resume.education.length) * 25);
    if (complete < resume.education.length) evidence.push('some entries are missing a degree or institution');
  }
  if (hasCerts) {
    score += 20;
    evidence.push(`${resume.certifications.length} certification(s)`);
  }

  // Relevance against a job description, when one is present.
  if (ctx.jobDescription && hasEducation) {
    const jobLower = ctx.jobDescription.toLowerCase();
    const fields = resume.education.map((e) => e.field).filter(Boolean);
    if (fields.some((f) => mentions(jobLower, f))) {
      evidence.push('your field of study is named in the job description');
    }
  }

  return {
    key: 'education_relevance',
    label: 'Education & certifications',
    score: clamp(score),
    weight: 5,
    explanation: 'Scores whether education is present and complete, and whether certifications back it up.',
    evidence,
  };
}

function scoreParsing(resume: StructuredResume, plain: string, findings: AtsFinding[]): SignalResult {
  const evidence: string[] = [];
  let score = 100;

  if (!resume.contact.fullName || !resume.contact.email) {
    score -= 30;
  } else {
    evidence.push('Name and email were both extracted cleanly');
  }

  if (resume.experience.length === 0) {
    score -= 30;
  } else {
    evidence.push(`${resume.experience.length} role(s) extracted`);
  }

  if (resume.skills.length === 0) score -= 15;
  else evidence.push('Skills section extracted');

  if (resume.unparsedSections.length > 0) score -= Math.min(20, resume.unparsedSections.length * 8);

  // Words glued together are the classic sign of a PDF whose text layer is
  // damaged — a strong predictor that an ATS will mis-read it too.
  const glued = (plain.match(/[a-z]{2,}[A-Z][a-z]{2,}/g) ?? []).length;
  if (glued > 12) {
    score -= 18;
    findings.push({
      id: 'parse_glued_words',
      category: 'parsing',
      priority: 'high',
      title: 'Words appear to be running together',
      detail:
        `Found about ${glued} instances of joined words, which usually means the PDF's text layer is damaged ` +
        'or the file was exported from a design tool. Re-export from a word processor and check the text is selectable.',
    });
  }

  const roleCharsMissing = resume.experience.filter((r) => !r.title || !r.company).length;
  if (roleCharsMissing > 0) {
    score -= Math.min(20, roleCharsMissing * 7);
    findings.push({
      id: 'parse_incomplete_roles',
      category: 'parsing',
      priority: 'medium',
      title: `${roleCharsMissing} role(s) are missing a title or company after parsing`,
      detail:
        'Put the job title and company on the same line, separated by a comma or a dash, ' +
        'with the dates on that line or the next one.',
    });
  }

  return {
    key: 'parsing_compatibility',
    label: 'Parsing compatibility',
    score: clamp(score),
    weight: 8,
    explanation: 'How cleanly this document turned into structured data — a proxy for how an ATS will fare.',
    evidence,
  };
}

/* ------------------------------------------------------------------- entry */

/**
 * Score a resume. Deterministic: same input, same output, every time.
 */
export function analyzeResume(resume: StructuredResume, ctx: AtsContext = {}): AtsReport {
  const plain = resumeToPlainText(resume);
  const findings: AtsFinding[] = [];

  const contact = scoreContact(resume, findings);
  const sections = scoreSections(resume, findings);
  const { signal: keywordSignal, coverage } = scoreKeywords(resume, plain, ctx, findings);
  const skillClarity = scoreSkillClarity(resume, findings);
  const titleRelevance = scoreTitleRelevance(resume, ctx, findings);
  const { signal: experienceSignal, ambiguousDates } = scoreExperienceRelevance(resume, ctx, findings);
  const { signal: achievementSignal, missing: bulletsMissingMetrics } = scoreAchievements(resume, findings);
  const { signal: verbSignal, unsupportedClaims } = scoreActionVerbs(resume, findings);
  const formatting = scoreFormatting(resume, plain, findings);
  const readability = scoreReadability(resume, plain, findings);
  const location = scoreLocation(resume, ctx);
  const seniority = scoreSeniority(resume, ctx, findings);
  const education = scoreEducation(resume, ctx);
  const parsing = scoreParsing(resume, plain, findings);

  const signals: SignalResult[] = [
    contact,
    sections,
    keywordSignal,
    skillClarity,
    titleRelevance,
    experienceSignal,
    achievementSignal,
    verbSignal,
    formatting,
    readability,
    location,
    seniority,
    education,
    parsing,
  ];

  const totalWeight = signals.reduce((n, s) => n + s.weight, 0);
  const overallScore = clamp(signals.reduce((n, s) => n + s.score * s.weight, 0) / totalWeight);

  const strengths = signals
    .filter((s) => s.score >= 80)
    .sort((a, b) => b.weight * b.score - a.weight * a.score)
    .map((s) => `${s.label}: ${s.explanation}`);

  const bullets = allBullets(resume);
  const bulletWordCounts = bullets.map(({ bullet }) => bullet.text.split(/\s+/).length);
  const wordCount = words(plain).length;

  const unclearTitles = findings
    .filter((f) => f.category === 'alignment' && f.id.startsWith('title_unclear_'))
    .map((f) => f.excerpt ?? '')
    .filter(Boolean);

  // Highest-impact findings first: priority, then the weight of the signal
  // they relate to.
  const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.category.localeCompare(b.category));

  return {
    overallScore,
    scoreKind: 'heuristic',
    scoreExplanation:
      'A weighted mean of 14 signals, each scored 0–100 and explained below. This is CareerPilot360’s own ' +
      'heuristic, not the score a specific employer’s applicant tracking system will produce.',
    signals,
    strengths,
    findings,
    keywords: coverage,
    ambiguousDates,
    bulletsMissingMetrics,
    unclearTitles,
    unsupportedClaims,
    stats: {
      wordCount,
      bulletCount: bullets.length,
      averageBulletWords: bulletWordCounts.length
        ? Math.round(bulletWordCounts.reduce((a, b) => a + b, 0) / bulletWordCounts.length)
        : 0,
      longestBulletWords: bulletWordCounts.length ? Math.max(...bulletWordCounts) : 0,
      roleCount: resume.experience.length,
      skillCount: allTechnologies(resume).length,
      estimatedPages: Math.max(1, Math.ceil(wordCount / 500)),
    },
  };
}

/** Findings grouped by priority, for the analysis UI. */
export function groupFindings(report: AtsReport): Record<Priority, AtsFinding[]> {
  return {
    high: report.findings.filter((f) => f.priority === 'high'),
    medium: report.findings.filter((f) => f.priority === 'medium'),
    low: report.findings.filter((f) => f.priority === 'low'),
  };
}
