/**
 * Profile schemas — the single source of truth for onboarding, the profile
 * editor, the matching engine and the assistant's `updateUserProfile` tool.
 *
 * Everything is optional at the schema level so a partially-filled profile is
 * always valid and always savable. "Required for X" is a product concern,
 * expressed by `profileCompleteness()` and by the missing-information warnings
 * on the packet, never by a validation error that blocks saving.
 *
 * Sensitive demographic fields are never required, and are stored only when the
 * user volunteers them.
 */
import { z } from 'zod';

/* ------------------------------------------------------------- primitives -- */

const shortText = z.string().trim().max(200);
const mediumText = z.string().trim().max(1000);
const longText = z.string().trim().max(5000);

/** Accepts a bare domain or a full URL; normalised to https on the way in. */
const urlish = z
  .string()
  .trim()
  .max(500)
  .transform((v) => {
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    return `https://${v}`;
  })
  .refine((v) => v === '' || /^https?:\/\/[^\s.]+\.[^\s]+$/.test(v), 'Enter a valid URL.');

export const WORK_MODES = ['remote', 'hybrid', 'onsite', 'any'] as const;
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'internship', 'temporary'] as const;
export const CAREER_LEVELS = [
  'student',
  'entry',
  'junior',
  'mid',
  'senior',
  'lead',
  'principal',
  'manager',
  'director',
  'executive',
] as const;
export const COMPANY_SIZES = ['startup', 'small', 'mid_market', 'large', 'enterprise'] as const;
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD'] as const;
export const WORK_AUTH = [
  'citizen',
  'permanent_resident',
  'work_visa_held',
  'needs_sponsorship',
  'student_visa',
  'other',
] as const;
export const SCHEDULE_EXPRESSIONS = ['hourly', 'daily', 'weekdays', 'weekly'] as const;

export type WorkMode = (typeof WORK_MODES)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export type CareerLevel = (typeof CAREER_LEVELS)[number];

/* ---------------------------------------------------------------- personal -- */

export const personalSchema = z.object({
  fullName: shortText.optional().default(''),
  preferredName: shortText.optional().default(''),
  email: z.string().trim().max(254).optional().default(''),
  phone: z
    .string()
    .trim()
    .max(32)
    .optional()
    .default('')
    .refine((v) => !v || /^[+()\-\s\d]{6,32}$/.test(v), 'Enter a valid phone number.'),
  country: shortText.optional().default(''),
  city: shortText.optional().default(''),
  timezone: shortText.optional().default(''),
  photoUrl: urlish.optional().default(''),
});

export type ProfilePersonal = z.infer<typeof personalSchema>;

/* ------------------------------------------------------------ professional -- */

export const educationEntrySchema = z.object({
  id: z.string().max(64).optional(),
  degree: shortText.optional().default(''),
  field: shortText.optional().default(''),
  institution: shortText.optional().default(''),
  startYear: shortText.optional().default(''),
  endYear: shortText.optional().default(''),
  grade: shortText.optional().default(''),
});

export const certificationEntrySchema = z.object({
  id: z.string().max(64).optional(),
  name: shortText.optional().default(''),
  issuer: shortText.optional().default(''),
  year: shortText.optional().default(''),
  credentialId: shortText.optional().default(''),
});

export const professionalSchema = z.object({
  currentTitle: shortText.optional().default(''),
  currentCompany: shortText.optional().default(''),
  targetTitles: z.array(shortText).max(20).optional().default([]),
  yearsOfExperience: z.number().min(0).max(60).optional(),
  careerLevel: z.enum(CAREER_LEVELS).optional(),
  preferredIndustries: z.array(shortText).max(20).optional().default([]),
  preferredCompanySizes: z.array(z.enum(COMPANY_SIZES)).max(5).optional().default([]),
  preferredEmploymentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(5).optional().default([]),
  skills: z.array(shortText).max(150).optional().default([]),
  certifications: z.array(certificationEntrySchema).max(40).optional().default([]),
  education: z.array(educationEntrySchema).max(20).optional().default([]),
  portfolioUrl: urlish.optional().default(''),
  githubUrl: urlish.optional().default(''),
  linkedinUrl: urlish.optional().default(''),
  websiteUrl: urlish.optional().default(''),
  professionalSummary: longText.optional().default(''),
});

export type ProfileProfessional = z.infer<typeof professionalSchema>;

/* --------------------------------------------------------- job preferences -- */

