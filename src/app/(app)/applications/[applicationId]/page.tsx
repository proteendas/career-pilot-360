import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ApplicationStatusBadge } from '@/components/applications/status-badge';
import { ApplicationTimeline, SafetyReminder } from '@/components/applications/timeline';
import { requireUserPage } from '@/lib/auth';
import { NotFoundError } from '@/lib/db/tenant';
import { getApplication, listEvents } from '@/lib/applications/service';
import { getJob } from '@/lib/jobs/service';
import type { ApplicationStatus } from '@/lib/applications/state';

export const metadata: Metadata = { title: 'Application' };

async function load(userId: string, applicationId: string) {
  try {
    const app = await getApplication(userId, applicationId);
    const [job, events] = await Promise.all([getJob(userId, app.jobId), listEvents(userId, applicationId)]);
    return { app, job, events };
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = await params;
  const user = await requireUserPage(`/applications/${applicationId}`);

  const loaded = await load(user.id, applicationId);
  if (!loaded) notFound();
  const { app, job, events } = loaded;

  return (
    <PageShell>
      <PageHeader
        title={job.title}
        description={job.company}
        meta={<ApplicationStatusBadge status={app.status as ApplicationStatus} />}
        actions={
          <Button asChild>
            <Link href={`/applications/${applicationId}/review`}>Open review</Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <ApplicationTimeline
              events={events.map((e) => ({
                id: e.id,
                eventType: e.eventType,
                fromStatus: e.fromStatus,
                toStatus: e.toStatus,
                actorType: e.actorType,
                createdAt: e.createdAt.toISOString(),
              }))}
            />
            <div className="mt-4">
              <SafetyReminder />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-[13px] text-ink-3">
            {app.externalUrl ? (
              <p>
                <span className="font-medium text-ink-2">External URL:</span>{' '}
                <a href={app.externalUrl} target="_blank" rel="noreferrer noopener" className="break-all text-accent hover:underline">
                  {app.externalUrl}
                </a>
              </p>
            ) : null}
            {app.submittedAt ? (
              <p>
                <span className="font-medium text-ink-2">Submitted:</span> {app.submittedAt.toISOString()}
              </p>
            ) : null}
            {app.userNotes ? (
              <p>
                <span className="font-medium text-ink-2">Notes:</span> {app.userNotes}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
