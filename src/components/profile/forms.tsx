'use client';

/**
 * Profile form sections.
 *
 * Each section is a self-contained controlled form over one slice of
 * `FullProfile`, saved independently via `updateProfileSectionAction`. The same
 * components back both the onboarding wizard and the profile editor, so the two
 * can never drift apart.
 */
import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { SimpleSelect } from '@/components/ui/select';
import { CheckboxField } from '@/components/ui/checkbox';
import { SwitchField } from '@/components/ui/switch';
import { RadioCards } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { TagInput } from './tag-input';
import {
  CAREER_LEVELS,
  CAREER_LEVEL_LABELS,
  COMPANY_SIZES,
  COMPANY_SIZE_LABELS,
  CURRENCIES,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  SCHEDULE_EXPRESSIONS,
  SCHEDULE_LABELS,
  WORK_AUTH,
  WORK_AUTH_LABELS,
  type FullProfile,
} from '@/lib/profile/types';

const SKILL_SUGGESTIONS = [
  'TypeScript', 'Python', 'Java', 'React', 'Node.js', 'PostgreSQL', 'AWS',
  'Docker', 'Kubernetes', 'System Design', 'SQL', 'Git',
];

const TITLE_SUGGESTIONS = [
  'Software Engineer', 'Senior Software Engineer', 'Backend Engineer',
  'Frontend Engineer', 'Full Stack Engineer', 'Data Engineer', 'DevOps Engineer',
  'Engineering Manager',
];

const LOCATION_SUGGESTIONS = ['Bengaluru', 'Hyderabad', 'Pune', 'Chennai', 'Mumbai', 'Delhi NCR', 'Remote (India)'];

const INDUSTRY_SUGGESTIONS = ['SaaS', 'Fintech', 'E-commerce', 'Healthcare', 'EdTech', 'Gaming', 'Consulting'];

const TIMEZONES = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin',
  'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC',
];

/* --------------------------------------------------------------- helpers -- */

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {description ? <p className="text-[13px] leading-relaxed text-ink-3">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Numeric input that keeps `undefined` distinct from 0. */
function NumberInput({
  id,
  value,
  onChange,
  placeholder,
  min,
  max,
  step,
}: {
  id: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      value={value === undefined ? '' : String(value)}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') {
          onChange(undefined);
          return;
        }
        const n = Number(raw);
        onChange(Number.isFinite(n) ? n : undefined);
      }}
    />
  );
}

const opts = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((v) => ({ value: v, label: labels[v] }));

/* -------------------------------------------------------------- personal -- */

export function PersonalForm({
  value,
  onChange,
}: {
  value: FullProfile['personal'];
  onChange: (v: FullProfile['personal']) => void;
}) {
  const set = <K extends keyof FullProfile['personal']>(k: K, v: FullProfile['personal'][K]) =>
    onChange({ ...value, [k]: v });

  return (
    <FormSection
      title="Personal details"
      description="Used for your resume header and application forms. Nothing here is shared with anyone unless you send it."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="p-fullName" required>
          <Input
            id="p-fullName"
            value={value.fullName}
            onChange={(e) => set('fullName', e.target.value)}
            autoComplete="name"
            placeholder="Priya Sharma"
          />
        </Field>
        <Field label="Preferred name" htmlFor="p-preferredName" help="How you would like to be addressed.">
          <Input
            id="p-preferredName"
            value={value.preferredName}
            onChange={(e) => set('preferredName', e.target.value)}
            placeholder="Priya"
          />
        </Field>
        <Field label="Contact email" htmlFor="p-email" required>
          <Input
            id="p-email"
            type="email"
            value={value.email}
            onChange={(e) => set('email', e.target.value)}
            autoComplete="email"
          />
        </Field>
        <Field label="Phone" htmlFor="p-phone" help="Include the country code.">
          <Input
            id="p-phone"
            type="tel"
            value={value.phone}
            onChange={(e) => set('phone', e.target.value)}
            autoComplete="tel"
            placeholder="+91 98765 43210"
          />
        </Field>
        <Field label="Country" htmlFor="p-country">
          <Input id="p-country" value={value.country} onChange={(e) => set('country', e.target.value)} placeholder="India" />
        </Field>
        <Field label="Current city" htmlFor="p-city">
          <Input id="p-city" value={value.city} onChange={(e) => set('city', e.target.value)} placeholder="Bengaluru" />
        </Field>
        <Field label="Time zone" htmlFor="p-timezone" help="Used for scheduling reminders.">
          <SimpleSelect
            id="p-timezone"
            value={value.timezone}
            onValueChange={(v) => set('timezone', v)}
            options={TIMEZONES.map((t) => ({ value: t, label: t.replace('_', ' ') }))}
            placeholder="Select a time zone"
          />
        </Field>
        <Field label="Profile photo URL" htmlFor="p-photo" help="Optional. Never embedded in an ATS-safe resume.">
          <Input
            id="p-photo"
            value={value.photoUrl}
            onChange={(e) => set('photoUrl', e.target.value)}
            placeholder="https://…"
          />
        </Field>
      </div>
    </FormSection>
  );
}

