/**
 * Job matching. Pure, deterministic, unit-tested. No AI, no network.
 *
 * Two rules shape everything here:
 *
 * 1. NEVER INFER A SKILL. If the job asks for Kubernetes and the resume says
 *    Docker, that is a *transferable* signal, reported separately — it is never
 *    counted as having Kubernetes. `relatedTo` exists only to explain a gap,
 *    never to close one.
 *
 * 2. DISTINGUISH KINDS OF ABSENCE. The spec requires four distinct verdicts,
 *    and they are genuinely different for the user:
 *      missing_from_resume   they have it in their profile, but the resume omits it
 *      missing_from_profile  probably absent, but the profile is thin, so unsure
 *      not_present           they have a full profile and this is not in it
 *      unable_to_verify      the requirement is not a checkable claim
 *
 * Nothing here reads a protected characteristic. Age, gender, disability,
 * pronouns and date of birth are not inputs to any signal.
 */
import { allTechnologies, resumeToPlainText, type StructuredResume } from '@/lib/resume/types';
import type { FullProfile } from '@/lib/profile/types';
import { isKnownSkill } from './extract';
import type { JobWithSource } from './service';

/* ------------------------------------------------------------------ types -- */

export type GapKind = 'missing_from_resume' | 'missing_from_profile' | 'not_present' | 'unable_to_verify';

export const GAP_LABELS: Record<GapKind, string> = {
  missing_from_resume: 'Missing from the resume',
  missing_from_profile: 'Probably missing from your profile',
  not_present: 'Explicitly not present',
  unable_to_verify: 'Unable to verify',
};

export const GAP_EXPLANATIONS: Record<GapKind, string> = {
  missing_from_resume:
    'You list this in your profile but the resume does not mention it. Adding it to the resume is a real improvement.',
  missing_from_profile:
    'Neither your resume nor your profile mentions this, but your profile is still sparse — you may simply not have recorded it.',
  not_present:
    'Your profile is substantially complete and does not include this, so it is most likely a genuine gap.',
  unable_to_verify:
    'This requirement is not something that can be checked against a resume. Decide for yourself whether it applies.',
};

export type MatchSignalKey =
  | 'required_skills'
  | 'preferred_skills'
  | 'experience'
  | 'seniority'
  | 'location'
  | 'salary'
  | 'work_authorization'
  | 'education'
  | 'certifications'
  | 'notice_period';

export interface MatchSignal {
  key: MatchSignalKey;
  label: string;
  /** 0–100, or null when there is nothing to compare. */
  score: number | null;
  weight: number;
  explanation: string;
  /** What was actually compared, for the "why" panel. */
  evidence: string[];
}

export interface SkillGap {
  requirement: string;
  kind: GapKind;
  /** Skills the candidate does have that sit near this one. */
  relatedTo: string[];
  /**
   * Whether this represents a genuine capability gap.
   *
   * False for `missing_from_resume` (the candidate HAS the skill — the resume
   * simply omits it, which is a document fix, not a deficiency) and for
   * `unable_to_verify` (not a checkable claim). Both are still reported,
   * because both are actionable; neither reduces the score.
   */
  countsAgainstScore: boolean;
}

export interface TransferableSkill {
  candidateHas: string;
  jobWants: string;
  reason: string;
}

export interface MatchConcern {
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
}

export interface MatchResult {
  score: number;
  /** Always 'deterministic' unless an AI pass enriched the explanation. */
  mode: 'deterministic' | 'deterministic+ai';
  signals: MatchSignal[];
  matchedRequiredSkills: string[];
  matchedPreferredSkills: string[];
  gaps: SkillGap[];
  transferable: TransferableSkill[];
  concerns: MatchConcern[];
  /** Deterministic summary. An AI pass may replace this with richer prose. */
  explanation: string;
  /** Which of the user's resume versions best fits, by keyword overlap. */
  recommendedResumeVersionId: string | null;
}

/* ------------------------------------------------------- skill adjacency -- */

/**
 * Skills that sit near one another.
 *
 * Used ONLY to explain a gap ("you have Docker, they want Kubernetes"), never
 * to credit the candidate with something they did not claim. That distinction
 * is the whole point of keeping this separate from the match logic.
 */
