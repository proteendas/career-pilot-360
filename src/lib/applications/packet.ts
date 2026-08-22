/**
 * Application packet generation.
 *
 * Everything generated here must be traceable to one of: the canonical
 * resume, the user profile, the job description, or a user-approved custom
 * answer (spec §11). The mechanism that makes this checkable rather than
 * aspirational is the same fabrication guard used for resume suggestions
 * (`checkGrounding`): any AI-written sentence containing a figure absent from
 * the grounding corpus is rejected before the user ever sees it.
 *
 * Every piece degrades to a deterministic template when no AI provider is
 * configured, or when the AI call fails. The packet is never blocked on AI.
 */
import { z } from 'zod';
import { generateObject } from '@/lib/ai/client';
import { AiError } from '@/lib/ai/types';
import { SAFETY_PREAMBLE, OUTREACH_PREAMBLE, budgetText, fenceUntrusted, jobBlock } from '@/lib/ai/prompts';
import { checkGrounding, resumeToPlainText, type StructuredResume } from '@/lib/resume/types';
import { diffWords } from '@/lib/diff';
import type { FullProfile } from '@/lib/profile/types';
import type { JobWithSource } from '@/lib/jobs/service';
import type { MatchResult } from '@/lib/jobs/match';
import { profileToProse } from '@/lib/profile/prose';
import { resolveScreeningQuestions, type ScreeningAnswer } from './screening';

/* ------------------------------------------------------------------ types -- */

