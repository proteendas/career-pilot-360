'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  BadgeCheck,
  CalendarX,
  CircleHelp,
  Download,
  Info,
  RefreshCw,
  Sparkles,
  Target,
  TriangleAlert,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScoreRing, ScoreBar } from '@/components/ui/score-ring';
import { Alert } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { analyzeResumeAction } from '@/server/actions/resume';
import type { AtsFinding, AtsReport, Priority } from '@/lib/resume/ats';
import { relativeTime } from '@/lib/utils';

const PRIORITY_TONE: Record<Priority, 'danger' | 'warning' | 'neutral'> = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
};

const PRIORITY_LABEL: Record<Priority, string> = {
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
};

const CATEGORY_LABEL: Record<AtsFinding['category'], string> = {
  contact: 'Contact',
  sections: 'Sections',
  keywords: 'Keywords',
  skills: 'Skills',
  impact: 'Impact',
  language: 'Language',
  formatting: 'Formatting',
  dates: 'Dates',
  claims: 'Claims',
  parsing: 'Parsing',
  alignment: 'Alignment',
};

function FindingCard({ finding }: { finding: AtsFinding }) {
  return (
    <li className="rounded-lg border border-line bg-surface p-3.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <Badge tone={PRIORITY_TONE[finding.priority]}>{PRIORITY_LABEL[finding.priority]}</Badge>
        <Badge tone="outline">{CATEGORY_LABEL[finding.category]}</Badge>
      </div>
      <p className="text-[14px] font-medium text-ink">{finding.title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{finding.detail}</p>
      {finding.excerpt ? (
        <p className="cp-prose-plain mt-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-ink-2">
          {finding.excerpt}
        </p>
      ) : null}
    </li>
  );
}

export function AnalysisView({
  versionId,
  versionName,
  report: initialReport,
  analysedAt,
  pendingSuggestions,
  aiConfigured,
  aiReason,
}: {
  versionId: string;
  versionName: string;
  report: AtsReport | null;
  analysedAt: string | null;
  pendingSuggestions: number;
  aiConfigured: boolean;
  aiReason?: string;
}) {
  const router = useRouter();
  const [report, setReport] = React.useState(initialReport);
  const [running, setRunning] = React.useState(false);
  const [notice, setNotice] = React.useState<string>();
  const [lastRun, setLastRun] = React.useState(analysedAt);

  async function rerun() {
    setRunning(true);
    setNotice(undefined);
    const res = await analyzeResumeAction(versionId);
    setRunning(false);

    if (!res.ok || !res.data) {
      toast.error(res.error ?? 'The analysis failed.');
      return;
    }
    setReport(res.data.report);
    setLastRun(new Date().toISOString());
    if (res.data.aiNotice) setNotice(res.data.aiNotice);
    toast.success(
      `Score ${res.data.report.overallScore}/100 · ${res.data.suggestionCount} suggestion(s)` +
        (res.data.usedAi ? ` · ${res.data.aiProvider ?? 'AI'} assisted` : ''),
    );
    router.refresh();
  }

  if (!report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not analysed yet</CardTitle>
          <CardDescription>
            Run the analysis to get a heuristic ATS score with a section-by-section breakdown. No AI key is required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void rerun()} loading={running}>
            <Sparkles aria-hidden />
            Run analysis
          </Button>
        </CardContent>
      </Card>
    );
  }

  const grouped: Record<Priority, AtsFinding[]> = {
    high: report.findings.filter((f) => f.priority === 'high'),
    medium: report.findings.filter((f) => f.priority === 'medium'),
    low: report.findings.filter((f) => f.priority === 'low'),
  };

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------ header */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-start gap-6">
            <div className="flex flex-col items-center gap-2">
              <ScoreRing score={report.overallScore} size={124} label="ATS" />
              <SimpleTooltip
                content="A weighted mean of 14 signals computed by CareerPilot360. It is not the score any specific employer's system will produce."
              >
                <span className="inline-flex cursor-help items-center gap-1 text-[11px] font-medium text-ink-4">
                  Heuristic score
                  <CircleHelp className="size-3" aria-hidden />
                </span>
              </SimpleTooltip>
            </div>

            <div className="min-w-[16rem] flex-1 space-y-3">
              <div>
                <h2 className="text-lg font-semibold text-ink">{versionName}</h2>
                <p className="text-xs text-ink-4">
                  {lastRun ? `Analysed ${relativeTime(lastRun)}` : 'Not analysed yet'} ·{' '}
                  {report.stats.wordCount.toLocaleString('en-US')} words · {report.stats.bulletCount} bullets ·{' '}
                  {report.stats.roleCount} role{report.stats.roleCount === 1 ? '' : 's'} · ~
                  {report.stats.estimatedPages} page{report.stats.estimatedPages === 1 ? '' : 's'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void rerun()} loading={running} variant="secondary" size="sm">
                  <RefreshCw aria-hidden />
                  Re-run analysis
                </Button>
                <Button asChild size="sm">
                  <Link href={`/resume/${versionId}/suggestions`}>
                    <Wand2 aria-hidden />
                    {pendingSuggestions > 0 ? `Review ${pendingSuggestions} suggestion(s)` : 'Suggestions'}
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <a href={`/api/resume/${versionId}/pdf`}>
                    <Download aria-hidden />
                    Download PDF
                  </a>
                </Button>
              </div>
            </div>
          </div>

          <Alert tone="neutral" className="mt-5" icon={<Info className="size-4" />}>
            <p className="text-[13px] leading-relaxed">{report.scoreExplanation}</p>
          </Alert>

          {notice ? (
            <Alert tone="warning" className="mt-3">
              <p className="text-[13px] leading-relaxed">{notice}</p>
            </Alert>
          ) : null}

          {!aiConfigured && aiReason ? (
            <Alert tone="info" className="mt-3">
              <p className="text-[13px] leading-relaxed">
                {aiReason} Everything on this page is deterministic and unaffected —{' '}
                <Link href="/settings/ai-providers" className="font-medium text-accent hover:underline">
                  add a provider key
                </Link>{' '}
                only if you want AI-assisted rewrites too.
              </p>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {/* -------------------------------------------------------------- tabs */}
      <Tabs defaultValue="signals">
        <TabsList>
          <TabsTrigger value="signals">Signals</TabsTrigger>
          <TabsTrigger value="improvements">
            Improvements
            {report.findings.length > 0 ? <Badge tone="outline">{report.findings.length}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="keywords">Keywords</TabsTrigger>
          <TabsTrigger value="checks">Detail checks</TabsTrigger>
        </TabsList>

        {/* signals */}
        <TabsContent value="signals">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Section scores</CardTitle>
                <CardDescription>
                  Each signal is scored 0–100 and weighted. Hover a label to see how it was computed.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {report.signals
                  .slice()
                  .sort((a, b) => b.weight - a.weight)
                  .map((signal) => (
                    <div key={signal.key}>
                      <SimpleTooltip content={signal.explanation}>
                        <div className="cursor-help">
                          <ScoreBar label={signal.label} score={signal.score} weight={signal.weight} />
                        </div>
                      </SimpleTooltip>
                      {signal.evidence.length > 0 ? (
                        <p className="mt-1 truncate text-[11px] text-ink-4">{signal.evidence.slice(0, 2).join(' · ')}</p>
                      ) : null}
                    </div>
                  ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BadgeCheck className="size-4 text-success" aria-hidden />
                  Strengths
                </CardTitle>
                <CardDescription>Signals scoring 80 or above.</CardDescription>
              </CardHeader>
              <CardContent>
                {report.strengths.length === 0 ? (
                  <p className="py-4 text-sm text-ink-4">
                    Nothing is scoring above 80 yet. Work through the high-priority improvements first.
                  </p>
                ) : (
                  <ul className="space-y-2.5">
                    {report.strengths.map((s) => (
                      <li key={s} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-2">
                        <BadgeCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                        {s}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* improvements */}
        <TabsContent value="improvements">
          {report.findings.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <BadgeCheck className="mx-auto mb-3 size-8 text-success" aria-hidden />
                <p className="text-sm font-medium text-ink">No issues found.</p>
                <p className="mt-1 text-sm text-ink-3">Every check passed at this version.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-5">
              {(['high', 'medium', 'low'] as Priority[]).map((priority) =>
                grouped[priority].length === 0 ? null : (
                  <section key={priority}>
                    <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-ink">
                      {priority === 'high' ? (
                        <TriangleAlert className="size-4 text-danger" aria-hidden />
                      ) : priority === 'medium' ? (
                        <AlertTriangle className="size-4 text-warning" aria-hidden />
                      ) : (
                        <Info className="size-4 text-ink-4" aria-hidden />
                      )}
                      {PRIORITY_LABEL[priority]}
                      <Badge tone="outline">{grouped[priority].length}</Badge>
                    </h3>
                    <ul className="space-y-2.5">
                      {grouped[priority].map((f) => (
                        <FindingCard key={f.id} finding={f} />
                      ))}
                    </ul>
                  </section>
                ),
              )}
            </div>
          )}
        </TabsContent>

        {/* keywords */}
        <TabsContent value="keywords">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-[15px]">Matched</CardTitle>
                <CardDescription>Present in your resume.</CardDescription>
              </CardHeader>
              <CardContent>
                {report.keywords.matched.length === 0 ? (
                  <p className="text-sm text-ink-4">Nothing matched.</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {report.keywords.matched.map((k) => (
                      <li key={k}>
                        <Badge tone="success">{k}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-[15px]">Missing</CardTitle>
                <CardDescription>Add only what you genuinely have.</CardDescription>
              </CardHeader>
              <CardContent>
                {report.keywords.missing.length === 0 ? (
                  <p className="text-sm text-ink-4">Nothing missing.</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {report.keywords.missing.map((k) => (
                      <li key={k}>
                        <Badge tone="warning">{k}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-[15px]">Overused</CardTitle>
                <CardDescription>Repetition reads as stuffing.</CardDescription>
              </CardHeader>
              <CardContent>
                {report.keywords.overused.length === 0 ? (
                  <p className="text-sm text-ink-4">No term is over-repeated.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {report.keywords.overused.map((o) => (
                      <li key={o.term} className="flex items-center justify-between text-[13px]">
                        <span className="text-ink-2">{o.term}</span>
                        <Badge tone="danger">{o.count}×</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* detail checks */}
        <TabsContent value="checks">
          <Card>
            <CardContent className="pt-2">
              <Accordion type="multiple">
                <AccordionItem value="dates">
                  <AccordionTrigger>
                    <span className="flex items-center gap-2">
                      <CalendarX className="size-4 text-ink-3" aria-hidden />
                      Ambiguous dates
                      <Badge tone={report.ambiguousDates.length > 0 ? 'warning' : 'success'}>
                        {report.ambiguousDates.length}
                      </Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    {report.ambiguousDates.length === 0 ? (
                      <p>Every role has an unambiguous date range.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {report.ambiguousDates.map((d) => (
                          <li key={d} className="flex gap-2">
                            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-warning" aria-hidden />
                            {d}
                          </li>
                        ))}
                      </ul>
                    )}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="metrics">
                  <AccordionTrigger>
                    <span className="flex items-center gap-2">
                      <Target className="size-4 text-ink-3" aria-hidden />
                      Bullets without a measurable outcome
                      <Badge tone={report.bulletsMissingMetrics.length > 0 ? 'warning' : 'success'}>
                        {report.bulletsMissingMetrics.length}
                      </Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    {report.bulletsMissingMetrics.length === 0 ? (
                      <p>Every bullet carries a number or measurable result.</p>
                    ) : (
                      <>
                        <p className="mb-2.5">
                          Add a figure only where you know it. CareerPilot360 will not invent one for you.
                        </p>
                        <ul className="space-y-2">
                          {report.bulletsMissingMetrics.map((b) => (
                            <li
                              key={b.path}
                              className="cp-prose-plain rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px]"
                            >
                              {b.text}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="claims">
                  <AccordionTrigger>
                    <span className="flex items-center gap-2">
                      <AlertTriangle className="size-4 text-ink-3" aria-hidden />
                      Unsupported claims
                      <Badge tone={report.unsupportedClaims.length > 0 ? 'warning' : 'success'}>
                        {report.unsupportedClaims.length}
                      </Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    {report.unsupportedClaims.length === 0 ? (
                      <p>No empty superlatives found.</p>
                    ) : (
                      <ul className="space-y-2.5">
                        {report.unsupportedClaims.map((c) => (
                          <li key={c.path + c.text.slice(0, 20)}>
                            <p className="cp-prose-plain rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink-2">
                              {c.text}
                            </p>
                            <p className="mt-1 text-[12px] text-ink-4">{c.reason}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="titles">
                  <AccordionTrigger>
                    <span className="flex items-center gap-2">
                      <CircleHelp className="size-4 text-ink-3" aria-hidden />
                      Unclear job titles
                      <Badge tone={report.unclearTitles.length > 0 ? 'warning' : 'success'}>
                        {report.unclearTitles.length}
                      </Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    {report.unclearTitles.length === 0 ? (
                      <p>Every title should be understood outside your company.</p>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {report.unclearTitles.map((t) => (
                          <li key={t}>
                            <Badge tone="warning">{t}</Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