const ADJACENT_SKILLS: Record<string, string[]> = {
  kubernetes: ['docker', 'helm', 'terraform', 'aws', 'gcp', 'azure'],
  docker: ['kubernetes', 'linux'],
  terraform: ['pulumi', 'ansible', 'aws', 'kubernetes'],
  postgresql: ['mysql', 'sql', 'mariadb', 'oracle', 'sqlite'],
  mysql: ['postgresql', 'sql', 'mariadb'],
  mongodb: ['dynamodb', 'cassandra', 'nosql'],
  kafka: ['rabbitmq', 'pulsar', 'sqs'],
  rabbitmq: ['kafka', 'sqs'],
  typescript: ['javascript'],
  javascript: ['typescript'],
  react: ['next.js', 'vue', 'angular', 'svelte'],
  'next.js': ['react'],
  vue: ['react', 'nuxt', 'angular'],
  angular: ['react', 'vue'],
  go: ['rust', 'java', 'c++'],
  java: ['kotlin', 'scala', 'go', 'c#'],
  kotlin: ['java', 'android'],
  python: ['ruby', 'javascript'],
  aws: ['gcp', 'azure'],
  gcp: ['aws', 'azure'],
  azure: ['aws', 'gcp'],
  graphql: ['rest', 'grpc', 'trpc'],
  rest: ['graphql', 'grpc'],
  pytorch: ['tensorflow', 'keras'],
  tensorflow: ['pytorch', 'keras'],
  jest: ['vitest', 'pytest', 'junit'],
  vitest: ['jest'],
  cypress: ['playwright', 'selenium'],
  playwright: ['cypress', 'selenium'],
};

