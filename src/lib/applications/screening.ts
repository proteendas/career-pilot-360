/**
 * Screening-question classification and safe-answer resolution.
 *
 * This is the enforcement point for one of the product's hardest rules: salary,
 * work authorisation, criminal history, disability, gender, age, relocation and
 * notice period must NEVER be auto-answered unless the exact answer already
 * exists in the user's profile AND the user has explicitly permitted reuse.
 *
 * Everything here is deterministic pattern matching over the question text —
 * no AI is involved in deciding whether a question is sensitive, because that
 * decision must be reliable, not merely probable.
 */
import type { FullProfile } from '@/lib/profile/types';

export type SensitiveCategory =
  | 'salary'
  | 'work_authorization'
  | 'criminal_history'
  | 'disability'
  | 'gender'
  | 'age'
  | 'relocation'
  | 'notice_period';

const SENSITIVE_PATTERNS: [SensitiveCategory, RegExp][] = [
  [
    'salary',
    /\b(salary|compensation|ctc|expected pay|pay expectation|remuneration|desired (?:salary|compensation))\b/i,
  ],
  [
    'work_authorization',
    /\b(work authoriz|work authoris|visa|sponsor|right to work|eligible to work|work permit|citizenship)\b/i,
  ],
  ['criminal_history', /\b(criminal|felony|convict|background check|arrest record|offence|offense)\b/i],
  ['disability', /\b(disability|disabled|accommodat(?:e|ion)|impairment)\b/i],
  ['gender', /\b(gender|sex\b|pronoun)\b/i],
  ['age', /\b(date of birth|\bdob\b|how old are you|your age\b)\b/i],
  ['relocation', /\b(reloca|willing to move|move to|relocation assistance)\b/i],
  ['notice_period', /\b(notice period|when can you (?:start|join)|earliest (?:start|join) date|availability to join)\b/i],
];

export function classifySensitive(question: string): SensitiveCategory | null {
  for (const [category, pattern] of SENSITIVE_PATTERNS) {
    if (pattern.test(question)) return category;
  }
  return null;
}

export interface ScreeningAnswer {
  question: string;
  answer: string;
  /** Whether this needs the user to fill it in themselves. */
  needsUserInput: boolean;
  /** Why it does or does not have an answer. */
  reason: string;
  category: SensitiveCategory | null;
  /** What the answer, if any, is traceable to. */
  source: 'profile_custom_answer' | 'profile_field' | 'ai_grounded' | 'none';
}

/** Look up a reusable custom answer the user wrote for this exact question. */
function findCustomAnswer(
  question: string,
  profile: FullProfile,
): { answer: string; allowed: boolean } | null {
  const needle = question.trim().toLowerCase();
  const match = (profile.applicationProfile.customAnswers ?? []).find(
    (a) => a.question.trim().toLowerCase() === needle,
  );
  if (!match) return null;
  return { answer: match.answer, allowed: match.allowReuse !== false };
}

/**
 * Resolve one screening question deterministically.
 *
 * Order of resolution:
 *   1. A custom answer the user wrote for this exact question — always usable,
 *      because writing it was itself the user's explicit act of authorship.
 *   2. A sensitive-category question — usable ONLY if the profile has the
 *      field AND `allowSensitiveAnswerReuse` is true.
 *   3. Ordinary non-sensitive fields the profile already states.
 *   4. Otherwise: needs user input. Never guessed, never left blank silently.
 */
export function resolveScreeningQuestion(question: string, profile: FullProfile): ScreeningAnswer {
  const custom = findCustomAnswer(question, profile);
  if (custom?.allowed) {
    return {
      question,
      answer: custom.answer,
      needsUserInput: false,
      reason: 'Your own saved answer for this exact question.',
      category: classifySensitive(question),
      source: 'profile_custom_answer',
    };
  }

  const category = classifySensitive(question);

  if (category) {
    const reuseAllowed = profile.applicationProfile.allowSensitiveAnswerReuse === true;
    const fieldAnswer = sensitiveFieldAnswer(category, profile);

    if (reuseAllowed && fieldAnswer) {
      return {
        question,
        answer: fieldAnswer,
        needsUserInput: false,
        reason: 'Reused from your profile because you explicitly allowed reuse for sensitive questions.',
        category,
        source: 'profile_field',
      };
    }

    return {
      question,
      answer: '',
      needsUserInput: true,
      reason: reuseAllowed
        ? 'This is a sensitive question and your profile does not have an answer for it.'
        : 'This is a sensitive question (salary, work authorisation, criminal history, disability, gender, age, ' +
          'relocation or notice period). It is never auto-answered unless you explicitly allow reuse in your ' +
          'profile settings.',
      category,
      source: 'none',
    };
  }

  // Non-sensitive: allow simple, literal profile lookups only.
  const plain = plainFieldAnswer(question, profile);
  if (plain) {
    return {
      question,
      answer: plain,
      needsUserInput: false,
      reason: 'Taken directly from your profile.',
      category: null,
      source: 'profile_field',
    };
  }

  return {
    question,
    answer: '',
    needsUserInput: true,
    reason: 'No matching information was found in your profile or saved answers.',
    category: null,
    source: 'none',
  };
}

