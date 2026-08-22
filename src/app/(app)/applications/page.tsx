import type { Metadata } from 'next';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { ApplicationsList, type ApplicationRow } from '@/components/applications/applications-list';
import { requireUserPage } from '@/lib/auth';
import { isDatabaseConfigured, getDb, jobs } from '@/lib/db';
import { listApplications } from '@/lib/applications/service';
import { inArray } from 'drizzle-orm';
import { Alert } from '@/components/ui/alert';
import type { ApplicationStatus } from '@/lib/applications/state';

export const metadata: Metadata = { title: 'Applications' };

export default async function ApplicationsPage() {
  const user = await requireUserPage('/applications');

  if (!isDatabaseConfigured()) {
    return (
      <PageShell>
        <PageHeader title="Applications" />
        <Alert tone="warning" title="Database not configured">
          Set DATABASE_URL and run the migrations.
        </Alert>
      </PageShell>
    );
  }

  const apps = await listApplications(user.id);
  const jobIds = [...new Set(apps.map((a) => a.jobId))];
  const jobRows = jobIds.length
    ? await getDb().select({ id: jobs.id, title: jobs.title, company: jobs.company }).from(jobs).where(inArray(jobs.id, jobIds))
    : [];
  const jobMap = new Map(jobRows.map((j) => [j.id, j]));

  const rows: ApplicationRow[] = apps.map((a) => ({
    id: a.id,
    jobId: a.jobId,
    jobTitle: jobMap.get(a.jobId)?.title ?? 'Unknown role',
    company: jobMap.get(a.jobId)?.company ?? 'Unknown company',
    status: a.status as ApplicationStatus,
    updatedAt: a.updatedAt.toISOString(),
    submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
  }));

  return (
    <PageShell>
      <PageHeader
        title="Applications"
        description="Every status change is recorded as an event. Nothing here claims a submission you have not confirmed."
      />
      <ApplicationsList applications={rows} />
    </PageShell>
  );
}