export interface PacketWarning {
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface ApplicationPacketContent {
  coverLetter: string;
  shortSummary: string;
  emailSubject: string;
  recruiterEmail: string;
  linkedinMessage: string;
  screeningAnswers: ScreeningAnswer[];
  keySkillsToEmphasize: string[];
  warnings: PacketWarning[];
  checklist: ChecklistItem[];
  usedAi: boolean;
  provider: string | null;
  rejectedCount: number;
}

export interface PacketInput {
  userId: string;
  job: JobWithSource;
  match: MatchResult | null;
  resume: StructuredResume;
  profile: FullProfile;
  screeningQuestions?: string[];
}

/* ------------------------------------------------------- deterministic --- */

function templateCoverLetter(input: PacketInput): string {
  const name = input.profile.personal.fullName || input.profile.personal.preferredName || 'Candidate';
  const title = input.profile.professional.currentTitle || 'professional';
  const years = input.profile.professional.yearsOfExperience;
  const summary = input.profile.professional.professionalSummary;
  const topSkills = (input.match?.matchedRequiredSkills ?? input.profile.professional.skills ?? []).slice(0, 5);

  const lines = [
    `Dear Hiring Team at ${input.job.company},`,
    '',
    `I am writing to apply for the ${input.job.title} position${
      years !== undefined ? ` with ${years} years of experience as a ${title}` : ` as a ${title}`
    }.`,
  ];

  if (summary) lines.push('', summary);
  if (topSkills.length > 0) {
    lines.push('', `My relevant experience includes ${topSkills.join(', ')}.`);
  }
  if (input.match && input.match.gaps.length === 0) {
    lines.push('', `I believe my background aligns closely with what you are looking for in this role.`);
  }

  lines.push(
    '',
    `I would welcome the opportunity to discuss how my experience could contribute to ${input.job.company}.`,
    '',
    'Thank you for your consideration.',
    '',
    'Sincerely,',
    name,
  );

  return lines.join('\n');
}

function templateSummary(input: PacketInput): string {
  const title = input.profile.professional.currentTitle || 'Professional';
  const years = input.profile.professional.yearsOfExperience;
  const topSkills = (input.profile.professional.skills ?? []).slice(0, 4);
  return [
    `${title}${years !== undefined ? ` with ${years} years of experience` : ''}`,
    topSkills.length ? `skilled in ${topSkills.join(', ')}` : null,
    `applying for ${input.job.title} at ${input.job.company}.`,
  ]
    .filter(Boolean)
    .join(', ');
}

function templateEmailSubject(input: PacketInput): string {
  const title = input.profile.professional.currentTitle || 'Candidate';
  return `Application for ${input.job.title} — ${title}`;
}

function templateRecruiterEmail(input: PacketInput): string {
  const name = input.profile.personal.fullName || input.profile.personal.preferredName || '';
  return [
    `Hello,`,
    '',
    `I'm reaching out regarding the ${input.job.title} role at ${input.job.company}. ` +
      `I've attached my resume and would appreciate the chance to discuss my fit for the position.`,
    '',
    `Happy to answer any questions.`,
    '',
    `Best regards,`,
    name,
  ].join('\n');
}

function templateLinkedInMessage(input: PacketInput): string {
  return (
    `Hi — I'm interested in the ${input.job.title} role at ${input.job.company} and wanted to introduce myself. ` +
    `I've applied and would welcome a conversation if there's a fit.`
  );
}

/* ------------------------------------------------------------- checklist -- */

function buildChecklist(input: PacketInput, screeningAnswers: ScreeningAnswer[]): ChecklistItem[] {
  const needsInput = screeningAnswers.filter((a) => a.needsUserInput).length;
  return [
    { id: 'resume', label: 'Review the tailored resume for accuracy', done: false },
    { id: 'cover-letter', label: 'Review the cover letter', done: false },
    {
      id: 'screening',
      label:
        needsInput > 0
          ? `Answer ${needsInput} screening question(s) that need your input`
          : 'Review screening answers',
      done: false,
    },
    { id: 'links', label: 'Check your portfolio/LinkedIn links are current', done: false },
    { id: 'apply', label: `Open ${input.job.company}'s application portal`, done: false },
    { id: 'confirm', label: 'Confirm submission once you have applied', done: false },
  ];
}

function buildWarnings(input: PacketInput, screeningAnswers: ScreeningAnswer[]): PacketWarning[] {
  const warnings: PacketWarning[] = [];

  const needsInput = screeningAnswers.filter((a) => a.needsUserInput);
  if (needsInput.length > 0) {
    warnings.push({
      severity: 'medium',
      title: `${needsInput.length} screening question(s) need your input`,
      detail:
        'These are sensitive or unmatched questions that were deliberately left blank rather than guessed: ' +
        needsInput.map((a) => a.question).slice(0, 5).join('; '),
    });
  }

  if (!input.profile.personal.phone) {
    warnings.push({
      severity: 'low',
      title: 'No phone number on file',
      detail: 'Many application forms require a phone number. Add one to your profile.',
    });
  }

  if (input.match) {
    const realGapCount = input.match.gaps.filter((g) => g.countsAgainstScore).length;
    if (realGapCount > 0) {
      warnings.push({
        severity: realGapCount > 3 ? 'high' : 'medium',
        title: `${realGapCount} requirement(s) not evidenced in your resume or profile`,
        detail: 'Review the match details before applying — these are genuine gaps, not omissions.',
      });
    }
  }

  if (input.job.sourceType === 'external_link') {
    warnings.push({
      severity: 'low',
      title: 'This job was not read from its source',
      detail: 'The description is what you entered manually. Double-check it against the original listing.',
    });
  }

  return warnings;
}

/* -------------------------------------------------------------- AI pass --- */

const aiPacketSchema = z.object({
  coverLetter: z.string().max(3000),
  shortSummary: z.string().max(400),
  emailSubject: z.string().max(150),
  recruiterEmail: z.string().max(2000),
  linkedinMessage: z.string().max(600),
});

async function generateWithAi(
  input: PacketInput,
  corpus: string,
): Promise<{ content: z.infer<typeof aiPacketSchema>; rejected: number; provider: string } | null> {
  const resumeText = resumeToPlainText(input.resume);
  const profileProse = profileToProse(input.profile);

  const instructions = [
    SAFETY_PREAMBLE,
    '',
    OUTREACH_PREAMBLE,
    '',
    'TASK',
    'Write a complete application packet: a cover letter, a one-sentence summary, an email subject line, ' +
      'a short recruiter email, and a short LinkedIn connection message.',
    '',
    'Rules:',
    '- Ground every claim in the supplied resume and profile. Do not invent employers, titles, dates, or numbers.',
    '- The cover letter should be 3-4 short paragraphs, specific to this role, not generic.',
    '- The recruiter email is brief (under 120 words) and professional.',
    '- The LinkedIn message is under 300 characters, since LinkedIn messages have a length limit.',
    '- Do not claim the candidate has a skill that is not in the resume or profile.',
    '- Do not state salary expectations, availability, or notice period unless explicitly present in the profile.',
  ].join('\n');

  const userContent = [
    `Applying to: ${input.job.title} at ${input.job.company}`,
    '',
    fenceUntrusted('candidate_resume', budgetText(resumeText, 10_000)),
    '',
    fenceUntrusted('candidate_profile', budgetText(profileProse, 4_000)),
    '',
    jobBlock(input.job.title, input.job.company, budgetText(input.job.description, 6_000)),
  ].join('\n');

  try {
    const res = await generateObject({
      userId: input.userId,
      task: 'cover_letter',
      schema: aiPacketSchema,
      schemaName: 'application_packet',
      temperature: 0.4,
      maxOutputTokens: 2500,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: userContent },
      ],
    });

    // Ground-check every free-text field. Any rejected field falls back to
    // its deterministic template rather than being shown fabricated.
    let rejected = 0;
    const checked = { ...res.value };

