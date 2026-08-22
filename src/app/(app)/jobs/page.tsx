import type { Metadata } from 'next';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { DiscoveryView } from '@/components/jobs/discovery-view';
import { jobToCardData } from '@/lib/jobs/card-data';
import { requireUserPage } from '@/lib/auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listJobs } from '@/lib/jobs/service';
import { getMatches } from '@/lib/jobs/match-service';
import { loadProfile } from '@/lib/profile/service';
import { Alert } from '@/components/ui/alert';

export const metadata: Metadata = { title: 'Jobs' };

export default async function JobsPage() {
  const user = await requireUserPage('/jobs');

  if (!isDatabaseConfigured()) {
    return (
      <PageShell>
        <PageHeader title="Jobs" />
        <Alert tone="warning" title="Database not configured">
          Set DATABASE_URL and run the migrations to enable job discovery.
        </Alert>
      </PageShell>
    );
  }

  const [profile, jobs] = await Promise.all([loadProfile(user.id), listJobs(user.id, { limit: 60 })]);
  const matches = await getMatches(user.id, jobs.map((j) => j.id));

  const cards = jobs.map((j) => jobToCardData(j, matches.get(j.id)?.score ?? null));

  return (
    <PageShell>
      <PageHeader
        title="Jobs"
        description="Discovered from sources that permit it, or imported by you. Every listing shows exactly where it came from."
      />
      <DiscoveryView
        initialJobs={cards}
        defaultCompanies={profile.jobPreferences.preferredCompanies ?? []}
        defaultTitles={[
          ...(profile.professional.targetTitles ?? []),
          ...(profile.jobPreferences.preferredRoles ?? []),
        ].slice(0, 5)}
        defaultLocations={profile.jobPreferences.preferredLocations ?? []}
      />
    </PageShell>
  );
}
