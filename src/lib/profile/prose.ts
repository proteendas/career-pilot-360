/**
 * Render a profile as prose for AI grounding.
 *
 * Only fields the user chose to give us, and deliberately NOT the sensitive
 * demographic block: pronouns, disability/diversity information and date of
 * birth never leave the database for an AI provider. They are irrelevant to
 * every AI task in this product, so excluding them costs nothing.
 */
import type { FullProfile } from './types';
import { CAREER_LEVEL_LABELS, WORK_AUTH_LABELS } from './types';

export function profileToProse(profile: FullProfile): string {
  const { personal, professional, jobPreferences, applicationProfile } = profile;
  const lines: string[] = [];

  const name = personal.fullName || personal.preferredName;
  if (name) lines.push(`Name: ${name}`);
  if (personal.city || personal.country) {
    lines.push(`Location: ${[personal.city, personal.country].filter(Boolean).join(', ')}`);
  }

  if (professional.currentTitle) {
    lines.push(
      `Current role: ${professional.currentTitle}${professional.currentCompany ? ` at ${professional.currentCompany}` : ''}`,
    );
  }
  if (professional.yearsOfExperience !== undefined) {
    lines.push(`Years of experience: ${professional.yearsOfExperience}`);
  }
  if (professional.careerLevel) {
    lines.push(`Career level: ${CAREER_LEVEL_LABELS[professional.careerLevel]}`);
  }
  if (professional.targetTitles?.length) lines.push(`Target titles: ${professional.targetTitles.join(', ')}`);
  if (professional.skills?.length) lines.push(`Skills: ${professional.skills.join(', ')}`);
  if (professional.professionalSummary) lines.push(`Summary: ${professional.professionalSummary}`);

  if (professional.education?.length) {
    lines.push(
      'Education: ' +
        professional.education
          .map((e) => [e.degree, e.field, e.institution, e.endYear].filter(Boolean).join(' '))
          .filter(Boolean)
          .join('; '),
    );
  }
  if (professional.certifications?.length) {
    lines.push(
      'Certifications: ' +
        professional.certifications
          .map((c) => [c.name, c.issuer, c.year].filter(Boolean).join(' '))
          .filter(Boolean)
          .join('; '),
    );
  }

  if (jobPreferences.preferredLocations?.length) {
    lines.push(`Preferred locations: ${jobPreferences.preferredLocations.join(', ')}`);
  }
  if (jobPreferences.workMode && jobPreferences.workMode !== 'any') {
    lines.push(`Preferred work mode: ${jobPreferences.workMode}`);
  }
  if (jobPreferences.noticePeriodDays !== undefined) {
    lines.push(`Notice period: ${jobPreferences.noticePeriodDays} days`);
  }
  if (jobPreferences.workAuthorization) {
    lines.push(`Work authorisation: ${WORK_AUTH_LABELS[jobPreferences.workAuthorization]}`);
  }
  if (jobPreferences.willingToRelocate) lines.push('Open to relocation: yes');

  // Compensation is included only when the user allowed reuse of sensitive
  // answers, because it is exactly the kind of figure that must not be guessed.
  if (applicationProfile.allowSensitiveAnswerReuse) {
    if (jobPreferences.minExpectedCtc !== undefined) {
      lines.push(
        `Expected compensation: ${jobPreferences.minExpectedCtc}` +
          (jobPreferences.maxExpectedCtc !== undefined ? ` to ${jobPreferences.maxExpectedCtc}` : '') +
          ` ${jobPreferences.currency ?? ''}`.trimEnd(),
      );
    }
    if (applicationProfile.salaryExplanation) {
      lines.push(`Salary note (user's own words): ${applicationProfile.salaryExplanation}`);
    }
    if (applicationProfile.noticePeriodExplanation) {
      lines.push(`Notice note (user's own words): ${applicationProfile.noticePeriodExplanation}`);
    }
  }

  const reusable = (applicationProfile.customAnswers ?? []).filter((a) => a.allowReuse !== false && a.answer);
  if (reusable.length > 0) {
    lines.push('Approved reusable answers:');
    for (const a of reusable) lines.push(`- Q: ${a.question}\n  A: ${a.answer}`);
  }

  return lines.join('\n');
}