    const coverLetterFinding = checkGrounding(checked.coverLetter, corpus, 'coverLetter');
    if (coverLetterFinding) {
      checked.coverLetter = templateCoverLetter(input);
      rejected += 1;
    }
    const emailFinding = checkGrounding(checked.recruiterEmail, corpus, 'recruiterEmail');
    if (emailFinding) {
      checked.recruiterEmail = templateRecruiterEmail(input);
      rejected += 1;
    }
    const linkedinFinding = checkGrounding(checked.linkedinMessage, corpus, 'linkedinMessage');
    if (linkedinFinding) {
      checked.linkedinMessage = templateLinkedInMessage(input);
      rejected += 1;
    }
    const summaryFinding = checkGrounding(checked.shortSummary, corpus, 'shortSummary');
    if (summaryFinding) {
      checked.shortSummary = templateSummary(input);
      rejected += 1;
    }

    return { content: checked, rejected, provider: res.provider };
  } catch (err) {
    if (!(err instanceof AiError)) console.error('[packet] AI generation failed unexpectedly', err);
    return null;
  }
}

/* ------------------------------------------------------------------ entry -- */

/**
 * Build a full application packet.
 *
 * `corpus` — the grounding material a fabrication check compares against —
 * is the resume plus the user's profile prose. The job description is
 * deliberately NOT part of the corpus: a sentence copying facts from the job
 * posting (like the employer's own stated benefits) is not a claim about the
 * candidate and should not pass the fabrication check by accident, but it
 * also should not be treated as evidence FOR the candidate.
 */
export async function generateApplicationPacket(
  input: PacketInput,
  opts: { useAi?: boolean } = {},
): Promise<ApplicationPacketContent> {
  const corpus = `${resumeToPlainText(input.resume)}\n\n${profileToProse(input.profile)}`;

  const screeningAnswers = resolveScreeningQuestions(
    input.screeningQuestions ?? defaultScreeningQuestions(input.job),
    input.profile,
  );

  let usedAi = false;
  let provider: string | null = null;
  let rejectedCount = 0;

  let coverLetter = templateCoverLetter(input);
  let shortSummary = templateSummary(input);
  let emailSubject = templateEmailSubject(input);
  let recruiterEmail = templateRecruiterEmail(input);
  let linkedinMessage = templateLinkedInMessage(input);

  if (opts.useAi) {
    const ai = await generateWithAi(input, corpus);
    if (ai) {
      usedAi = true;
      provider = ai.provider;
      rejectedCount = ai.rejected;
      coverLetter = ai.content.coverLetter;
      shortSummary = ai.content.shortSummary;
      emailSubject = ai.content.emailSubject || emailSubject;
      recruiterEmail = ai.content.recruiterEmail;
      linkedinMessage = ai.content.linkedinMessage;
    }
  }

  const keySkillsToEmphasize =
    input.match?.matchedRequiredSkills.slice(0, 8) ?? (input.profile.professional.skills ?? []).slice(0, 8);

  return {
    coverLetter,
    shortSummary,
    emailSubject,
    recruiterEmail,
    linkedinMessage,
    screeningAnswers,
    keySkillsToEmphasize,
    warnings: buildWarnings(input, screeningAnswers),
    checklist: buildChecklist(input, screeningAnswers),
    usedAi,
    provider,
    rejectedCount,
  };
}

/** Screening questions to answer when none were explicitly supplied. */
function defaultScreeningQuestions(job: JobWithSource): string[] {
  const questions: string[] = [];
  if (job.visaSponsorship !== 'no') {
    questions.push('Do you require visa sponsorship to work in this role?');
  }
  questions.push('What is your notice period?');
  questions.push('What are your salary expectations?');
  return questions;
}

/* ---------------------------------------------------------- diff summary -- */

export interface PacketDiffSummary {
  addedWords: number;
  removedWords: number;
  addedKeywords: string[];
  removedKeywords: string[];
}

/**
 * Compare two resume text blobs at the keyword level, for the side-by-side
 * comparison view. Pure and synchronous.
 */
export function summarizeResumeDiff(original: string, tailored: string): PacketDiffSummary {
  const tokens = diffWords(original, tailored);
  const added = tokens.filter((t) => t.type === 'insert').map((t) => t.value);
  const removed = tokens.filter((t) => t.type === 'delete').map((t) => t.value);

  const wordsOf = (parts: string[]) =>
    parts.flatMap((p) => p.match(/[A-Za-z][A-Za-z0-9+#.]{2,}/g) ?? []).map((w) => w.toLowerCase());

  const addedWordSet = new Set(wordsOf(added));
  const removedWordSet = new Set(wordsOf(removed));

  // A word appearing on both sides was moved, not genuinely added/removed.
  const addedKeywords = [...addedWordSet].filter((w) => !removedWordSet.has(w));
  const removedKeywords = [...removedWordSet].filter((w) => !addedWordSet.has(w));

  return {
    addedWords: added.join(' ').split(/\s+/).filter(Boolean).length,
    removedWords: removed.join(' ').split(/\s+/).filter(Boolean).length,
    addedKeywords: addedKeywords.slice(0, 30),
    removedKeywords: removedKeywords.slice(0, 30),
  };
}
