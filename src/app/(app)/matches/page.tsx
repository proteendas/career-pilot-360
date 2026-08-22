import type { Metadata } from 'next';
import Link from 'next/link';
import { RefreshCw, Target } from 'lucide-react';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { JobCard } from '@/components/jobs/job-card';
import { jobToCardData } from '@/lib/jobs/card-data';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { requireUserPage } from '@/lib/auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listMatches } from '@/lib/jobs/match-service';
import { getDefaultVersion } from '@/lib/resume/service';
import { loadProfile } from '@/lib/profile/service';
import { RescoreButton } from '@/components/jobs/rescore-button';

export const metadata: Metadata = { title: 'Matches' };

export default async function MatchesPage() {
  const user = await requireUserPage('/matches');

  if (!isDatabaseConfigured()) {
    return (
      <PageShell>
        <PageHeader title="Matches" />
        <Alert tone="warning" title="Database not configured">
          Set DATABASE_URL and run the migrations to enable matching.
        </Alert>
      </PageShell>
    );
  }

  const [profile, defaultVersion] = await Promise.all([loadProfile(user.id), getDefaultVersion(user.id)]);
  const minScore = profile.jobPreferences.minMatchScore ?? 0;
  const items = await listMatches(user.id, { minScore });

  return (
    <PageShell>
      <PageHeader
        title="Matches"
        description={`Scored deterministically against your resume and profile. Showing matches at or above ${minScore}/100, your configured minimum.`}
        actions={<RescoreButton />}
      />

      {!defaultVersion ? (
        <Alert tone="warning" className="mb-5">
          Upload a resume before scoring jobs.{' '}
          <Link href="/resume" className="font-medium underline">
            Go to Resume Center
          </Link>
        </Alert>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={<Target className="size-5" />}
          title="No matches yet"
          description={
            defaultVersion
              ? 'Import or discover some jobs, then score them against your resume.'
              : 'Upload a resume first, then import or discover jobs to see how well they fit.'
          }
          action={
            <Button asChild>
              <Link href="/jobs">
                <RefreshCw aria-hidden />
                Go to Jobs
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {items.map(({ job, match }) => (
            <li key={job.id}>
              <JobCard job={jobToCardData(job, match.score)} />
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
