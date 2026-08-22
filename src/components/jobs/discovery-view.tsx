'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Info, Plus, Search, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { JobCard, type JobCardData } from './job-card';
import { ImportJobDialog } from './import-dialog';
import { discoverJobsAction, type DiscoveryPayload } from '@/server/actions/jobs';
import { TagInput } from '@/components/profile/tag-input';

export function DiscoveryView({
  initialJobs,
  defaultCompanies,
  defaultTitles,
  defaultLocations,
}: {
  initialJobs: JobCardData[];
  defaultCompanies: string[];
  defaultTitles: string[];
  defaultLocations: string[];
}) {
  const router = useRouter();
  const jobs = initialJobs;
  const [companies, setCompanies] = React.useState(defaultCompanies);
  const [titles, setTitles] = React.useState(defaultTitles);
  const [locations, setLocations] = React.useState(defaultLocations);
  const [searching, setSearching] = React.useState(false);
  const [coverage, setCoverage] = React.useState<DiscoveryPayload | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);

  async function search() {
    setSearching(true);
    const res = await discoverJobsAction({ titles, companies, locations });
    setSearching(false);

    if (!res.ok || !res.data) {
      toast.error(res.error ?? 'The search failed.');
      return;
    }
    setCoverage(res.data);
    toast.success(res.notice ?? 'Search complete.');
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Target titles" htmlFor="d-titles">
              <TagInput id="d-titles" value={titles} onChange={setTitles} max={10} />
            </Field>
            <Field
              label="Companies"
              htmlFor="d-companies"
              help="Public boards (Greenhouse, Lever, Ashby) are searched per company."
            >
              <TagInput id="d-companies" value={companies} onChange={setCompanies} max={10} />
            </Field>
            <Field label="Locations" htmlFor="d-locations">
              <TagInput id="d-locations" value={locations} onChange={setLocations} max={10} />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void search()} loading={searching}>
              <Search aria-hidden />
              Search compliant sources
            </Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <Plus aria-hidden />
              Import a job
            </Button>
          </div>

          {coverage ? (
            <Alert tone="info" icon={<Info className="size-4" />}>
              <p className="text-[13px] leading-relaxed">{coverage.coverageNote}</p>
              {coverage.sourcesFailed.length > 0 ? (
                <p className="mt-1.5 text-[13px] text-danger">
                  {coverage.sourcesFailed.map((f) => `${f.name}: ${f.error}`).join(' · ')}
                </p>
              ) : null}
            </Alert>
          ) : (
            <Alert tone="neutral" icon={<ShieldCheck className="size-4" />}>
              <p className="text-[13px] leading-relaxed">
                Searches only the sources listed on{' '}
                <a href="/features#sources" className="font-medium text-accent hover:underline">
                  the features page
                </a>
                : public Greenhouse, Lever and Ashby boards for the companies you name, plus Adzuna if you have
                configured it. This is not a search of every job on the internet. You can always paste a job URL
                directly.
              </p>
            </Alert>
          )}
        </CardContent>
      </Card>

      {jobs.length === 0 ? (
        <EmptyState
          icon={<Search className="size-5" />}
          title="No jobs yet"
          description="Search compliant sources by company, or import a job you found elsewhere by pasting its URL."
          action={
            <Button onClick={() => void search()} loading={searching}>
              Search now
            </Button>
          }
          secondaryAction={
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              Import a job
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-ink-4">
            {jobs.length} job{jobs.length === 1 ? '' : 's'} <Badge tone="outline">visible to you</Badge>
          </p>
          <ul className="space-y-3">
            {jobs.map((job) => (
              <li key={job.id}>
                <JobCard job={job} onChanged={() => router.refresh()} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <ImportJobDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