function normaliseSkill(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function adjacentTo(skill: string, candidateSkills: Set<string>): string[] {
  const near = ADJACENT_SKILLS[normaliseSkill(skill)] ?? [];
  return near.filter((n) => candidateSkills.has(n));
}

/* ---------------------------------------------------------------- helpers -- */

function mentions(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9+#.])${escaped}([^A-Za-z0-9+#]|$)`, 'i').test(haystack);
}

const SENIORITY_RANK: Record<string, number> = {
  intern: 0,
  student: 0,
  entry: 1,
  junior: 1,
  mid: 2,
  senior: 3,
  lead: 4,
  principal: 5,
  manager: 4,
  director: 6,
  executive: 7,
};

/**
 * Requirements that cannot be verified from a resume.
 * Classifying these as gaps would be both wrong and discouraging.
 */
const UNVERIFIABLE_PATTERNS = [
  /\b(excellent|strong|good|effective)\s+(communication|interpersonal|collaboration|writing|verbal)\b/i,
  /\b(team player|self[\s-]starter|self[\s-]motivated|proactive|detail[\s-]oriented|fast[\s-]paced)\b/i,
  /\b(passion|passionate|enthusias|eager|curious|willingness|attitude|mindset|culture fit)\b/i,
  /\b(ability to|able to)\s+(work|learn|adapt|thrive|communicate|collaborate|manage)\b/i,
  /\b(bachelor|master|degree|b\.?tech|b\.?e\.?|m\.?tech|phd)\b/i, // handled by the education signal
  /\b(authoriz|authoris|visa|sponsor|work permit|eligible to work)\b/i, // handled by the authorisation signal
  /\b(years? of experience)\b/i, // handled by the experience signal
];

function isUnverifiable(requirement: string): boolean {
  return UNVERIFIABLE_PATTERNS.some((p) => p.test(requirement));
}

/**
 * Pull the concrete skill tokens out of a requirement line.
 * Only known vocabulary is returned, so prose does not become a fake skill.
 */
function skillsInRequirement(requirement: string, jobSkills: string[]): string[] {
  const found = jobSkills.filter((s) => mentions(requirement, s));
  return found.length > 0 ? found : [];
}

/* ------------------------------------------------------------------ signals */

interface Inputs {
  job: JobWithSource;
  resume: StructuredResume;
  profile: FullProfile;
}

function candidateSkillSet(inputs: Inputs): Set<string> {
  const set = new Set<string>();
  for (const s of allTechnologies(inputs.resume)) set.add(normaliseSkill(s));
  for (const s of inputs.profile.professional.skills ?? []) set.add(normaliseSkill(s));
  return set;
}

/** How complete is the profile? Drives `missing_from_profile` vs `not_present`. */
function profileIsSubstantial(profile: FullProfile): boolean {
  const skills = profile.professional.skills?.length ?? 0;
  const hasTitles = (profile.professional.targetTitles?.length ?? 0) > 0;
  const hasExperience = profile.professional.yearsOfExperience !== undefined;
  return skills >= 8 && hasTitles && hasExperience;
}

function scoreRequiredSkills(
  inputs: Inputs,
  candidateSkills: Set<string>,
): { signal: MatchSignal; matched: string[]; gaps: SkillGap[]; transferable: TransferableSkill[] } {
  const jobSkills = (inputs.job.skills as string[]) ?? [];
  const requirements = (inputs.job.requirements as string[]) ?? [];
  const resumeText = resumeToPlainText(inputs.resume);
  const substantial = profileIsSubstantial(inputs.profile);

  // The skill set the job actually asks for: named skills, plus any known
  // skill appearing inside a requirement line.
  const asked = new Set<string>(jobSkills.map(normaliseSkill));
  for (const req of requirements) {
    for (const s of skillsInRequirement(req, jobSkills)) asked.add(normaliseSkill(s));
  }

  const matched: string[] = [];
  const gaps: SkillGap[] = [];
  const transferable: TransferableSkill[] = [];

  const inProfileOnly: string[] = [];

  for (const skill of asked) {
    const inProfile = (inputs.profile.professional.skills ?? []).some((s) => normaliseSkill(s) === skill);
    const inResume = mentions(resumeText, skill);

    if (inResume) {
      matched.push(skill);
      continue;
    }

    if (inProfile) {
      // The candidate genuinely has this, so it counts toward the score — but
      // the resume is what a reviewer reads, so the omission is still reported.
      matched.push(skill);
      inProfileOnly.push(skill);
      gaps.push({
        requirement: skill,
        kind: 'missing_from_resume',
        relatedTo: [],
        countsAgainstScore: false,
      });
      continue;
    }

    // Absent from both. Work out WHY, without ever inferring the skill.
    const kind: GapKind = substantial ? 'not_present' : 'missing_from_profile';
    const related = adjacentTo(skill, candidateSkills);
    gaps.push({ requirement: skill, kind, relatedTo: related, countsAgainstScore: true });

    for (const near of related) {
      transferable.push({
        candidateHas: near,
        jobWants: skill,
        reason: `You have ${near}, which is adjacent to ${skill}. This is context for the gap, not a substitute for it.`,
      });
    }
  }

  // Unverifiable requirement lines are recorded so the user sees them, but they
  // never drag the score down.
  for (const req of requirements) {
    if (!isUnverifiable(req)) continue;
    if (skillsInRequirement(req, jobSkills).length > 0) continue;
    gaps.push({
      requirement: req.slice(0, 200),
      kind: 'unable_to_verify',
      relatedTo: [],
      countsAgainstScore: false,
    });
  }

  const checkable = asked.size;
  const score = checkable === 0 ? null : Math.round((matched.length / checkable) * 100);
  const resumeOnlyNote =
    inProfileOnly.length > 0
      ? ` ${inProfileOnly.length} of them appear only in your profile, not on this resume.`
      : '';

  return {
    signal: {
      key: 'required_skills',
      label: 'Required skills',
      score,
      weight: 30,
      explanation:
        checkable === 0
          ? 'This posting does not name specific technologies, so there is nothing to compare.'
          : `${matched.length} of ${checkable} named skills appear in your resume or profile.${resumeOnlyNote}`,
      evidence: matched.slice(0, 15),
    },
    matched,
    gaps,
    transferable,
  };
}

function scorePreferredSkills(
  inputs: Inputs,
  candidateSkills: Set<string>,
): { signal: MatchSignal; matched: string[] } {
  const preferred = (inputs.job.preferredQualifications as string[]) ?? [];
  const jobSkills = (inputs.job.skills as string[]) ?? [];

  const asked = new Set<string>();
  for (const line of preferred) {
    for (const s of skillsInRequirement(line, jobSkills)) asked.add(normaliseSkill(s));
  }

  if (asked.size === 0) {
    return {
      signal: {
        key: 'preferred_skills',
        label: 'Preferred skills',
        score: null,
        weight: 8,
        explanation: 'No specific preferred technologies were named.',
        evidence: [],
      },
      matched: [],
    };
  }

  const matched = [...asked].filter((s) => candidateSkills.has(s));
  return {
    signal: {
      key: 'preferred_skills',
      label: 'Preferred skills',
      score: Math.round((matched.length / asked.size) * 100),
      weight: 8,
      explanation: `${matched.length} of ${asked.size} preferred technologies appear in your material.`,
      evidence: matched,
    },
    matched,
  };
}

function scoreExperience(inputs: Inputs): { signal: MatchSignal; concerns: MatchConcern[] } {
  const required = inputs.job.experienceMinYears;
  const have = inputs.profile.professional.yearsOfExperience;
  const concerns: MatchConcern[] = [];

  if (required === null || required === undefined) {
    return {
      signal: {
        key: 'experience',
        label: 'Experience',
        score: null,
        weight: 15,
        explanation: 'This posting does not state a required number of years.',
        evidence: [],
      },
      concerns,
    };
  }
  if (have === undefined) {
    return {
      signal: {
        key: 'experience',
        label: 'Experience',
        score: null,
        weight: 15,
        explanation: `The posting asks for ${required}+ years. Add your years of experience to your profile to score this.`,
        evidence: [],
      },
      concerns,
    };
  }

  let score: number;
  if (have >= required) {
    // Being far over the stated minimum is not a negative, but it can signal a
    // level mismatch, which is reported as a concern rather than a deduction.
    score = 100;
    if (have >= required + 6) {
      concerns.push({
        severity: 'low',
        title: 'You may be over-levelled for this posting',
        detail: `You have ${have} years against a stated minimum of ${required}. Worth checking the seniority of the role.`,
      });
    }
  } else {
    const shortfall = required - have;
    score = Math.max(0, Math.round(100 - shortfall * 22));
    concerns.push({
      severity: shortfall >= 3 ? 'high' : 'medium',
      title: `${shortfall} year${shortfall === 1 ? '' : 's'} short of the stated minimum`,
      detail:
        `The posting asks for ${required}+ years and your profile says ${have}. ` +
        'Stated minimums are often flexible, but be ready to address it.',
    });
  }

  return {
    signal: {
      key: 'experience',
      label: 'Experience',
      score,
      weight: 15,
      explanation: `Posting asks for ${required}+ years; your profile says ${have}.`,
      evidence: [`Required: ${required}+`, `Yours: ${have}`],
    },
    concerns,
  };
}

function scoreSeniority(inputs: Inputs): { signal: MatchSignal; concerns: MatchConcern[] } {
  const jobLevel = inputs.job.seniority;
  const userLevel = inputs.profile.professional.careerLevel;
  const concerns: MatchConcern[] = [];

  if (!jobLevel || !userLevel) {
    return {
      signal: {
        key: 'seniority',
        label: 'Seniority',
        score: null,
        weight: 10,
        explanation: !jobLevel
          ? 'The posting does not clearly state a level.'
          : 'Add a career level to your profile to score seniority alignment.',
        evidence: [],
      },
      concerns,
    };
  }

  const jobRank = SENIORITY_RANK[jobLevel];
  const userRank = SENIORITY_RANK[userLevel];

  if (jobRank === undefined || userRank === undefined) {
    return {
      signal: {
        key: 'seniority',
        label: 'Seniority',
        score: null,
        weight: 10,
        explanation: 'One of the levels could not be interpreted.',
        evidence: [],
      },
      concerns,
    };
  }

  const distance = Math.abs(jobRank - userRank);
  const score = Math.max(0, 100 - distance * 30);

  if (jobRank - userRank >= 2) {
    concerns.push({
      severity: 'medium',
      title: 'This role is more senior than your stated level',
      detail: `The posting reads as ${jobLevel}; your profile says ${userLevel}.`,
    });
  } else if (userRank - jobRank >= 2) {
    concerns.push({
      severity: 'low',
      title: 'This role is more junior than your stated level',
      detail: `The posting reads as ${jobLevel}; your profile says ${userLevel}.`,
    });
  }

  return {
    signal: {
      key: 'seniority',
      label: 'Seniority',
      score,
      weight: 10,
      explanation: `Posting reads as ${jobLevel}; your profile says ${userLevel}.`,
      evidence: [`Posting: ${jobLevel}`, `Yours: ${userLevel}`],
    },
    concerns,
  };
}

function scoreLocation(inputs: Inputs): { signal: MatchSignal; concerns: MatchConcern[] } {
  const prefs = (inputs.profile.jobPreferences.preferredLocations ?? []).map((l) => l.toLowerCase());
  const wantsRemote = inputs.profile.jobPreferences.workMode === 'remote';
  const relocate = inputs.profile.jobPreferences.willingToRelocate === true;
  const concerns: MatchConcern[] = [];

  const location = (inputs.job.locationData ?? {}) as { raw?: string; city?: string; country?: string };
  const jobLocation = `${location.raw ?? ''} ${location.city ?? ''} ${location.country ?? ''}`.toLowerCase().trim();
  const jobMode = inputs.job.workMode ?? 'unknown';

  if (jobMode === 'remote') {
    return {
      signal: {
        key: 'location',
        label: 'Location',
        score: 100,
        weight: 12,
        explanation: 'This role is remote, so location is not a constraint.',
        evidence: ['Remote role'],
      },
      concerns,
    };
  }

  if (prefs.length === 0) {
    return {
      signal: {
        key: 'location',
        label: 'Location',
        score: null,
        weight: 12,
        explanation: 'Add preferred locations to your profile to score this.',
        evidence: jobLocation ? [jobLocation] : [],
      },
      concerns,
    };
  }
  if (!jobLocation) {
    return {
      signal: {
        key: 'location',
        label: 'Location',
        score: null,
        weight: 12,
        explanation: 'The posting does not state a location.',
        evidence: [],
      },
      concerns,
    };
  }

  const matched = prefs.some((p) => {
    const token = p.split(/[,(]/)[0]!.trim();
    return token.length > 2 && jobLocation.includes(token);
  });

  if (matched) {
    return {
      signal: {
        key: 'location',
        label: 'Location',
        score: 100,
        weight: 12,
        explanation: `The posting location matches one of your preferred locations.`,
        evidence: [jobLocation],
      },
      concerns,
    };
  }

  if (wantsRemote && jobMode !== 'remote') {
    concerns.push({
      severity: 'medium',
      title: 'You prefer remote work but this role is not remote',
      detail: `The posting is ${jobMode === 'unknown' ? 'not stated as remote' : jobMode}.`,
    });
  } else {
    concerns.push({
      severity: relocate ? 'low' : 'medium',
      title: 'The location is outside your preferences',
      detail: relocate
        ? `The role is in ${jobLocation}. You are open to relocation, so this may still work.`
        : `The role is in ${jobLocation}, which is not on your list and you have not marked yourself open to relocating.`,
    });
  }

  return {
    signal: {
      key: 'location',
      label: 'Location',
      score: relocate ? 60 : 30,
      weight: 12,
      explanation: `The posting is in ${jobLocation}, which is not among your preferred locations.`,
      evidence: [jobLocation],
    },
    concerns,
  };
}

function scoreSalary(inputs: Inputs): { signal: MatchSignal; concerns: MatchConcern[] } {
  const salary = (inputs.job.salaryData ?? {}) as {
    min?: number | null;
    max?: number | null;
    currency?: string | null;
  };
  const wantMin = inputs.profile.jobPreferences.minExpectedCtc;
  const userCurrency = inputs.profile.jobPreferences.currency;
  const concerns: MatchConcern[] = [];

  if (wantMin === undefined) {
    return {
      signal: {
        key: 'salary',
        label: 'Compensation',
        score: null,
        weight: 10,
        explanation: 'Add a minimum expected CTC to your profile to score this.',
        evidence: [],
      },
      concerns,
    };
  }
  if (!salary.min && !salary.max) {
    return {
      signal: {
        key: 'salary',
        label: 'Compensation',
        score: null,
        weight: 10,
        explanation: 'This posting does not state a salary, which is common. Nothing to compare.',
        evidence: [],
      },
      concerns,
    };
  }

  // Comparing across currencies would require a rate we do not have, and a
  // wrong comparison is worse than none.
  if (salary.currency && userCurrency && salary.currency !== userCurrency) {
    return {
      signal: {
        key: 'salary',
        label: 'Compensation',
        score: null,
        weight: 10,
        explanation:
          `The posting quotes ${salary.currency} and your expectation is in ${userCurrency}. ` +
          'No conversion is applied, so this is not scored.',
        evidence: [],
      },
      concerns,
    };
  }

  const offered = salary.max ?? salary.min ?? 0;
  if (offered >= wantMin) {
    return {
      signal: {
        key: 'salary',
        label: 'Compensation',
        score: 100,
        weight: 10,
        explanation: 'The stated range reaches or exceeds your minimum.',
        evidence: [`Posting up to ${offered}`, `Your minimum ${wantMin}`],
      },
      concerns,
    };
  }

  const ratio = offered / wantMin;
  concerns.push({
    severity: ratio < 0.8 ? 'high' : 'medium',
    title: 'The stated range is below your minimum',
    detail: `The posting tops out around ${offered} against your stated minimum of ${wantMin}.`,
  });

  return {
    signal: {
      key: 'salary',
      label: 'Compensation',
      score: Math.max(0, Math.round(ratio * 100)),
      weight: 10,
      explanation: `The posting tops out at ${offered}; your minimum is ${wantMin}.`,
      evidence: [`Posting up to ${offered}`, `Your minimum ${wantMin}`],
    },
    concerns,
  };
}

function scoreAuthorization(inputs: Inputs): { signal: MatchSignal; concerns: MatchConcern[] } {
  const needsSponsorship = inputs.profile.jobPreferences.needsVisaSponsorship === true;
  const sponsorship = inputs.job.visaSponsorship ?? 'unknown';
  const concerns: MatchConcern[] = [];

  if (!needsSponsorship) {
    return {
      signal: {
        key: 'work_authorization',
        label: 'Work authorisation',
        score: 100,
        weight: 8,
        explanation: 'You do not require sponsorship, so this is not a constraint.',
        evidence: [],
      },
      concerns,
    };
  }

  if (sponsorship === 'no') {
    concerns.push({
      severity: 'high',
      title: 'This posting states it does not sponsor visas',
      detail: 'You have indicated you need sponsorship. This is likely a hard blocker.',
    });
    return {
      signal: {
        key: 'work_authorization',
        label: 'Work authorisation',
        score: 0,
        weight: 8,
        explanation: 'The posting explicitly states no sponsorship, and you need it.',
        evidence: ['Posting: no sponsorship'],
      },
      concerns,
    };
  }

  if (sponsorship === 'yes') {
    return {
      signal: {
        key: 'work_authorization',
        label: 'Work authorisation',
        score: 100,
        weight: 8,
        explanation: 'The posting states sponsorship is available.',
        evidence: ['Posting: sponsorship available'],
      },
      concerns,
    };
  }

  concerns.push({
    severity: 'medium',
    title: 'Sponsorship is not addressed in the posting',
    detail: 'You need sponsorship and the posting says nothing either way. Worth asking before investing time.',
  });
  return {
    signal: {
      key: 'work_authorization',
      label: 'Work authorisation',
      score: null,
      weight: 8,
      explanation: 'The posting does not mention sponsorship, so this cannot be scored.',
      evidence: [],
    },
    concerns,
  };
}

function scoreEducation(inputs: Inputs): MatchSignal {
  const description = `${inputs.job.description}\n${((inputs.job.requirements as string[]) ?? []).join('\n')}`;
  const wantsDegree = /\b(bachelor|master|b\.?tech|b\.?e\.?\b|b\.?sc|m\.?tech|m\.?sc|mba|phd|degree)\b/i.test(
    description,
  );

  if (!wantsDegree) {
    return {
      key: 'education',
      label: 'Education',
      score: null,
      weight: 5,
      explanation: 'The posting does not state an education requirement.',
      evidence: [],
    };
  }

  const hasEducation =
    inputs.resume.education.length > 0 || (inputs.profile.professional.education?.length ?? 0) > 0;

  return {
    key: 'education',
    label: 'Education',
    score: hasEducation ? 100 : 0,
    weight: 5,
    explanation: hasEducation
      ? 'The posting mentions a degree requirement and your record includes education.'
      : 'The posting mentions a degree requirement and no education is recorded.',
    evidence: hasEducation
      ? inputs.resume.education.slice(0, 2).map((e) => [e.degree, e.field].filter(Boolean).join(' '))
      : [],
  };
}

function scoreCertifications(inputs: Inputs): MatchSignal {
  const description = inputs.job.description.toLowerCase();
  const held = [
    ...inputs.resume.certifications.map((c) => c.name),
    ...(inputs.profile.professional.certifications ?? []).map((c) => c.name ?? ''),
  ].filter(Boolean);

  if (!/\b(certifica|certified|credential)\b/i.test(description)) {
    return {
      key: 'certifications',
      label: 'Certifications',
      score: null,
      weight: 4,
      explanation: 'The posting does not ask for certifications.',
      evidence: [],
    };
  }

  const matched = held.filter((c) => {
    const tokens = c.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
    return tokens.some((t) => description.includes(t));
  });

  return {
    key: 'certifications',
    label: 'Certifications',
    score: held.length === 0 ? 0 : matched.length > 0 ? 100 : 50,
    weight: 4,
    explanation:
      held.length === 0
        ? 'The posting mentions certifications and none are recorded.'
        : matched.length > 0
          ? `You hold a certification the posting names: ${matched.join(', ')}.`
          : 'You hold certifications, though none obviously match what the posting names.',
    evidence: matched.length > 0 ? matched : held.slice(0, 3),
  };
}

function scoreNoticePeriod(inputs: Inputs): { signal: MatchSignal; concerns: MatchConcern[] } {
  const notice = inputs.profile.jobPreferences.noticePeriodDays;
  const description = inputs.job.description;
  const concerns: MatchConcern[] = [];

  const urgent = /\b(immediate joiner|immediately available|start immediately|asap|urgent(?:ly)? (?:hiring|required)|within \d{1,2} days)\b/i.test(
    description,
  );

  if (notice === undefined) {
    return {
      signal: {
        key: 'notice_period',
        label: 'Notice period',
        score: null,
        weight: 3,
        explanation: 'Add your notice period to your profile to score this.',
        evidence: [],
      },
      concerns,
    };
  }
  if (!urgent) {
    return {
      signal: {
        key: 'notice_period',
        label: 'Notice period',
        score: null,
        weight: 3,
        explanation: 'The posting does not state an urgency, so your notice period is unlikely to be an issue.',
        evidence: [`Your notice: ${notice} days`],
      },
      concerns,
    };
  }

  if (notice > 30) {
    concerns.push({
      severity: notice > 60 ? 'medium' : 'low',
      title: 'The posting asks for an immediate start',
      detail: `Your notice period is ${notice} days. Worth addressing directly in your application.`,
    });
  }

  return {
    signal: {
      key: 'notice_period',
      label: 'Notice period',
      score: notice <= 30 ? 100 : notice <= 60 ? 60 : 30,
      weight: 3,
      explanation: `The posting suggests an immediate start; your notice period is ${notice} days.`,
      evidence: [`Your notice: ${notice} days`],
    },
    concerns,
  };
}

/* ------------------------------------------------------------------- entry */

export interface MatchInput {
  job: JobWithSource;
  resume: StructuredResume;
  profile: FullProfile;
  /** Candidate resume versions, for the recommendation. */
  resumeVersions?: { id: string; name: string; plainText: string }[];
}

/**
 * Score one job against one candidate. Deterministic and explainable.
 *
 * Signals with nothing to compare score `null` and are excluded from the
 * weighted mean rather than counted as zero — a posting that omits a salary
 * should not be penalised for it.
 */
export function matchJob(input: MatchInput): MatchResult {
  const inputs: Inputs = { job: input.job, resume: input.resume, profile: input.profile };
  const candidateSkills = candidateSkillSet(inputs);

  const required = scoreRequiredSkills(inputs, candidateSkills);
  const preferred = scorePreferredSkills(inputs, candidateSkills);
  const experience = scoreExperience(inputs);
  const seniority = scoreSeniority(inputs);
  const location = scoreLocation(inputs);
  const salary = scoreSalary(inputs);
  const authorization = scoreAuthorization(inputs);
  const education = scoreEducation(inputs);
  const certifications = scoreCertifications(inputs);
  const notice = scoreNoticePeriod(inputs);

  const signals: MatchSignal[] = [
    required.signal,
    preferred.signal,
    experience.signal,
    seniority.signal,
    location.signal,
    salary.signal,
    authorization.signal,
    education,
    certifications,
    notice.signal,
  ];

  const scored = signals.filter((s): s is MatchSignal & { score: number } => s.score !== null);
  const totalWeight = scored.reduce((n, s) => n + s.weight, 0);
  const score = totalWeight === 0 ? 0 : Math.round(scored.reduce((n, s) => n + s.score * s.weight, 0) / totalWeight);

  const concerns = [
    ...experience.concerns,
    ...seniority.concerns,
    ...location.concerns,
    ...salary.concerns,
    ...authorization.concerns,
    ...notice.concerns,
  ].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 } as const;
    return rank[a.severity] - rank[b.severity];
  });

  // Deduplicate transferable pairs.
  const seenTransfer = new Set<string>();
  const transferable = required.transferable.filter((t) => {
    const key = `${t.candidateHas}->${t.jobWants}`;
    if (seenTransfer.has(key)) return false;
    seenTransfer.add(key);
    return true;
  });

  return {
    score,
    mode: 'deterministic',
    signals,
    matchedRequiredSkills: required.matched,
    matchedPreferredSkills: preferred.matched,
    gaps: required.gaps,
    transferable,
    concerns,
    explanation: buildExplanation(score, required, concerns, scored.length, signals.length),
    recommendedResumeVersionId: recommendVersion(input),
  };
}