export const jobPreferencesSchema = z.object({
  preferredRoles: z.array(shortText).max(20).optional().default([]),
  preferredLocations: z.array(shortText).max(20).optional().default([]),
  workMode: z.enum(WORK_MODES).optional().default('any'),
  willingToRelocate: z.boolean().optional().default(false),
  currency: z.enum(CURRENCIES).optional().default('INR'),
  currentCtc: z.number().min(0).max(1_000_000_000).optional(),
  minExpectedCtc: z.number().min(0).max(1_000_000_000).optional(),
  maxExpectedCtc: z.number().min(0).max(1_000_000_000).optional(),
  noticePeriodDays: z.number().min(0).max(365).optional(),
  availabilityDate: shortText.optional().default(''),
  workAuthorization: z.enum(WORK_AUTH).optional(),
  needsVisaSponsorship: z.boolean().optional().default(false),
  employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(5).optional().default([]),
  preferredCompanies: z.array(shortText).max(50).optional().default([]),
  excludedCompanies: z.array(shortText).max(50).optional().default([]),
  preferredIndustries: z.array(shortText).max(20).optional().default([]),
  minMatchScore: z.number().min(0).max(100).optional().default(60),
  maxApplicationsPerDay: z.number().min(1).max(50).optional().default(5),
  /** Scheduling preference. Never triggers a submission - only preparation. */
  applicationSchedule: z.enum(SCHEDULE_EXPRESSIONS).optional().default('daily'),
  customKeywords: z.array(shortText).max(50).optional().default([]),
  excludedKeywords: z.array(shortText).max(50).optional().default([]),
});

export type ProfileJobPreferences = z.infer<typeof jobPreferencesSchema>;

/* ------------------------------------------------------ application profile -- */

export const customAnswerSchema = z.object({
  id: z.string().max(64).optional(),
  question: mediumText,
  answer: longText,
  /** When false, the packet generator must not reuse this answer automatically. */
  allowReuse: z.boolean().optional().default(true),
});

export const applicationProfileSchema = z.object({
  addressLine1: shortText.optional().default(''),
  addressLine2: shortText.optional().default(''),
  city: shortText.optional().default(''),
  state: shortText.optional().default(''),
  postalCode: shortText.optional().default(''),
  country: shortText.optional().default(''),

  /**
   * Only collected when a supported application flow genuinely requires it.
   * Never used for matching, never sent to an AI provider.
   */
  dateOfBirth: shortText.optional().default(''),

  /** Optional, never required, never used in scoring. */
  pronouns: shortText.optional().default(''),
  diversityInfo: mediumText.optional().default(''),

  noticePeriodExplanation: mediumText.optional().default(''),
  salaryExplanation: mediumText.optional().default(''),
  relocationExplanation: mediumText.optional().default(''),
  whyThisCompanyTemplate: longText.optional().default(''),
  customAnswers: z.array(customAnswerSchema).max(80).optional().default([]),

  /**
   * Master switch. When false, the packet generator marks every sensitive
   * screening question as "Needs user input" instead of pre-filling it.
   */
  allowSensitiveAnswerReuse: z.boolean().optional().default(false),
});

export type ProfileApplicationProfile = z.infer<typeof applicationProfileSchema>;

/* ------------------------------------------------------------- aggregate --- */

export const fullProfileSchema = z.object({
  personal: personalSchema,
  professional: professionalSchema,
  jobPreferences: jobPreferencesSchema,
  applicationProfile: applicationProfileSchema,
});

export type FullProfile = z.infer<typeof fullProfileSchema>;

/** Parse whatever is in the database into a complete, defaulted profile. */
export function parseProfile(row: {
  personal?: unknown;
  professional?: unknown;
  jobPreferences?: unknown;
  applicationProfile?: unknown;
} | null | undefined): FullProfile {
  return {
    personal: personalSchema.safeParse(row?.personal ?? {}).data ?? personalSchema.parse({}),
    professional: professionalSchema.safeParse(row?.professional ?? {}).data ?? professionalSchema.parse({}),
    jobPreferences: jobPreferencesSchema.safeParse(row?.jobPreferences ?? {}).data ?? jobPreferencesSchema.parse({}),
    applicationProfile:
      applicationProfileSchema.safeParse(row?.applicationProfile ?? {}).data ?? applicationProfileSchema.parse({}),
  };
}

export function emptyProfile(): FullProfile {
  return fullProfileSchema.parse({
    personal: {},
    professional: {},
    jobPreferences: {},
    applicationProfile: {},
  });
}

/* ---------------------------------------------------------- completeness -- */

export interface CompletenessItem {
  key: string;
  label: string;
  done: boolean;
  weight: number;
  /** Which product capability this unlocks - shown in the UI. */
  unlocks: string;
}

export interface ProfileCompleteness {
  score: number;
  items: CompletenessItem[];
  missingForMatching: string[];
  missingForApplying: string[];
}

/**
 * Deterministic completeness scoring. Drives the onboarding progress bar and
 * the "missing information" warnings on an application packet.
 */
