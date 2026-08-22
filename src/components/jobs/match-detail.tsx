'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  FileText,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScoreRing, ScoreBar } from '@/components/ui/score-ring';
import { Alert } from '@/components/ui/alert';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { SourceBadge } from './source-badge';
import { rescoreJobAction } from '@/server/actions/jobs';
import { GAP_LABELS, GAP_EXPLANATIONS, type MatchResult } from '@/lib/jobs/match';
import type { JobSourceType } from '@/lib/jobs/registry';
import { formatDate } from '@/lib/utils';

const GAP_TONE: Record<string, 'danger' | 'warning' | 'neutral' | 'outline'> = {
  missing_from_resume: 'warning',
  missing_from_profile: 'outline',
  not_present: 'danger',
  unable_to_verify: 'neutral',
};

const CONCERN_TONE = { high: 'danger', medium: 'warning', low: 'neutral' } as const;

export interface JobDetailData {
  id: string;
  title: string;
  company: string;
  locationLabel: string | null;
  workMode: string | null;
  employmentType: string | null;
  salaryLabel: string | null;
  description: string;
  responsibilities: string[];
  requirements: string[];
  preferredQualifications: string[];
  applyUrl: string | null;
  canonicalUrl: string | null;
  postedAt: string | null;
  sourceType: JobSourceType;
  sourceName: string;
  sourcePolicyNote: string | null;
}

