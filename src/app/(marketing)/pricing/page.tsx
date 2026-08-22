import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, Info, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { SectionHeading } from '@/components/marketing/sections';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'CareerPilot360 is self-hostable and bring-your-own-key. Here is what that actually costs.',
};

const TIERS = [
  {
    name: 'Self-hosted',
    price: 'Free',
    cadence: 'open deployment',
    blurb: 'Run it yourself on Vercel. Everything in the product, no feature gates.',
    cta: { label: 'Deploy it', href: '/signup' },
    featured: true,
    includes: [
      'Full ATS analysis and suggestions',
      'Unlimited resume versions and PDF exports',
      'All compliant job sources',
      'Job matching and tailored packets',
      'Outreach drafting with confirmed sending',
      'Scheduling and background preparation',
      'Assistant with tool calls',
      'Audit log, export and deletion',
    ],
    costs: [
      'Your own AI provider key (many have free tiers)',
      'A Postgres database — free tiers exist on the Vercel Marketplace',
      'Vercel Blob storage for documents',
      'An email provider, only if you want real sending',
    ],
  },
  {
    name: 'Hosted',
    price: 'Not yet available',
    cadence: '',
    blurb: 'A managed deployment with the same guarantees. Not offered today, and we would rather say so than take a waitlist email.',
    cta: { label: 'Read the security page', href: '/security' },
    featured: false,
    includes: [
      'Same product, operated for you',
      'Same compliance posture — no scraping, no automation',
      'Same bring-your-own-key model',
    ],
    costs: ['Nothing to pay, because there is nothing to buy yet'],
  },
] as const;

const AI_PROVIDERS = [
  { name: 'Groq', note: 'Fast inference, generous free developer tier at the time of writing.', free: true },
  { name: 'Google Gemini', note: 'Free tier available for several models.', free: true },
  { name: 'OpenRouter', note: 'Routes to many models; some free options.', free: true },
  { name: 'Mistral', note: 'Free tier on some endpoints.', free: true },
  { name: 'OpenAI', note: 'Paid per token.', free: false },
  { name: 'Anthropic', note: 'Paid per token.', free: false },
  { name: 'Azure OpenAI', note: 'Paid, billed through your Azure subscription.', free: false },
  { name: 'Any OpenAI-compatible endpoint', note: 'Including a local model you run yourself.', free: true },
] as const;

export default function PricingPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="cp-glow pointer-events-none absolute inset-x-0 top-0 h-72" aria-hidden />
        <div className="relative mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            eyebrow="Pricing"
            title="You bring the key. We bring the guardrails."
            description="CareerPilot360 has no per-seat licence and no feature gates. What it costs is whatever your own infrastructure and AI provider charge."
          />
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
          <div className="grid gap-5 md:grid-cols-2">
            {TIERS.map((tier) => (
              <Card
                key={tier.name}
                className={cn(
                  'relative flex h-full flex-col',
                  tier.featured && 'border-accent/40 shadow-lift',
                )}
              >
                {tier.featured ? (
                  <Badge tone="accent" className="absolute -top-2.5 left-5">
                    Available now
                  </Badge>
                ) : null}
                <CardContent className="flex flex-1 flex-col pt-6">
                  <h2 className="text-lg font-semibold text-ink">{tier.name}</h2>
                  <p className="mt-3 flex items-baseline gap-2">
                    <span className="text-3xl font-bold tracking-tight text-ink">{tier.price}</span>
                    {tier.cadence ? <span className="text-sm text-ink-4">{tier.cadence}</span> : null}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-ink-3">{tier.blurb}</p>

                  <div className="mt-6 space-y-4">
                    <div>
                      <p className="mb-2 text-[11px] font-semibold tracking-wide text-ink-4 uppercase">Includes</p>
                      <ul className="space-y-1.5">
                        {tier.includes.map((f) => (
                          <li key={f} className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-2">
                            <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-2 text-[11px] font-semibold tracking-wide text-ink-4 uppercase">
                        What you pay for
                      </p>
                      <ul className="space-y-1.5">
                        {tier.costs.map((f) => (
                          <li key={f} className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-3">
                            <Minus className="mt-0.5 size-3.5 shrink-0 text-ink-4" aria-hidden />
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="mt-auto pt-6">
                    <Button asChild variant={tier.featured ? 'primary' : 'secondary'} className="w-full">
                      <Link href={tier.cta.href}>{tier.cta.label}</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Alert tone="warning" className="mt-8" icon={<Info className="size-4" />}>
            <p className="text-[13px] leading-relaxed">
              <strong className="font-semibold text-ink">On “free” AI providers.</strong> Several providers offer free
              tiers today, and the table below reflects that. Those tiers are theirs to change or withdraw at any time,
              so we will not promise any provider stays free. The deterministic half of CareerPilot360 — ATS scoring,
              keyword coverage, resume validation, deduplication and match scoring — runs with no AI provider at all.
            </p>
          </Alert>

          <div className="mt-14">
            <SectionHeading
              align="left"
              eyebrow="Bring your own key"
              title="Providers you can connect"
              description="Add a key in Settings. It is encrypted with AES-256-GCM and never returned to your browser."
            />
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {AI_PROVIDERS.map((p) => (
                <li key={p.name}>
                  <div className="flex items-start gap-3 rounded-lg border border-line bg-surface p-3.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">{p.name}</span>
                      <span className="block text-xs leading-relaxed text-ink-4">{p.note}</span>
                    </span>
                    {p.free ? (
                      <Badge tone="success" className="shrink-0">
                        Free tier today
                      </Badge>
                    ) : (
                      <Badge tone="neutral" className="shrink-0">
                        Paid
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-14">
            <SectionHeading align="left" eyebrow="FAQ" title="Cost questions" />
            <Accordion type="single" collapsible className="mt-5 rounded-xl border border-line bg-surface px-5">
              <AccordionItem value="q1">
                <AccordionTrigger>Can I use it with no AI key at all?</AccordionTrigger>
                <AccordionContent>
                  Yes. Resume parsing, the ATS score and its section breakdown, keyword coverage, formatting and date
                  warnings, deduplication, and the deterministic match score all run without a provider. What you lose
                  is the generated prose: rewritten bullet suggestions, cover letters, screening answers, outreach drafts
                  and the assistant.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="q2">
                <AccordionTrigger>How many tokens does a typical task use?</AccordionTrigger>
                <AccordionContent>
                  It depends on your resume length and the job description, but the order of magnitude is a few thousand
                  tokens for a resume analysis pass and a few thousand for a tailored packet. You can set a monthly token
                  ceiling per provider, watch actual usage on the dashboard, and disable AI for specific tasks.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="q3">
                <AccordionTrigger>What does the database and storage cost?</AccordionTrigger>
                <AccordionContent>
                  For one person’s job search, very little — this is text and a handful of PDFs. Several Postgres
                  providers on the Vercel Marketplace have free tiers that comfortably fit a single user, and Vercel Blob
                  has a free allowance. For local development you do not need either: the app can run against an
                  in-process Postgres and the local filesystem.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="q4">
                <AccordionTrigger>Is there a limit on applications?</AccordionTrigger>
                <AccordionContent>
                  Not one we impose, but you set your own: a maximum number of prepared packets per day, and a minimum
                  match score below which nothing is surfaced. Email sending has a hard daily cap and duplicate-recipient
                  protection, deliberately, because bulk unsolicited outreach is not a use case this product supports.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </div>
      </section>
    </>
  );
}
