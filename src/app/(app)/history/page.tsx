import type { Metadata } from 'next';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { HistoryTimeline } from '@/components/history/history-timeline';
import { requireUserPage } from '@/lib/auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listHistory } from '@/lib/history';
import { Alert } from '@/components/ui/alert';

export const metadata: Metadata = { title: 'History' };

export default async function HistoryPage() {
  const user = await requireUserPage('/history');

  if (!isDatabaseConfigured()) {
    return (
      <PageShell>
        <PageHeader title="History" />
        <Alert tone="warning" title="Database not configured">
          Set DATABASE_URL and run the migrations.
        </Alert>
      </PageShell>
    );
  }

  const items = await listHistory(user.id);

  return (
    <PageShell>
      <PageHeader
        title="History"
        description="Everything that has happened in your job search, in order — application updates, sent outreach, and new resume versions. For the complete technical record, see the Audit log."
      />
      <Card>
        <CardContent className="pt-4">
          <HistoryTimeline items={items} />
        </CardContent>
      </Card>
    </PageShell>
  );
}
