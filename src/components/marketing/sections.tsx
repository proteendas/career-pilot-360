import Link from 'next/link';
import {
  Bot,
  CalendarClock,
  ExternalLink,
  FileSearch,
  Gauge,
  KeyRound,
  Layers,
  LockKeyhole,
  Mail,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Target,
  UserCheck,
  Wand2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Reveal, RevealGroup, RevealItem } from '@/components/motion/reveal';
import { cn } from '@/lib/utils';

/* --------------------------------------------------------------- helpers -- */

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'center',
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: 'center' | 'left';
}) {
  return (
    <div className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center')}>
      {eyebrow ? (
        <p className="mb-2.5 text-[11px] font-semibold tracking-[0.14em] text-accent uppercase">{eyebrow}</p>
      ) : null}
      <h2 className="text-3xl leading-tight font-bold tracking-tight text-ink sm:text-[2.1rem]">{title}</h2>
      {description ? <p className="mt-3.5 text-[16px] leading-relaxed text-ink-3">{description}</p> : null}
    </div>
  );
}

function Section({
  id,
  children,
  className,
  tone = 'paper',
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
  tone?: 'paper' | 'raised';
}) {
  return (
    <section
      id={id}
      className={cn(
        'scroll-mt-20 border-t border-line py-20',
        tone === 'raised' && 'bg-paper-2',
        className,
      )}
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------- workflow --- */

const STEPS = [
  {
    n: '01',
    icon: FileSearch,
    title: 'Upload resume',
    body: 'PDF or DOCX. We validate, parse and normalise it into structured sections. Your original file is preserved and never overwritten.',
  },
  {
    n: '02',
    icon: Gauge,
    title: 'Improve resume',
    body: 'A transparent heuristic ATS score with section-level breakdowns, plus suggestions you accept, edit or reject one at a time.',
  },
  {
    n: '03',
    icon: ScanSearch,
    title: 'Discover jobs',
    body: 'Roles from public Greenhouse, Lever and Ashby boards, authorised APIs, or any job URL you paste. Every result is labelled with its source.',
  },
  {
    n: '04',
    icon: Wand2,
    title: 'Tailor application',
    body: 'A per-job resume version, cover letter and screening answers — each statement traceable back to your resume or profile.',
  },
  {
    n: '05',
    icon: UserCheck,
    title: 'Apply with control',
    body: 'Review the whole packet, open the official portal in a new tab, copy or download everything, then confirm when you have submitted.',
  },
  {
    n: '06',
    icon: Layers,
    title: 'Track every application',
    body: 'A full timeline per application, an append-only audit trail, and reminders that prepare work instead of acting for you.',
  },
] as const;

export function WorkflowSection() {
  return (
    <Section id="how-it-works" tone="raised">
      <SectionHeading
        eyebrow="The workflow"
        title="Six steps, and you approve every one"
        description="CareerPilot360 does the preparation. The decisions that reach an employer stay yours."
      />
      <RevealGroup className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((s) => (
          <RevealItem key={s.n}>
            <Card className="group h-full transition-shadow hover:shadow-lift">
              <CardContent className="pt-5">
                <div className="mb-3.5 flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg border border-line bg-surface-2 text-accent transition-colors group-hover:border-accent/40 group-hover:bg-accent-soft">
                    <s.icon className="size-4" aria-hidden />
                  </span>
                  <span className="font-mono text-xs font-medium text-ink-4">{s.n}</span>
                </div>
                <CardTitle className="mb-1.5">{s.title}</CardTitle>
                <CardDescription>{s.body}</CardDescription>
              </CardContent>
            </Card>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* ------------------------------------------------------------- features --- */

const FEATURES = [
  {
    icon: Gauge,
    title: 'Transparent ATS analysis',
    body: 'A 0–100 heuristic score built from fourteen weighted signals — contact completeness, keyword coverage, measurable achievements, parsing compatibility and more. Every point is explained, and we never claim it is the score an employer will see.',
    points: ['Section-level scores', 'Missing & overused keywords', 'Ambiguous date detection'],
  },
  {
    icon: Wand2,
    title: 'AI resume tailoring that will not lie',
    body: 'Suggestions are grounded in evidence from your own resume and profile. The engine can sharpen "worked on an ERP application" — it cannot invent user counts, revenue, percentages or team sizes.',
    points: ['Before/after diff per change', 'Accept, edit or reject individually', 'Safe-to-auto-apply flagging'],
  },
  {
    icon: Target,
    title: 'Job matching you can audit',
    body: 'Deterministic scoring across required skills, experience, seniority, location, CTC, authorisation and notice period. AI only explains the result — it does not decide it.',
    points: ['Genuine gap analysis', 'Transferable skills', 'Never infers a skill you did not claim'],
  },
  {
    icon: Layers,
    title: 'Application tracking',
    body: 'Fifteen explicit statuses from draft to offer, a timeline per application, and an append-only audit event for every state change.',
    points: ['Manual submission confirmation', 'Per-application packet history', 'Searchable audit log'],
  },
  {
    icon: Mail,
    title: 'Recruiter outreach assistant',
    body: 'Drafts a tailored cold email, subject line, LinkedIn message and follow-up. Contacts come only from you, a public company page, or an authorised API — never scraped, never guessed.',
    points: ['Explicit per-send confirmation', 'Suppression list & daily caps', 'LinkedIn is draft-and-copy only'],
  },
  {
    icon: CalendarClock,
    title: 'Scheduling that prepares, not acts',
    body: 'Queue discovery, match recalculation and packet preparation on your cadence. Scheduled work produces something for you to review — it never submits an application on its own.',
    points: ['Database-backed task queue', 'Idempotent retries', 'Reminders, not autopilot'],
  },
  {
    icon: KeyRound,
    title: 'Bring your own AI key',
    body: 'Connect Groq, Google Gemini, OpenRouter, Mistral, OpenAI, Anthropic or any OpenAI-compatible endpoint. Keys are encrypted with AES-256-GCM and never returned to the browser.',
    points: ['Per-task provider routing', 'Token & cost ceilings', 'Deterministic non-AI fallbacks'],
  },
  {
    icon: Bot,
    title: 'An assistant with real tools',
    body: 'Ask it to explain a match, find gaps or draft outreach. Every tool call is schema-validated, scoped to your account, and any change to your data needs your confirmation first.',
    points: ['Prompt-injection defences', 'Full tool-call transcript', 'Confirmation before mutation'],
  },
] as const;

export function FeaturesSection() {
  return (
    <Section id="features">
      <SectionHeading
        eyebrow="Capabilities"
        title="Everything you need, nothing you did not agree to"
        description="Each capability is built to be inspectable. If the product cannot show you why it said something, it does not say it."
      />
      <RevealGroup className="mt-12 grid gap-4 md:grid-cols-2">
        {FEATURES.map((f) => (
          <RevealItem key={f.title}>
            <Card className="h-full transition-shadow hover:shadow-lift">
              <CardContent className="pt-5">
                <div className="mb-3 flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <f.icon className="size-4" aria-hidden />
                  </span>
                  <CardTitle className="pt-1.5">{f.title}</CardTitle>
                </div>
                <CardDescription>{f.body}</CardDescription>
                <ul className="mt-4 flex flex-wrap gap-1.5">
                  {f.points.map((p) => (
                    <li key={p}>
                      <Badge tone="outline">{p}</Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* ----------------------------------------------------------- compliance --- */

const GUARANTEES = [
  {
    icon: ShieldCheck,
    title: 'What we will never do',
    items: [
      'Scrape LinkedIn, Naukri, Indeed or Glassdoor',
      'Ask for or store a job-portal password',
      'Drive a logged-in account with browser automation',
      'Send a LinkedIn DM on your behalf',
      'Submit an application without an authorised API or your confirmation',
      'Guess or infer a recruiter’s email address',
    ],
  },
  {
    icon: UserCheck,
    title: 'What always needs your review',
    items: [
      'Every AI-generated resume line, before it enters a version',
      'Every cover letter and screening answer',
      'Every recruiter email, shown in full with its attachment',
      'Every status change that claims you applied',
      'Every reuse of a sensitive profile answer',
      'Every schedule that prepares work in the background',
    ],
  },
  {
    icon: LockKeyhole,
    title: 'How your data is held',
    items: [
      'Provider API keys encrypted with AES-256-GCM, decrypted only server-side',
      'Resumes stored as private objects, served through authenticated routes',
      'Strict per-user tenant isolation on every query',
      'SSRF-guarded fetching for any URL you paste',
      'Configurable retention, one-click export, real deletion',
      'Audit log that stores summaries — never keys, never full documents',
    ],
  },
] as const;

export function ComplianceSection() {
  return (
    <Section id="trust" tone="raised">
      <SectionHeading
        eyebrow="Privacy, security & compliance"
        title="Built for the boundary between helpful and harmful"
        description="Automation that touches other people’s platforms and inboxes needs limits. Ours are written into the product, not the marketing."
      />
      <RevealGroup className="mt-12 grid gap-4 lg:grid-cols-3">
        {GUARANTEES.map((g) => (
          <RevealItem key={g.title}>
            <Card className="h-full">
              <CardContent className="pt-5">
                <div className="mb-4 flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-surface-2 text-accent">
                    <g.icon className="size-4" aria-hidden />
                  </span>
                  <CardTitle>{g.title}</CardTitle>
                </div>
                <ul className="space-y-2.5">
                  {g.items.map((i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-3">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent/60" aria-hidden />
                      {i}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </RevealItem>
        ))}
      </RevealGroup>

      <Reveal className="mt-8">
        <div className="rounded-xl border border-warning/40 bg-warning-soft/50 p-5">
          <p className="text-sm leading-relaxed text-ink-2">
            <strong className="font-semibold text-ink">A note on AI output.</strong> Everything the model writes is a
            draft. It can be wrong, and it can read as more confident than the evidence supports. CareerPilot360 marks
            anything it cannot ground in your own resume or profile as needing your input — but the responsibility for
            what you send is, and stays, yours.
          </p>
        </div>
      </Reveal>
    </Section>
  );
}

/* ------------------------------------------------------------------ FAQ --- */

const FAQS = [
  {
    q: 'Does CareerPilot360 apply to jobs for me automatically?',
    a: 'No. For external company portals it prepares the complete packet, opens the official application URL in a new tab, and lets you copy or download everything — then you confirm manually once you have submitted. Automated submission exists only as a connector interface for employers who offer an authorised API, and it is disabled unless explicitly configured.',
  },
  {
    q: 'Can it find jobs on LinkedIn or Naukri?',
    a: 'It will not scrape them. You can paste any LinkedIn or Naukri job URL and CareerPilot360 will store it as an “external user-provided listing”, match it against your resume, and build a packet for it. Opening and applying happens in your own browser session, on their site, under their terms.',
  },
  {
    q: 'Where do the jobs actually come from?',
    a: 'Public Greenhouse, Lever and Ashby job boards, authorised job APIs and public feeds, company career pages that permit access, URLs you paste, and descriptions you enter by hand. Every job carries a visible source label and a fetched-at timestamp. We do not claim to search “the whole internet”.',
  },
  {
    q: 'Will it invent achievements to make my resume look stronger?',
    a: 'No — and this is enforced, not merely requested. Suggestions must cite a source section from your resume or profile. Numbers that do not already appear in your own material (user counts, percentage gains, revenue, team size) are treated as unsupported and are never introduced. Where information is genuinely missing, you get a warning asking you to supply it.',
  },
  {
    q: 'Do I need to pay for an AI provider?',
    a: 'You bring your own key, and several providers have free tiers today — Groq, Google Gemini, OpenRouter and Mistral among them. Pricing and free-tier availability are set by those providers and can change at any time, so we do not promise any provider will stay free. You can also run the deterministic parts — ATS scoring, keyword matching, resume validation, job matching — with no AI key at all.',
  },
  {
    q: 'What happens to my resume and my data?',
    a: 'Resumes are stored as private objects and streamed back only to you through an authenticated route. Provider keys are encrypted at rest and never returned to the browser after saving. You can export everything as JSON, set a retention window, or delete your account — which removes your stored documents and cascades every row you own.',
  },
  {
    q: 'Can it email recruiters for me?',
    a: 'It drafts the email, the subject line and the follow-up, and attaches the tailored resume. Sending requires you to confirm that specific message, with the recipient, body and attachment shown in full. There are daily caps, duplicate-recipient protection and a suppression list. There is no bulk send, and no automatic follow-up unless you approve it separately.',
  },
  {
    q: 'Is it compliant with Indian data-protection law?',
    a: 'It is designed with those obligations in mind — data minimisation, purpose limitation, configurable retention, export and deletion. We deliberately do not claim automatic legal compliance: that depends on how you deploy and operate it. Read /privacy and /security for the specifics, and take your own advice.',
  },
] as const;

export function FaqSection() {
  return (
    <Section id="faq">
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <SectionHeading
            align="left"
            eyebrow="FAQ"
            title="The questions worth asking first"
            description="Mostly about what the product refuses to do."
          />
          <Button asChild variant="secondary" className="mt-6">
            <Link href="/security">
              Read the security page
              <ExternalLink aria-hidden />
            </Link>
          </Button>
        </div>
        <Reveal>
          <Accordion type="single" collapsible className="rounded-xl border border-line bg-surface px-5">
            {FAQS.map((f, i) => (
              <AccordionItem key={f.q} value={`faq-${i}`}>
                <AccordionTrigger>{f.q}</AccordionTrigger>
                <AccordionContent>{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------- final CTA - */

export function CtaSection() {
  return (
    <Section tone="raised">
      <Reveal>
        <div className="relative overflow-hidden rounded-2xl border border-line bg-surface px-6 py-14 text-center shadow-soft">
          <div className="cp-glow pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative mx-auto max-w-xl">
            <span className="mb-5 inline-flex size-11 items-center justify-center rounded-xl bg-accent text-white shadow-soft">
              <Sparkles className="size-5" aria-hidden />
            </span>
            <h2 className="text-3xl font-bold tracking-tight text-ink">Start with your resume</h2>
            <p className="mt-3 text-[16px] leading-relaxed text-ink-3">
              Upload a PDF or DOCX and get a heuristic ATS score with section-level detail in under a minute. No AI key
              required for the deterministic analysis.
            </p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/signup">Analyse my resume</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/features">See every feature</Link>
              </Button>
            </div>
            <p className="mt-5 text-xs text-ink-4">
              Free to start · Your own AI key · No portal passwords, ever
            </p>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
