'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import {
  ApplicationProfileForm,
  JobPreferencesForm,
  PersonalForm,
  ProfessionalForm,
} from '@/components/profile/forms';
import { completeOnboardingAction, updateProfileSectionAction } from '@/server/actions/account';
import { profileCompleteness, type FullProfile } from '@/lib/profile/types';
import { cn } from '@/lib/utils';

type StepId = 'personal' | 'professional' | 'jobPreferences' | 'applicationProfile' | 'review';

const STEPS: { id: StepId; title: string; short: string; blurb: string }[] = [
  {
    id: 'personal',
    title: 'About you',
    short: 'You',
    blurb: 'The basics that appear on your resume and application forms.',
  },
  {
    id: 'professional',
    title: 'Your experience',
    short: 'Experience',
    blurb: 'What you have done and what you want to do next. This drives matching.',
  },
  {
    id: 'jobPreferences',
    title: 'What you want',
    short: 'Preferences',
    blurb: 'Locations, compensation, availability and the limits you want respected.',
  },
  {
    id: 'applicationProfile',
    title: 'Application answers',
    short: 'Answers',
    blurb: 'Reusable answers, written by you. Optional — you can skip and fill these later.',
  },
  {
    id: 'review',
    title: 'Review',
    short: 'Review',
    blurb: 'What is complete, and what is still missing.',
  },
];

export function OnboardingWizard({ initialProfile }: { initialProfile: FullProfile }) {
  const router = useRouter();
  const [profile, setProfile] = React.useState(initialProfile);
  const [stepIndex, setStepIndex] = React.useState(0);
  const [saving, setSaving] = React.useState(false);

  const step = STEPS[stepIndex]!;
  const completeness = profileCompleteness(profile);
  const isLast = stepIndex === STEPS.length - 1;

  async function saveCurrentStep(): Promise<boolean> {
    if (step.id === 'review') return true;
    setSaving(true);
    const res = await updateProfileSectionAction(step.id, profile[step.id]);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save that step.');
      return false;
    }
    return true;
  }

  async function next() {
    if (!(await saveCurrentStep())) return;
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function back() {
    setStepIndex((i) => Math.max(i - 1, 0));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function finish() {
    setSaving(true);
    const res = await completeOnboardingAction();
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not finish onboarding.');
      return;
    }
    toast.success('Profile saved. Next: upload your resume.');
    router.push('/resume');
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      {/* ------------------------------------------------------------ header */}
      <div className="mb-7">
        <Badge tone="accent" className="mb-3">
          <Sparkles aria-hidden />
          Step {stepIndex + 1} of {STEPS.length}
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{step.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-3">{step.blurb}</p>
      </div>

      {/* -------------------------------------------------------- step rail */}
      <ol className="mb-6 flex items-center gap-1.5" aria-label="Onboarding progress">
        {STEPS.map((s, i) => {
          const done = i < stepIndex;
          const current = i === stepIndex;
          return (
            <li key={s.id} className="flex flex-1 items-center gap-1.5">
              <button
                type="button"
                onClick={() => i <= stepIndex && setStepIndex(i)}
                disabled={i > stepIndex}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg px-1 py-1.5 text-left transition-colors',
                  i <= stepIndex ? 'cursor-pointer' : 'cursor-default',
                )}
              >
                <span
                  className={cn(
                    'h-1 w-full rounded-full transition-colors',
                    done ? 'bg-success' : current ? 'bg-accent' : 'bg-line',
                  )}
                />
                <span
                  className={cn(
                    'flex items-center gap-1 truncate text-[11px] font-medium',
                    current ? 'text-ink' : done ? 'text-success' : 'text-ink-4',
                  )}
                >
                  {done ? <Check className="size-3 shrink-0" aria-hidden /> : null}
                  {s.short}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* ------------------------------------------------------------- body */}
      <Card>
        <CardContent className="pt-6">
          {step.id === 'personal' ? (
            <PersonalForm value={profile.personal} onChange={(v) => setProfile({ ...profile, personal: v })} />
          ) : null}

          {step.id === 'professional' ? (
            <ProfessionalForm
              value={profile.professional}
              onChange={(v) => setProfile({ ...profile, professional: v })}
            />
          ) : null}

          {step.id === 'jobPreferences' ? (
            <JobPreferencesForm
              value={profile.jobPreferences}
              onChange={(v) => setProfile({ ...profile, jobPreferences: v })}
            />
          ) : null}

          {step.id === 'applicationProfile' ? (
            <ApplicationProfileForm
              value={profile.applicationProfile}
              onChange={(v) => setProfile({ ...profile, applicationProfile: v })}
            />
          ) : null}

          {step.id === 'review' ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium text-ink-2">Profile completeness</span>
                  <span className="text-xl font-semibold tabular-nums text-ink">{completeness.score}%</span>
                </div>
                <Progress
                  value={completeness.score}
                  tone={completeness.score >= 75 ? 'success' : completeness.score >= 50 ? 'warning' : 'danger'}
                />
                <p className="text-xs leading-relaxed text-ink-4">
                  You can finish now and fill the rest in later. Anything missing shows up as an explicit warning on an
                  application packet — it is never invented for you.
                </p>
              </div>

              <ul className="divide-y divide-line rounded-lg border border-line">
                {completeness.items.map((item) => (
                  <li key={item.key} className="flex items-start gap-3 px-3 py-2.5">
                    <span
                      className={cn(
                        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
                        item.done ? 'bg-success text-white' : 'border border-line-strong bg-surface-2',
                      )}
                      aria-hidden
                    >
                      {item.done ? <Check className="size-2.5" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-[13px] font-medium', item.done ? 'text-ink' : 'text-ink-3')}>
                        {item.label}
                      </span>
                      <span className="block text-[11px] text-ink-4">{item.unlocks}</span>
                    </span>
                    {!item.done ? <Badge tone="outline">Missing</Badge> : null}
                  </li>
                ))}
              </ul>

              <Alert tone="info" icon={<ShieldCheck className="size-4" />}>
                <p className="text-[13px] leading-relaxed">
                  Next you will upload a resume. It is parsed into structured sections and scored against ATS
                  heuristics — no AI key required for that part. Your original file is preserved and never overwritten.
                </p>
              </Alert>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------ footer */}
      <div className="mt-5 flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={back} disabled={stepIndex === 0 || saving}>
          <ArrowLeft aria-hidden />
          Back
        </Button>

        <div className="flex items-center gap-2">
          {!isLast ? (
            <Button variant="ghost" asChild>
              <Link href="/dashboard">Finish later</Link>
            </Button>
          ) : null}
          {isLast ? (
            <Button onClick={() => void finish()} loading={saving} loadingLabel="Saving…">
              Finish and upload resume
              <ArrowRight aria-hidden />
            </Button>
          ) : (
            <Button onClick={() => void next()} loading={saving} loadingLabel="Saving…">
              Save and continue
              <ArrowRight aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
