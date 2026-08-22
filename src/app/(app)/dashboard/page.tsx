import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  Briefcase,
  CalendarClock,
  Cpu,
  FileText,
  Gauge,
  Mail,
  Send,
  Sparkles,
  Target,
  Wand2,
} from 'lucide-react';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { VerifyEmailBanner } from '@/components/app-shell/verify-banner';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ScoreRing } from '@/components/ui/score-ring';
import { Progress } from '@/components/ui/progress';
import { Alert } from '@/components/ui/alert';
import { requireUserPage } from '@/lib/auth';
import { loadDashboard } from '@/lib/dashboard';
import { loadProfile } from '@/lib/profile/service';
import { profileCompleteness } from '@/lib/profile/types';
import { EVENT_TYPE_LABELS, STATUS_META, type ApplicationStatus } from '@/lib/applications/state';
import { featureFlags } from '@/lib/env';
import { databaseDriverId } from '@/lib/db';
import { formatDate, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const user = await requireUserPage('/dashboard');
  const [data, profile] = await Promise.all([loadDashboard(user.id), loadProfile(user.id)]);
  const completeness = profileCompleteness(profile);
  const flags = featureFlags();

  const firstName = (profile.personal.preferredName || profile.personal.fullName || user.name || '').split(' ')[0];

  return (
    <PageShell>
      {!user.emailVerified ? <VerifyEmailBanner email={user.email} /> : null}

      {databaseDriverId() === 'pglite' ? (
        <Alert tone="info" className="mb-5">
          <p className="text-[13px] leading-relaxed">
            Running on the in-process <strong className="font-semibold text-ink">PGlite</strong> development database.
            Data lives in <code className="font-mono text-[12px]">.pglite/</code> on this machine. For production, set{' '}
            <code className="font-mono text-[12px]">DATABASE_URL</code> to a Postgres instance from the Vercel
            Marketplace.
          </p>
        </Alert>
      ) : null}

      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : 'Welcome to CareerPilot360'}
        description="Everything here is prepared for your review. Nothing reaches an employer or a recruiter until you confirm it."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/assistant">
                <Bot aria-hidden />
                Ask the assistant
              </Link>
            </Button>
            <Button asChild>
              <Link href="/resume">
                <FileText aria-hidden />
                {data.hasAnyResume ? 'Open Resume Center' : 'Upload a resume'}
              </Link>
            </Button>
          </>
        }
      />

      {/* ------------------------------------------------------------- stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="ATS score"
          value={data.atsScore}
          unit="/ 100"
          tone="accent"
          icon={<Gauge className="size-3.5" />}
          href={data.defaultResumeVersionId ? `/resume/${data.defaultResumeVersionId}/analysis` : '/resume'}
          hint={data.atsAnalysedAt ? `Heuristic · analysed ${relativeTime(data.atsAnalysedAt)}` : undefined}
          emptyLabel="Upload a resume to get a heuristic score"
        />
        <StatCard
          label="Open suggestions"
          value={data.hasAnyResume ? data.pendingSuggestions : null}
          tone={data.pendingSuggestions > 0 ? 'warning' : 'success'}
          icon={<Wand2 className="size-3.5" />}
          href={data.defaultResumeVersionId ? `/resume/${data.defaultResumeVersionId}/suggestions` : '/resume'}
          hint={
            data.pendingSuggestions > 0
              ? `${data.acceptedSuggestions} already applied`
              : data.acceptedSuggestions > 0
                ? `${data.acceptedSuggestions} applied · nothing pending`
                : 'Nothing pending'
          }
          emptyLabel="Analysis produces reviewable suggestions"
        />
        <StatCard
          label="Strong matches"
          value={data.strongMatches || null}
          tone="success"
          icon={<Target className="size-3.5" />}
          href="/matches"
          hint={data.newMatches > 0 ? `${data.newMatches} scored this week` : 'Scored 75 or above'}
          emptyLabel="Import or discover jobs to see matches"
        />
        <StatCard
          label="Applications this week"
          value={data.applicationsThisWeek || null}
          tone="accent"
          icon={<Send className="size-3.5" />}
          href="/applications"
          hint={data.applicationsTotal > 0 ? `${data.applicationsTotal} tracked in total` : undefined}
          emptyLabel="Nothing tracked yet"
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Scheduled tasks"
          value={data.scheduledTasks || null}
          tone="info"
          icon={<CalendarClock className="size-3.5" />}
          href="/schedule"
          hint={data.activeSchedules > 0 ? `${data.activeSchedules} active schedules` : 'Prepares work, never submits'}
          emptyLabel="No background work queued"
        />
        <StatCard
          label="Interview pipeline"
          value={data.interviewCount || null}
          tone="accent"
          icon={<Briefcase className="size-3.5" />}
          href="/applications"
          hint={data.offerCount > 0 ? `${data.offerCount} offer${data.offerCount === 1 ? '' : 's'}` : undefined}
          emptyLabel="No interviews recorded"
        />
        <StatCard
          label="Outreach"
          value={data.outreachDrafted || null}
          unit="drafted"
          tone="warning"
          icon={<Mail className="size-3.5" />}
          href="/outreach"
          hint={data.outreachSent > 0 ? `${data.outreachSent} confirmed and sent` : 'Each send needs your confirmation'}
          emptyLabel="No drafts yet"
        />
        <StatCard
          label="AI usage"
          value={data.aiTokensThisMonth ? data.aiTokensThisMonth.toLocaleString('en-US') : null}
          unit="tokens"
          tone="neutral"
          icon={<Cpu className="size-3.5" />}
          href="/settings/ai-providers"
          hint={data.aiCallsThisMonth > 0 ? `${data.aiCallsThisMonth} calls this month` : undefined}
          emptyLabel={flags.appLevelAiFallback ? 'No AI calls yet this month' : 'Connect a provider key to enable AI'}
        />
      </div>

      {/* ------------------------------------------------------- main columns */}
      <div className="mt-6 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        {/* Left: next actions */}
        <div className="space-y-4">
          {!data.hasAnyResume ? (
            <Card>
              <CardHeader>
                <CardTitle>Start here</CardTitle>
                <CardDescription>
                  The deterministic parts of CareerPilot360 — ATS scoring, keyword coverage, resume validation and job
                  matching — run without any AI key at all.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EmptyState
                  icon={<FileText className="size-5" />}
                  title="Upload your resume"
                  description="PDF or DOCX, up to 1 MB. Your original file is preserved and never overwritten."
                  action={
                    <Button asChild>
                      <Link href="/resume">
                        Upload resume
                        <ArrowRight aria-hidden />
                      </Link>
                    </Button>
                  }
                  secondaryAction={
                    <Button asChild variant="secondary">
                      <Link href="/profile">Complete profile first</Link>
                    </Button>
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <CardTitle>Resume health</CardTitle>
                  <CardDescription>
                    A heuristic score, not the score any specific employer’s ATS will produce.
                  </CardDescription>
                </div>
                <Button asChild variant="secondary" size="sm">
                  <Link href="/resume">Open</Link>
                </Button>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-6">
                <ScoreRing score={data.atsScore ?? 0} label="ATS" />
                <div className="min-w-[12rem] flex-1 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-3">Suggestions pending</span>
                    <span className="font-semibold text-ink">{data.pendingSuggestions}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-3">Improvements applied</span>
                    <span className="font-semibold text-ink">{data.acceptedSuggestions}</span>
                  </div>
                  {data.atsAnalysedAt ? (
                    <p className="text-xs text-ink-4">Last analysed {formatDate(data.atsAnalysedAt)}</p>
                  ) : (
                    <p className="text-xs text-ink-4">Not analysed yet.</p>
                  )}
                  <Button asChild size="sm" variant="secondary" className="w-full">
                    <Link
                      href={
                        data.defaultResumeVersionId
                          ? `/resume/${data.defaultResumeVersionId}/suggestions`
                          : '/resume'
                      }
                    >
                      Review suggestions
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Every state change is recorded as an event you can audit.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.recentActivity.length === 0 ? (
                <p className="py-6 text-center text-sm text-ink-4">
                  No application activity yet. It will appear here as soon as you create a packet.
                </p>
              ) : (
                <ol className="space-y-3">
                  {data.recentActivity.map((e) => (
                    <li key={e.id} className="flex items-start gap-3">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent/70" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/applications/${e.applicationId}`}
                          className="text-[13px] font-medium text-ink hover:text-accent"
                        >
                          {EVENT_TYPE_LABELS[e.eventType] ?? e.eventType}
                        </Link>
                        <p className="text-xs text-ink-4">
                          {relativeTime(e.createdAt)}
                          {e.toStatus && STATUS_META[e.toStatus as ApplicationStatus]
                            ? ` · ${STATUS_META[e.toStatus as ApplicationStatus].label}`
                            : ''}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: profile + pipeline */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Profile completeness</CardTitle>
              <CardDescription>
                Matching quality depends on this. Missing fields become explicit warnings on a packet, never invented
                answers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-ink-3">Complete</span>
                  <span className="text-lg font-semibold tabular-nums text-ink">{completeness.score}%</span>
                </div>
                <Progress
                  value={completeness.score}
                  tone={completeness.score >= 75 ? 'success' : completeness.score >= 50 ? 'warning' : 'danger'}
                  aria-label="Profile completeness"
                />
              </div>

              {completeness.missingForMatching.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold tracking-wide text-ink-4 uppercase">Needed for matching</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {completeness.missingForMatching.map((m) => (
                      <li key={m}>
                        <Badge tone="warning">{m}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {completeness.missingForApplying.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold tracking-wide text-ink-4 uppercase">Needed for applying</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {completeness.missingForApplying.map((m) => (
                      <li key={m}>
                        <Badge tone="outline">{m}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <Button asChild variant="secondary" size="sm" className="w-full">
                <Link href="/profile">
                  {completeness.score === 100 ? 'Review profile' : 'Complete profile'}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pipeline</CardTitle>
              <CardDescription>Live application states.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.pipeline.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-4">Nothing in flight.</p>
              ) : (
                <ul className="space-y-2">
                  {data.pipeline
                    .slice()
                    .sort((a, b) => b.count - a.count)
                    .map((p) => (
                      <li key={p.status} className="flex items-center justify-between gap-3">
                        <Badge tone={STATUS_META[p.status].tone}>{STATUS_META[p.status].label}</Badge>
                        <span className="text-sm font-semibold tabular-nums text-ink">{p.count}</span>
                      </li>
                    ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {!flags.appLevelAiFallback ? (
            <Card>
              <CardContent className="pt-5">
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <Sparkles className="size-4" aria-hidden />
                  </span>
                  <CardTitle>Connect an AI provider</CardTitle>
                </div>
                <CardDescription>
                  Bring your own key from Groq, Gemini, OpenRouter, Mistral, OpenAI or Anthropic. Keys are encrypted
                  with AES-256-GCM and never returned to the browser. Free tiers exist today, but providers can change
                  their pricing at any time.
                </CardDescription>
                <Button asChild size="sm" className="mt-4 w-full">
                  <Link href="/settings/ai-providers">Add a provider key</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}
