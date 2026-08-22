import Link from 'next/link';
import { ArrowRight, CircleCheck, FileText, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScoreRing, ScoreBar } from '@/components/ui/score-ring';
import { Reveal } from '@/components/motion/reveal';

const PROOF = [
  'Never scrapes LinkedIn, Naukri or any job portal',
  'Nothing is sent without your explicit confirmation',
  'Bring your own AI key — or use none at all',
] as const;

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="cp-glow pointer-events-none absolute inset-x-0 top-0 h-[420px]" aria-hidden />
      <div className="cp-grid-bg pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-60" aria-hidden />

      <div className="relative mx-auto w-full max-w-6xl px-4 pt-14 pb-20 sm:px-6 lg:pt-20">
        <div className="grid min-w-0 items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          {/* ---------------------------------------------------------- copy */}
          <div className="min-w-0">
            <Reveal>
              <Badge tone="accent" className="mb-5 px-2.5 py-1">
                <Sparkles aria-hidden />
                Human-in-the-loop by design
              </Badge>
            </Reveal>

            <Reveal delay={0.05}>
              <h1 className="text-4xl leading-[1.08] font-bold tracking-tight text-ink sm:text-5xl lg:text-[3.4rem]">
                Your resume, sharpened.
                <br />
                <span className="text-accent">Your applications, controlled.</span>
              </h1>
            </Reveal>

            <Reveal delay={0.1}>
              <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-3">
                CareerPilot360 scores your resume against ATS heuristics, finds roles from sources that permit it,
                and builds a tailored application packet for each one. You review every word — and you decide when
                anything leaves your hands.
              </p>
            </Reveal>

            <Reveal delay={0.15}>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button asChild size="lg" className="group w-full sm:w-auto">
                  <Link href="/signup">
                    Analyse my resume
                    <ArrowRight className="transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="secondary" className="w-full sm:w-auto">
                  <Link href="#how-it-works">Explore how it works</Link>
                </Button>
              </div>
            </Reveal>

            <Reveal delay={0.2}>
              <ul className="mt-8 space-y-2.5">
                {PROOF.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-sm text-ink-2">
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    {p}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          {/* ------------------------------------------------------- visual */}
          <Reveal delay={0.18} y={22} className="min-w-0">
            <div className="relative">
              <div
                className="absolute -inset-4 rounded-3xl bg-accent/5 blur-2xl"
                aria-hidden
              />
              <div className="relative rounded-2xl border border-line bg-surface p-5 shadow-pop">
                <div className="flex items-center gap-2 border-b border-line pb-3">
                  <span className="flex size-7 items-center justify-center rounded-md bg-accent-soft text-accent">
                    <FileText className="size-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">ATS analysis</p>
                    <p className="truncate text-[11px] text-ink-4">senior-backend-engineer.pdf · heuristic score</p>
                  </div>
                  <Badge tone="success" className="ml-auto shrink-0">
                    Reviewed
                  </Badge>
                </div>

                <div className="flex items-center gap-5 py-5">
                  <ScoreRing score={78} label="ATS" animate={false} />
                  <div className="min-w-0 flex-1 space-y-3">
                    <ScoreBar label="Keyword coverage" score={71} />
                    <ScoreBar label="Measurable impact" score={54} />
                    <ScoreBar label="Parsing compatibility" score={93} />
                  </div>
                </div>

                <div className="space-y-2 rounded-lg border border-line bg-surface-2 p-3">
                  <p className="text-[11px] font-semibold tracking-wide text-ink-4 uppercase">
                    Suggestion · needs your review
                  </p>
                  <p className="text-[13px] leading-relaxed text-ink-2">
                    <del className="rounded bg-danger-soft px-0.5 text-danger">Worked on an ERP application</del>{' '}
                    <ins className="rounded bg-success-soft px-0.5 text-success no-underline">
                      Developed modules for an ERP application used by internal business teams
                    </ins>
                  </p>
                  <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-4">
                    <ShieldCheck className="mt-px size-3 shrink-0 text-success" aria-hidden />
                    Grounded in your existing resume. No invented metrics, users or revenue.
                  </p>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
