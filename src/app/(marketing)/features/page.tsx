import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TableWrap, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SectionHeading, FeaturesSection, WorkflowSection } from '@/components/marketing/sections';
import { JOB_SOURCE_REGISTRY, SOURCE_TYPE_LABELS, SOURCE_TYPE_TONES } from '@/lib/jobs/registry';

export const metadata: Metadata = {
  title: 'Features',
  description: 'Every capability in CareerPilot360, and the exact sources job data can come from.',
};

const CAPABILITY_LABELS: Record<string, string> = {
  search: 'Search',
  details: 'Fetch details',
  import_by_url: 'Import by URL',
  manual_entry: 'Manual entry',
};

export default function FeaturesPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="cp-glow pointer-events-none absolute inset-x-0 top-0 h-72" aria-hidden />
        <div className="relative mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            eyebrow="Features"
            title="What it does, and where the data comes from"
            description="The capability list matters less than the provenance list. Both are below."
          />
        </div>
      </section>

      <FeaturesSection />
      <WorkflowSection />

      {/* ------------------------------------------------------- job sources */}
      <section id="sources" className="scroll-mt-20 border-t border-line py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="Job sources"
            title="Every source, labelled"
            description="This is the complete list. There is no web crawler, and no source that requires signing in to someone else’s account."
          />

          <div className="mt-10">
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Can do</TableHead>
                    <TableHead>How it works</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {JOB_SOURCE_REGISTRY.map((s) => (
                    <TableRow key={s.adapterKey}>
                      <TableCell className="font-medium whitespace-nowrap text-ink">
                        {s.name}
                        {s.policyStatus === 'requires_configuration' ? (
                          <Badge tone="warning" className="ml-2">
                            Opt-in
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge tone={SOURCE_TYPE_TONES[s.sourceType]}>{SOURCE_TYPE_LABELS[s.sourceType]}</Badge>
                      </TableCell>
                      <TableCell>
                        <ul className="flex flex-wrap gap-1">
                          {s.capabilities.map((c) => (
                            <li key={c}>
                              <Badge tone="outline">{CAPABILITY_LABELS[c] ?? c}</Badge>
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                      <TableCell className="min-w-[18rem] text-[13px] leading-relaxed">{s.policyNote}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="pt-5">
                <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-ink">
                  <CheckCircle2 className="size-4 text-success" aria-hidden />
                  What happens with a LinkedIn or Naukri URL
                </h3>
                <ul className="space-y-2 text-[13px] leading-relaxed text-ink-3">
                  <li>You paste the URL. It is stored as an “external link only” record.</li>
                  <li>You add the title, company and description you want to keep.</li>
                  <li>Matching, tailoring and packet generation all work on it normally.</li>
                  <li>The listing opens in a new tab, in your browser, under their terms.</li>
                  <li>You confirm when you have applied. Nothing is fetched from them at any point.</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5">
                <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-ink">
                  <XCircle className="size-4 text-danger" aria-hidden />
                  What will never happen
                </h3>
                <ul className="space-y-2 text-[13px] leading-relaxed text-ink-3">
                  <li>Crawling a job platform’s listings or search results.</li>
                  <li>Driving a logged-in session with browser automation.</li>
                  <li>Solving or bypassing a CAPTCHA or access control.</li>
                  <li>Reading recruiter profiles, connections or messages.</li>
                  <li>Submitting an application to a site without an authorised API.</li>
                  <li>Sending a LinkedIn message on your behalf.</li>
                </ul>
              </CardContent>
            </Card>
          </div>

          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/signup">Analyse my resume</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/security">Read the security page</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