export function MatchDetailView({
  job,
  match,
  aiConfigured,
  aiReason,
  hasResume,
}: {
  job: JobDetailData;
  match: MatchResult | null;
  aiConfigured: boolean;
  aiReason?: string;
  hasResume: boolean;
}) {
  const router = useRouter();
  const [scoring, setScoring] = React.useState(false);

  async function rescore(enrich: boolean) {
    setScoring(true);
    const res = await rescoreJobAction(job.id, { enrich });
    setScoring(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not score this job.');
      return;
    }
    router.refresh();
    toast.success(res.notice ?? 'Scored.');
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_22rem]">
      {/* ------------------------------------------------------------- main */}
      <div className="min-w-0 space-y-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold text-ink">{job.title}</h1>
                <p className="text-ink-3">{job.company}</p>
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-4">
                  {job.locationLabel ? <span>{job.locationLabel}</span> : null}
                  {job.workMode && job.workMode !== 'unknown' ? <span>{job.workMode}</span> : null}
                  {job.employmentType ? <span>{job.employmentType.replace('_', ' ')}</span> : null}
                  {job.salaryLabel ? <span>{job.salaryLabel}</span> : null}
                  {job.postedAt ? <span>Posted {formatDate(job.postedAt)}</span> : null}
                </p>
              </div>
              <SourceBadge sourceType={job.sourceType} sourceName={job.sourceName} policyNote={job.sourcePolicyNote} />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {job.applyUrl ? (
                <Button asChild className="w-full min-w-0 sm:w-auto">
                  <a href={job.applyUrl} target="_blank" rel="noreferrer noopener" className="min-w-0">
                    {/* The label includes the company name, which can be arbitrarily
                        long — truncate it with an ellipsis instead of letting the
                        button's forced-nowrap text force it wider than its column. */}
                    <span className="truncate">Open on {job.company}</span>
                    <ExternalLink aria-hidden />
                  </a>
                </Button>
              ) : null}
              <Button asChild variant="secondary" className="w-full sm:w-auto">
                <Link href={`/applications/new?jobId=${job.id}`}>
                  <FileText aria-hidden />
                  Prepare application packet
                </Link>
              </Button>
            </div>

            {job.sourceType === 'external_link' ? (
              <Alert tone="neutral" className="mt-4">
                <p className="text-[13px] leading-relaxed">
                  This is a link only — nothing was fetched from {job.company === job.sourceName ? 'this platform' : job.sourceName}.
                  The description below is what you entered.
                </p>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        {job.description ? (
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="cp-prose-plain text-sm text-ink-2">{job.description}</p>
            </CardContent>
          </Card>
        ) : null}

        {job.requirements.length > 0 || job.responsibilities.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {job.responsibilities.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-[15px]">Responsibilities</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5 text-[13px] text-ink-2">
                    {job.responsibilities.map((r, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-4" aria-hidden />
                        {r}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
            {job.requirements.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-[15px]">Requirements</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5 text-[13px] text-ink-2">
                    {job.requirements.map((r, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-4" aria-hidden />
                        {r}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* --------------------------------------------------------- sidebar */}
      <aside className="space-y-4">
        <Card>
          <CardContent className="pt-5">
            {!hasResume ? (
              <Alert tone="warning">Upload a resume to score this job.</Alert>
            ) : !match ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <p className="text-sm text-ink-3">Not scored yet.</p>
                <Button onClick={() => void rescore(false)} loading={scoring}>
                  Score this job
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-col items-center gap-1">
                  <ScoreRing score={match.score} size={112} label="Match" />
                  <SimpleTooltip content="Deterministic — computed from your resume and profile against this posting. Never inferred, never invented.">
                    <span className="inline-flex cursor-help items-center gap-1 text-[11px] font-medium text-ink-4">
                      {match.mode === 'deterministic+ai' ? 'AI-explained' : 'Deterministic'}
                      <CircleHelp className="size-3" aria-hidden />
                    </span>
                  </SimpleTooltip>
                </div>

                <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{match.explanation}</p>

                <div className="mt-4 flex flex-col gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void rescore(false)} loading={scoring}>
                    <RefreshCw aria-hidden />
                    Re-score
                  </Button>
                  {aiConfigured ? (
                    <Button size="sm" variant="ghost" onClick={() => void rescore(true)} loading={scoring}>
                      <Sparkles aria-hidden />
                      Explain with AI
                    </Button>
                  ) : (
                    <p className="text-center text-[11px] text-ink-4">{aiReason}</p>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {match ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-[15px]">Signals</CardTitle>
                <CardDescription>Hover a label for how it was computed.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {match.signals
                  .filter((s) => s.score !== null)
                  .sort((a, b) => b.weight - a.weight)
                  .map((s) => (
                    <SimpleTooltip key={s.key} content={s.explanation}>
                      <div className="cursor-help">
                        <ScoreBar label={s.label} score={s.score!} weight={s.weight} />
                      </div>
                    </SimpleTooltip>
                  ))}
                {match.signals.some((s) => s.score === null) ? (
                  <p className="text-[11px] text-ink-4">
                    {match.signals.filter((s) => s.score === null).length} signal(s) had nothing to compare and were
                    excluded, not counted as zero.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            {match.concerns.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-[15px]">
                    <AlertTriangle className="size-4 text-warning" aria-hidden />
                    Concerns
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2.5">
                    {match.concerns.map((c, i) => (
                      <li key={i}>
                        <Badge tone={CONCERN_TONE[c.severity]}>{c.severity}</Badge>
                        <p className="mt-1 text-[13px] font-medium text-ink">{c.title}</p>
                        <p className="text-[12px] text-ink-3">{c.detail}</p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}

            {match.gaps.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-[15px]">
                    <Ban className="size-4 text-ink-3" aria-hidden />
                    Gaps
                  </CardTitle>
                  <CardDescription>Distinguished by how certain the absence is.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2.5">
                    {match.gaps.map((g, i) => (
                      <li key={i}>
                        <div className="flex items-center gap-2">
                          <Badge tone={GAP_TONE[g.kind]}>{GAP_LABELS[g.kind]}</Badge>
                          <span className="text-[13px] font-medium text-ink">{g.requirement}</span>
                        </div>
                        <p className="mt-0.5 text-[12px] text-ink-4">{GAP_EXPLANATIONS[g.kind]}</p>
                        {g.relatedTo.length > 0 ? (
                          <p className="mt-0.5 text-[12px] text-ink-3">
                            Adjacent skill{g.relatedTo.length > 1 ? 's' : ''} you have: {g.relatedTo.join(', ')} — context,
                            not a substitute.
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}

            {match.matchedRequiredSkills.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-[15px]">
                    <CheckCircle2 className="size-4 text-success" aria-hidden />
                    Evidenced
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-wrap gap-1.5">
                    {match.matchedRequiredSkills.map((s) => (
                      <li key={s}>
                        <Badge tone="success">{s}</Badge>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}

            {match.recommendedResumeVersionId ? (
              <Alert tone="info">
                <p className="flex items-center justify-between gap-2 text-[13px]">
                  A resume version fits this better.
                  <Link
                    href={`/resume/${match.recommendedResumeVersionId}/analysis`}
                    className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                  >
                    View
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </Link>
                </p>
              </Alert>
            ) : null}
          </>
        ) : null}
      </aside>
    </div>
  );
}