function buildExplanation(
  score: number,
  required: { matched: string[]; gaps: SkillGap[] },
  concerns: MatchConcern[],
  scoredCount: number,
  totalCount: number,
): string {
  const realGaps = required.gaps.filter((g) => g.countsAgainstScore);
  const omissions = required.gaps.filter((g) => g.kind === 'missing_from_resume');
  const parts: string[] = [];

  parts.push(
    score >= 80
      ? 'Strong match on the signals that could be checked.'
      : score >= 60
        ? 'Reasonable match, with some gaps worth reading.'
        : score >= 40
          ? 'Partial match. Several requirements are not evidenced.'
          : 'Weak match on the checkable signals.',
  );

  if (required.matched.length > 0) {
    parts.push(`You evidence ${required.matched.length} of the named skills.`);
  }
  if (realGaps.length > 0) {
    parts.push(`${realGaps.length} named requirement${realGaps.length === 1 ? '' : 's'} not evidenced.`);
  }
  if (omissions.length > 0) {
    parts.push(
      `${omissions.length} skill${omissions.length === 1 ? ' you have is' : 's you have are'} missing from this resume — worth adding.`,
    );
  }
  if (concerns.some((c) => c.severity === 'high')) {
    parts.push('There is at least one high-severity concern below.');
  }
  if (scoredCount < totalCount) {
    parts.push(
      `${totalCount - scoredCount} of ${totalCount} signals had nothing to compare and were excluded rather than counted as zero.`,
    );
  }

  return parts.join(' ');
}