function sensitiveFieldAnswer(category: SensitiveCategory, profile: FullProfile): string | null {
  switch (category) {
    case 'salary': {
      const min = profile.jobPreferences.minExpectedCtc;
      if (min === undefined) return null;
      const max = profile.jobPreferences.maxExpectedCtc;
      const currency = profile.jobPreferences.currency ?? '';
      const base = max ? `${min}–${max} ${currency}`.trim() : `${min} ${currency}`.trim();
      return profile.applicationProfile.salaryExplanation
        ? `${base}. ${profile.applicationProfile.salaryExplanation}`
        : base;
    }
    case 'work_authorization': {
      const auth = profile.jobPreferences.workAuthorization;
      if (!auth) return null;
      const sponsorship = profile.jobPreferences.needsVisaSponsorship
        ? ' I will require visa sponsorship.'
        : ' I do not require visa sponsorship.';
      return `${authLabel(auth)}.${sponsorship}`;
    }
    case 'notice_period': {
      const days = profile.jobPreferences.noticePeriodDays;
      if (days === undefined) return null;
      return profile.applicationProfile.noticePeriodExplanation
        ? `${days} days. ${profile.applicationProfile.noticePeriodExplanation}`
        : `${days} days.`;
    }
    case 'relocation': {
      if (profile.jobPreferences.willingToRelocate === undefined) return null;
      const base = profile.jobPreferences.willingToRelocate ? 'Yes, I am open to relocating.' : 'No, I am not open to relocating at this time.';
      return profile.applicationProfile.relocationExplanation
        ? `${base} ${profile.applicationProfile.relocationExplanation}`
        : base;
    }
    // These categories are never resolved from a structured field — only from
    // a custom answer the user wrote, or left for the user.
    case 'criminal_history':
    case 'disability':
    case 'gender':
    case 'age':
      return null;
    default:
      return null;
  }
}

function authLabel(value: string): string {
  const labels: Record<string, string> = {
    citizen: 'I am a citizen and authorised to work',
    permanent_resident: 'I am a permanent resident and authorised to work',
    work_visa_held: 'I hold a valid work visa',
    needs_sponsorship: 'I will need visa sponsorship to work',
    student_visa: 'I hold a student visa',
    other: 'My work authorisation status requires explanation',
  };
  return labels[value] ?? value;
}

/** Literal, low-risk lookups for common non-sensitive screening questions. */
function plainFieldAnswer(question: string, profile: FullProfile): string | null {
  const q = question.toLowerCase();

  if (/\b(linkedin)\b/.test(q) && profile.professional.linkedinUrl) return profile.professional.linkedinUrl;
  if (/\b(github)\b/.test(q) && profile.professional.githubUrl) return profile.professional.githubUrl;
  if (/\b(portfolio|website)\b/.test(q) && (profile.professional.portfolioUrl || profile.professional.websiteUrl)) {
    return profile.professional.portfolioUrl || profile.professional.websiteUrl || null;
  }
  if (/\byears? of experience\b/.test(q) && profile.professional.yearsOfExperience !== undefined) {
    return String(profile.professional.yearsOfExperience);
  }
  if (/\bcurrent (?:job )?title\b|\bcurrent role\b/.test(q) && profile.professional.currentTitle) {
    return profile.professional.currentTitle;
  }
  if (/\bcurrent (?:company|employer)\b/.test(q) && profile.professional.currentCompany) {
    return profile.professional.currentCompany;
  }
  if (/\bcurrent(?:ly)? (?:based|located|residing)\b|\bcurrent location\b|\bcity\b/.test(q) && profile.personal.city) {
    return [profile.personal.city, profile.personal.country].filter(Boolean).join(', ');
  }
  if (/\bwork(?:ing)? mode\b|\bremote\b.*\bhybrid\b|\bonsite\b/.test(q) && profile.jobPreferences.workMode) {
    return profile.jobPreferences.workMode;
  }

  return null;
}

/** Resolve every screening question in a batch. */
export function resolveScreeningQuestions(questions: string[], profile: FullProfile): ScreeningAnswer[] {
  return questions.map((q) => resolveScreeningQuestion(q, profile));
}

export const SENSITIVE_CATEGORY_LABELS: Record<SensitiveCategory, string> = {
  salary: 'Salary expectations',
  work_authorization: 'Work authorisation',
  criminal_history: 'Criminal history',
  disability: 'Disability',
  gender: 'Gender',
  age: 'Age',
  relocation: 'Relocation',
  notice_period: 'Notice period',
};