export function profileCompleteness(p: FullProfile): ProfileCompleteness {
  const items: CompletenessItem[] = [
    {
      key: 'name',
      label: 'Full name',
      done: Boolean(p.personal.fullName),
      weight: 8,
      unlocks: 'Resume header and cover letters',
    },
    {
      key: 'email',
      label: 'Contact email',
      done: Boolean(p.personal.email),
      weight: 8,
      unlocks: 'Resume contact block',
    },
    {
      key: 'phone',
      label: 'Phone number',
      done: Boolean(p.personal.phone),
      weight: 5,
      unlocks: 'ATS contact completeness score',
    },
    {
      key: 'location',
      label: 'Current city and country',
      done: Boolean(p.personal.city && p.personal.country),
      weight: 7,
      unlocks: 'Location matching',
    },
    {
      key: 'currentTitle',
      label: 'Current job title',
      done: Boolean(p.professional.currentTitle),
      weight: 7,
      unlocks: 'Seniority alignment',
    },
    {
      key: 'targetTitles',
      label: 'Target job titles',
      done: (p.professional.targetTitles?.length ?? 0) > 0,
      weight: 10,
      unlocks: 'Job discovery and title relevance',
    },
    {
      key: 'experience',
      label: 'Years of experience',
      done: p.professional.yearsOfExperience !== undefined,
      weight: 8,
      unlocks: 'Experience matching',
    },
    {
      key: 'skills',
      label: 'At least 5 skills',
      done: (p.professional.skills?.length ?? 0) >= 5,
      weight: 12,
      unlocks: 'Skill gap analysis and keyword coverage',
    },
    {
      key: 'summary',
      label: 'Professional summary',
      done: Boolean(p.professional.professionalSummary),
      weight: 6,
      unlocks: 'Tailored summaries',
    },
    {
      key: 'education',
      label: 'Education',
      done: (p.professional.education?.length ?? 0) > 0,
      weight: 5,
      unlocks: 'Education relevance scoring',
    },
    {
      key: 'locations',
      label: 'Preferred locations',
      done: (p.jobPreferences.preferredLocations?.length ?? 0) > 0,
      weight: 6,
      unlocks: 'Location filtering',
    },
    {
      key: 'ctc',
      label: 'Expected CTC',
      done: p.jobPreferences.minExpectedCtc !== undefined,
      weight: 6,
      unlocks: 'Salary matching and salary answers',
    },
    {
      key: 'notice',
      label: 'Notice period',
      done: p.jobPreferences.noticePeriodDays !== undefined,
      weight: 5,
      unlocks: 'Notice-period matching and answers',
    },
    {
      key: 'authorization',
      label: 'Work authorisation',
      done: Boolean(p.jobPreferences.workAuthorization),
      weight: 7,
      unlocks: 'Authorisation matching and screening answers',
    },
  ];

  const total = items.reduce((n, i) => n + i.weight, 0);
  const earned = items.filter((i) => i.done).reduce((n, i) => n + i.weight, 0);

  const MATCHING_KEYS = ['targetTitles', 'skills', 'experience', 'location', 'locations'];
  const APPLYING_KEYS = ['name', 'email', 'phone', 'ctc', 'notice', 'authorization'];

  return {
    score: Math.round((earned / total) * 100),
    items,
    missingForMatching: items.filter((i) => !i.done && MATCHING_KEYS.includes(i.key)).map((i) => i.label),
    missingForApplying: items.filter((i) => !i.done && APPLYING_KEYS.includes(i.key)).map((i) => i.label),
  };
}

/* --------------------------------------------------------------- labels ---- */

export const CAREER_LEVEL_LABELS: Record<CareerLevel, string> = {
  student: 'Student / intern',
  entry: 'Entry level',
  junior: 'Junior',
  mid: 'Mid level',
  senior: 'Senior',
  lead: 'Lead',
  principal: 'Principal / staff',
  manager: 'Manager',
  director: 'Director',
  executive: 'Executive',
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
};

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  any: 'No preference',
};

export const COMPANY_SIZE_LABELS: Record<(typeof COMPANY_SIZES)[number], string> = {
  startup: 'Startup (1–50)',
  small: 'Small (51–200)',
  mid_market: 'Mid-market (201–1000)',
  large: 'Large (1001–5000)',
  enterprise: 'Enterprise (5000+)',
};

export const WORK_AUTH_LABELS: Record<(typeof WORK_AUTH)[number], string> = {
  citizen: 'Citizen of my work country',
  permanent_resident: 'Permanent resident',
  work_visa_held: 'I hold a valid work visa',
  needs_sponsorship: 'I need visa sponsorship',
  student_visa: 'Student visa',
  other: 'Other / prefer to explain',
};

export const SCHEDULE_LABELS: Record<(typeof SCHEDULE_EXPRESSIONS)[number], string> = {
  hourly: 'Every hour',
  daily: 'Once a day',
  weekdays: 'Weekdays only',
  weekly: 'Once a week',
};