/**
 * Recommend the resume version with the strongest keyword overlap.
 * Purely lexical, so it is explainable and needs no embeddings.
 */
function recommendVersion(input: MatchInput): string | null {
  const versions = input.resumeVersions ?? [];
  if (versions.length === 0) return null;

  const jobSkills = ((input.job.skills as string[]) ?? []).map(normaliseSkill);
  if (jobSkills.length === 0) return versions[0]?.id ?? null;

  let bestId: string | null = null;
  let bestScore = -1;

  for (const version of versions) {
    const text = version.plainText.toLowerCase();
    const hits = jobSkills.filter((s) => mentions(text, s)).length;
    if (hits > bestScore) {
      bestScore = hits;
      bestId = version.id;
    }
  }

  return bestId;
}

/**
 * Only the gaps that represent a real capability deficiency.
 * Excludes resume omissions (the candidate has the skill) and unverifiable
 * requirements (not a checkable claim).
 */
export function realGaps(result: MatchResult): SkillGap[] {
  return result.gaps.filter((g) => g.countsAgainstScore);
}

/** Skills the candidate has in their profile but omitted from this resume. */
export function resumeOmissions(result: MatchResult): SkillGap[] {
  return result.gaps.filter((g) => g.kind === 'missing_from_resume');
}

export function isKnownSkillToken(value: string): boolean {
  return isKnownSkill(value);
}
