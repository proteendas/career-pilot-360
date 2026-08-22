import type { Metadata } from 'next';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { ScheduleView } from '@/components/schedule/schedule-view';
import { requireUserPage } from '@/lib/auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listSchedules } from '@/lib/scheduling/service';
import { Alert } from '@/components/ui/alert';

export const metadata: Metadata = { title: 'Schedule' };

export default async function SchedulePage() {
  const user = await requireUserPage('/schedule');

  if (!isDatabaseConfigured()) {
    return (
      <PageShell>
        <PageHeader title="Schedule" />
        <Alert tone="warning" title="Database not configured">
          Set DATABASE_URL and run the migrations.
        </Alert>
      </PageShell>
    );
  }

  const schedules = await listSchedules(user.id);

  return (
    <PageShell>
      <PageHeader title="Schedule" description="Recurring background checks — refreshed matches, application reminders." />
      <ScheduleView
        schedules={schedules.map((s) => ({
          id: s.id,
          taskType: s.taskType,
          scheduleExpression: s.scheduleExpression,
          hourOfDay: s.hourOfDay,
          enabled: s.enabled,
          lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
          nextRunAt: s.nextRunAt ? s.nextRunAt.toISOString() : null,
        }))}
      />
    </PageShell>
  );
}