/* ---------------------------------------------------------- professional -- */

export function ProfessionalForm({
  value,
  onChange,
}: {
  value: FullProfile['professional'];
  onChange: (v: FullProfile['professional']) => void;
}) {
  const set = <K extends keyof FullProfile['professional']>(k: K, v: FullProfile['professional'][K]) =>
    onChange({ ...value, [k]: v });

  const education = value.education ?? [];
  const certifications = value.certifications ?? [];

  return (
    <div className="space-y-8">
      <FormSection
        title="Where you are now"
        description="Drives seniority alignment and title relevance in job matching."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Current job title" htmlFor="pro-title">
            <Input
              id="pro-title"
              value={value.currentTitle}
              onChange={(e) => set('currentTitle', e.target.value)}
              placeholder="Senior Backend Engineer"
            />
          </Field>
          <Field label="Current company" htmlFor="pro-company">
            <Input
              id="pro-company"
              value={value.currentCompany}
              onChange={(e) => set('currentCompany', e.target.value)}
            />
          </Field>
          <Field label="Years of experience" htmlFor="pro-years">
            <NumberInput
              id="pro-years"
              value={value.yearsOfExperience}
              onChange={(v) => set('yearsOfExperience', v)}
              min={0}
              max={60}
              placeholder="7"
            />
          </Field>
          <Field label="Career level" htmlFor="pro-level">
            <SimpleSelect
              id="pro-level"
              value={value.careerLevel}
              onValueChange={(v) => set('careerLevel', v as FullProfile['professional']['careerLevel'])}
              options={opts(CAREER_LEVELS, CAREER_LEVEL_LABELS)}
              placeholder="Select a level"
            />
          </Field>
        </div>

        <Field
          label="Target job titles"
          htmlFor="pro-targets"
          required
          help="The roles you actually want. Job discovery and title scoring both use these."
        >
          <TagInput
            id="pro-targets"
            value={value.targetTitles ?? []}
            onChange={(v) => set('targetTitles', v)}
            suggestions={TITLE_SUGGESTIONS}
            placeholder="Senior Backend Engineer"
            max={20}
          />
        </Field>
      </FormSection>

      <FormSection
        title="Skills"
        description="List only what you can genuinely speak to. CareerPilot360 never infers a skill you did not claim, and never adds one to your resume."
      >
        <Field label="Skills and technologies" htmlFor="pro-skills" required>
          <TagInput
            id="pro-skills"
            value={value.skills ?? []}
            onChange={(v) => set('skills', v)}
            suggestions={SKILL_SUGGESTIONS}
            placeholder="PostgreSQL"
            max={150}
          />
        </Field>

        <Field label="Professional summary" htmlFor="pro-summary" help="Two or three sentences in your own words.">
          <Textarea
            id="pro-summary"
            value={value.professionalSummary}
            onChange={(e) => set('professionalSummary', e.target.value)}
            rows={4}
            maxLength={5000}
            placeholder="Backend engineer with seven years building transactional services…"
          />
        </Field>
      </FormSection>

      <FormSection title="Education" description="Used for education relevance scoring.">
        <div className="space-y-3">
          {education.map((row, i) => (
            <div key={i} className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Degree" htmlFor={`edu-degree-${i}`}>
                  <Input
                    id={`edu-degree-${i}`}
                    value={row.degree}
                    onChange={(e) => {
                      const next = [...education];
                      next[i] = { ...row, degree: e.target.value };
                      set('education', next);
                    }}
                    placeholder="B.Tech"
                  />
                </Field>
                <Field label="Field of study" htmlFor={`edu-field-${i}`}>
                  <Input
                    id={`edu-field-${i}`}
                    value={row.field}
                    onChange={(e) => {
                      const next = [...education];
                      next[i] = { ...row, field: e.target.value };
                      set('education', next);
                    }}
                    placeholder="Computer Science"
                  />
                </Field>
                <Field label="Institution" htmlFor={`edu-inst-${i}`}>
                  <Input
                    id={`edu-inst-${i}`}
                    value={row.institution}
                    onChange={(e) => {
                      const next = [...education];
                      next[i] = { ...row, institution: e.target.value };
                      set('education', next);
                    }}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From" htmlFor={`edu-start-${i}`}>
                    <Input
                      id={`edu-start-${i}`}
                      value={row.startYear}
                      onChange={(e) => {
                        const next = [...education];
                        next[i] = { ...row, startYear: e.target.value };
                        set('education', next);
                      }}
                      placeholder="2015"
                    />
                  </Field>
                  <Field label="To" htmlFor={`edu-end-${i}`}>
                    <Input
                      id={`edu-end-${i}`}
                      value={row.endYear}
                      onChange={(e) => {
                        const next = [...education];
                        next[i] = { ...row, endYear: e.target.value };
                        set('education', next);
                      }}
                      placeholder="2019"
                    />
                  </Field>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => set('education', education.filter((_, j) => j !== i))}
                >
                  <Trash2 aria-hidden />
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              set('education', [
                ...education,
                { degree: '', field: '', institution: '', startYear: '', endYear: '', grade: '' },
              ])
            }
          >
            <Plus aria-hidden />
            Add education
          </Button>
        </div>
      </FormSection>

      <FormSection title="Certifications" description="Only certifications you actually hold.">
        <div className="space-y-3">
          {certifications.map((row, i) => (
            <div key={i} className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Name" htmlFor={`cert-name-${i}`}>
                  <Input
                    id={`cert-name-${i}`}
                    value={row.name}
                    onChange={(e) => {
                      const next = [...certifications];
                      next[i] = { ...row, name: e.target.value };
                      set('certifications', next);
                    }}
                  />
                </Field>
                <Field label="Issuer" htmlFor={`cert-issuer-${i}`}>
                  <Input
                    id={`cert-issuer-${i}`}
                    value={row.issuer}
                    onChange={(e) => {
                      const next = [...certifications];
                      next[i] = { ...row, issuer: e.target.value };
                      set('certifications', next);
                    }}
                  />
                </Field>
                <Field label="Year" htmlFor={`cert-year-${i}`}>
                  <Input
                    id={`cert-year-${i}`}
                    value={row.year}
                    onChange={(e) => {
                      const next = [...certifications];
                      next[i] = { ...row, year: e.target.value };
                      set('certifications', next);
                    }}
                    placeholder="2023"
                  />
                </Field>
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => set('certifications', certifications.filter((_, j) => j !== i))}
                >
                  <Trash2 aria-hidden />
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => set('certifications', [...certifications, { name: '', issuer: '', year: '', credentialId: '' }])}
          >
            <Plus aria-hidden />
            Add certification
          </Button>
        </div>
      </FormSection>

      <FormSection title="Links" description="Included in your resume when relevant.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="LinkedIn profile URL" htmlFor="pro-linkedin" help="Just the public profile URL. We never sign in to it.">
            <Input
              id="pro-linkedin"
              value={value.linkedinUrl}
              onChange={(e) => set('linkedinUrl', e.target.value)}
              placeholder="linkedin.com/in/you"
            />
          </Field>
          <Field label="GitHub" htmlFor="pro-github">
            <Input
              id="pro-github"
              value={value.githubUrl}
              onChange={(e) => set('githubUrl', e.target.value)}
              placeholder="github.com/you"
            />
          </Field>
          <Field label="Portfolio" htmlFor="pro-portfolio">
            <Input id="pro-portfolio" value={value.portfolioUrl} onChange={(e) => set('portfolioUrl', e.target.value)} />
          </Field>
          <Field label="Personal website" htmlFor="pro-website">
            <Input id="pro-website" value={value.websiteUrl} onChange={(e) => set('websiteUrl', e.target.value)} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Preferences" description="Shapes which roles are surfaced first.">
        <Field label="Preferred industries" htmlFor="pro-industries">
          <TagInput
            id="pro-industries"
            value={value.preferredIndustries ?? []}
            onChange={(v) => set('preferredIndustries', v)}
            suggestions={INDUSTRY_SUGGESTIONS}
            max={20}
          />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink-2">Preferred company sizes</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {COMPANY_SIZES.map((size) => (
              <CheckboxField
                key={size}
                id={`size-${size}`}
                label={COMPANY_SIZE_LABELS[size]}
                checked={(value.preferredCompanySizes ?? []).includes(size)}
                onCheckedChange={(checked) =>
                  set(
                    'preferredCompanySizes',
                    checked
                      ? [...(value.preferredCompanySizes ?? []), size]
                      : (value.preferredCompanySizes ?? []).filter((s) => s !== size),
                  )
                }
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink-2">Employment types</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {EMPLOYMENT_TYPES.map((t) => (
              <CheckboxField
                key={t}
                id={`emp-${t}`}
                label={EMPLOYMENT_TYPE_LABELS[t]}
                checked={(value.preferredEmploymentTypes ?? []).includes(t)}
                onCheckedChange={(checked) =>
                  set(
                    'preferredEmploymentTypes',
                    checked
                      ? [...(value.preferredEmploymentTypes ?? []), t]
                      : (value.preferredEmploymentTypes ?? []).filter((x) => x !== t),
                  )
                }
              />
            ))}
          </div>
        </fieldset>
      </FormSection>
    </div>
  );
}

/* ------------------------------------------------------- job preferences -- */

export function JobPreferencesForm({
  value,
  onChange,
}: {
  value: FullProfile['jobPreferences'];
  onChange: (v: FullProfile['jobPreferences']) => void;
}) {
  const set = <K extends keyof FullProfile['jobPreferences']>(k: K, v: FullProfile['jobPreferences'][K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="space-y-8">
      <FormSection title="What you are looking for">
        <Field label="Preferred roles" htmlFor="jp-roles">
          <TagInput
            id="jp-roles"
            value={value.preferredRoles ?? []}
            onChange={(v) => set('preferredRoles', v)}
            suggestions={TITLE_SUGGESTIONS}
            max={20}
          />
        </Field>

        <Field label="Preferred locations" htmlFor="jp-locations" required>
          <TagInput
            id="jp-locations"
            value={value.preferredLocations ?? []}
            onChange={(v) => set('preferredLocations', v)}
            suggestions={LOCATION_SUGGESTIONS}
            max={20}
          />
        </Field>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-ink-2">Work mode</legend>
          <RadioCards
            name="workMode"
            value={value.workMode ?? 'any'}
            onValueChange={(v) => set('workMode', v as FullProfile['jobPreferences']['workMode'])}
            columns={2}
            options={[
              { value: 'remote', label: 'Remote', description: 'Fully distributed roles' },
              { value: 'hybrid', label: 'Hybrid', description: 'Some days in an office' },
              { value: 'onsite', label: 'On-site', description: 'In the office' },
              { value: 'any', label: 'No preference', description: 'Do not filter on this' },
            ]}
          />
        </fieldset>

        <SwitchField
          id="jp-relocate"
          label="Willing to relocate"
          description="Roles outside your preferred locations will not be penalised as heavily."
          checked={value.willingToRelocate ?? false}
          onCheckedChange={(v) => set('willingToRelocate', v)}
        />
      </FormSection>

      <FormSection
        title="Compensation"
        description="Stored only on your account. Never sent to an employer, and never used to answer a salary question unless you explicitly allow reuse."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Currency" htmlFor="jp-currency">
            <SimpleSelect
              id="jp-currency"
              value={value.currency ?? 'INR'}
              onValueChange={(v) => set('currency', v as FullProfile['jobPreferences']['currency'])}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </Field>
          <Field label="Current CTC" htmlFor="jp-current" help="Optional.">
            <NumberInput id="jp-current" value={value.currentCtc} onChange={(v) => set('currentCtc', v)} min={0} />
          </Field>
          <Field label="Minimum expected CTC" htmlFor="jp-min" required>
            <NumberInput id="jp-min" value={value.minExpectedCtc} onChange={(v) => set('minExpectedCtc', v)} min={0} />
          </Field>
          <Field label="Maximum expected CTC" htmlFor="jp-max" help="Optional.">
            <NumberInput id="jp-max" value={value.maxExpectedCtc} onChange={(v) => set('maxExpectedCtc', v)} min={0} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Availability and authorisation">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Notice period (days)" htmlFor="jp-notice">
            <NumberInput
              id="jp-notice"
              value={value.noticePeriodDays}
              onChange={(v) => set('noticePeriodDays', v)}
              min={0}
              max={365}
              placeholder="60"
            />
          </Field>
          <Field label="Available from" htmlFor="jp-availability" help="Leave blank if immediately available.">
            <Input
              id="jp-availability"
              type="date"
              value={value.availabilityDate}
              onChange={(e) => set('availabilityDate', e.target.value)}
            />
          </Field>
          <Field label="Work authorisation" htmlFor="jp-auth">
            <SimpleSelect
              id="jp-auth"
              value={value.workAuthorization}
              onValueChange={(v) => set('workAuthorization', v as FullProfile['jobPreferences']['workAuthorization'])}
              options={opts(WORK_AUTH, WORK_AUTH_LABELS)}
              placeholder="Select"
            />
          </Field>
          <div className="flex items-end pb-1">
            <SwitchField
              id="jp-sponsorship"
              label="I need visa sponsorship"
              checked={value.needsVisaSponsorship ?? false}
              onCheckedChange={(v) => set('needsVisaSponsorship', v)}
            />
          </div>
        </div>
      </FormSection>

      <FormSection title="Targets and exclusions">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Preferred companies" htmlFor="jp-preferred-co">
            <TagInput
              id="jp-preferred-co"
              value={value.preferredCompanies ?? []}
              onChange={(v) => set('preferredCompanies', v)}
              max={50}
            />
          </Field>
          <Field label="Excluded companies" htmlFor="jp-excluded-co" help="These never appear in discovery.">
            <TagInput
              id="jp-excluded-co"
              value={value.excludedCompanies ?? []}
              onChange={(v) => set('excludedCompanies', v)}
              max={50}
            />
          </Field>
          <Field label="Custom search keywords" htmlFor="jp-keywords">
            <TagInput
              id="jp-keywords"
              value={value.customKeywords ?? []}
              onChange={(v) => set('customKeywords', v)}
              max={50}
            />
          </Field>
          <Field label="Excluded keywords" htmlFor="jp-excl-keywords">
            <TagInput
              id="jp-excl-keywords"
              value={value.excludedKeywords ?? []}
              onChange={(v) => set('excludedKeywords', v)}
              max={50}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection
        title="Limits"
        description="CareerPilot360 prepares work on a schedule. It never submits an application on its own, whatever these are set to."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Minimum match score" htmlFor="jp-minscore" help="Hide matches below this.">
            <NumberInput
              id="jp-minscore"
              value={value.minMatchScore}
              onChange={(v) => set('minMatchScore', v ?? 60)}
              min={0}
              max={100}
            />
          </Field>
          <Field label="Max packets per day" htmlFor="jp-maxapps" help="Caps prepared packets, not submissions.">
            <NumberInput
              id="jp-maxapps"
              value={value.maxApplicationsPerDay}
              onChange={(v) => set('maxApplicationsPerDay', v ?? 5)}
              min={1}
              max={50}
            />
          </Field>
          <Field label="Preparation schedule" htmlFor="jp-schedule">
            <SimpleSelect
              id="jp-schedule"
              value={value.applicationSchedule ?? 'daily'}
              onValueChange={(v) => set('applicationSchedule', v as FullProfile['jobPreferences']['applicationSchedule'])}
              options={opts(SCHEDULE_EXPRESSIONS, SCHEDULE_LABELS)}
            />
          </Field>
        </div>
      </FormSection>
    </div>
  );
}

/* --------------------------------------------------- application profile -- */

export function ApplicationProfileForm({
  value,
  onChange,
}: {
  value: FullProfile['applicationProfile'];
  onChange: (v: FullProfile['applicationProfile']) => void;
}) {
  const set = <K extends keyof FullProfile['applicationProfile']>(
    k: K,
    v: FullProfile['applicationProfile'][K],
  ) => onChange({ ...value, [k]: v });

  const answers = value.customAnswers ?? [];

  return (
    <div className="space-y-8">
      <FormSection title="Address" description="Only used to fill an application form you are completing yourself.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Address line 1" htmlFor="ap-addr1" className="sm:col-span-2">
            <Input id="ap-addr1" value={value.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} />
          </Field>
          <Field label="City" htmlFor="ap-city">
            <Input id="ap-city" value={value.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="State / region" htmlFor="ap-state">
            <Input id="ap-state" value={value.state} onChange={(e) => set('state', e.target.value)} />
          </Field>
          <Field label="Postal code" htmlFor="ap-postal">
            <Input id="ap-postal" value={value.postalCode} onChange={(e) => set('postalCode', e.target.value)} />
          </Field>
          <Field label="Country" htmlFor="ap-country">
            <Input id="ap-country" value={value.country} onChange={(e) => set('country', e.target.value)} />
          </Field>
        </div>
      </FormSection>

      <FormSection
        title="Reusable explanations"
        description="Written by you, in your words. These are the only sentences the packet generator may reuse verbatim for sensitive questions."
      >
        <Field label="Notice period explanation" htmlFor="ap-notice">
          <Textarea
            id="ap-notice"
            value={value.noticePeriodExplanation}
            onChange={(e) => set('noticePeriodExplanation', e.target.value)}
            rows={2}
            placeholder="I am on a 60-day notice period and can potentially negotiate a shorter exit."
          />
        </Field>
        <Field label="Salary expectation explanation" htmlFor="ap-salary">
          <Textarea
            id="ap-salary"
            value={value.salaryExplanation}
            onChange={(e) => set('salaryExplanation', e.target.value)}
            rows={2}
          />
        </Field>
        <Field label="Relocation explanation" htmlFor="ap-relocation">
          <Textarea
            id="ap-relocation"
            value={value.relocationExplanation}
            onChange={(e) => set('relocationExplanation', e.target.value)}
            rows={2}
          />
        </Field>
      </FormSection>

      <FormSection title="Sensitive question handling">
        <Alert tone="warning">
          <p className="text-[13px] leading-relaxed">
            Questions about salary, work authorisation, criminal history, disability, gender, age, relocation and notice
            period are never auto-answered by default. With reuse off, each one is marked{' '}
            <strong className="font-semibold text-ink">“Needs user input”</strong> on the packet so you answer it
            yourself.
          </p>
        </Alert>
        <SwitchField
          id="ap-reuse"
          label="Allow reuse of my saved answers for sensitive questions"
          description="Only your own saved text is ever reused. Nothing is generated for these questions."
          checked={value.allowSensitiveAnswerReuse ?? false}
          onCheckedChange={(v) => set('allowSensitiveAnswerReuse', v)}
        />
      </FormSection>

      <FormSection
        title="Optional personal information"
        description="Never required, never used for matching, and never sent to an AI provider. Provide it only if an application form you complete asks for it."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pronouns" htmlFor="ap-pronouns">
            <Input
              id="ap-pronouns"
              value={value.pronouns}
              onChange={(e) => set('pronouns', e.target.value)}
              placeholder="they/them"
            />
          </Field>
          <Field
            label="Date of birth"
            htmlFor="ap-dob"
            help="Only if a supported application flow explicitly requires it."
          >
            <Input id="ap-dob" type="date" value={value.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
          </Field>
        </div>
        <Field
          label="Disability or diversity information"
          htmlFor="ap-diversity"
          help="Entirely optional. Stored on your account only."
        >
          <Textarea
            id="ap-diversity"
            value={value.diversityInfo}
            onChange={(e) => set('diversityInfo', e.target.value)}
            rows={2}
          />
        </Field>
      </FormSection>

      <FormSection title="Reusable question answers" description="Common application questions, answered once.">
        <div className="space-y-3">
          {answers.map((row, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-line bg-surface-2 p-3">
              <Field label="Question" htmlFor={`ans-q-${i}`}>
                <Input
                  id={`ans-q-${i}`}
                  value={row.question}
                  onChange={(e) => {
                    const next = [...answers];
                    next[i] = { ...row, question: e.target.value };
                    set('customAnswers', next);
                  }}
                  placeholder="Why are you looking for a new role?"
                />
              </Field>
              <Field label="Your answer" htmlFor={`ans-a-${i}`}>
                <Textarea
                  id={`ans-a-${i}`}
                  value={row.answer}
                  onChange={(e) => {
                    const next = [...answers];
                    next[i] = { ...row, answer: e.target.value };
                    set('customAnswers', next);
                  }}
                  rows={3}
                />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <CheckboxField
                  id={`ans-reuse-${i}`}
                  label="Allow automatic reuse"
                  checked={row.allowReuse ?? true}
                  onCheckedChange={(v) => {
                    const next = [...answers];
                    next[i] = { ...row, allowReuse: v };
                    set('customAnswers', next);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => set('customAnswers', answers.filter((_, j) => j !== i))}
                >
                  <Trash2 aria-hidden />
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => set('customAnswers', [...answers, { question: '', answer: '', allowReuse: true }])}
          >
            <Plus aria-hidden />
            Add a question
          </Button>
        </div>
      </FormSection>
    </div>
  );
}
