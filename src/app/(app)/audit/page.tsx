import type { Metadata } from 'next';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { AuditLogView } from '@/components/audit/audit-log-view';
import { requireUserPage } from '@/lib/auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listAuditEvents } from '@/lib/audit';
import { Alert } from '@/components/ui/alert';

export const metadata: Metadata = { title: 'Audit log' };

export default async function AuditPage() {
  const user = await requireUserPage('/audit');

  if (!isDatabaseConfigured()) {
    return (
      <PageShell>
        <PageHeader title="Audit log" />
        <Alert tone="warning" title="Database not configured">
          Set DATABASE_URL and run the migrations.
        </Alert>
      </PageShell>
    );
  }

  const events = await listAuditEvents(user.id, { limit: 50 });

  return (
    <PageShell>
      <PageHeader
        title="Audit log"
        description="An append-only record of every meaningful action on your account. Nothing here can be edited or deleted."
      />
      <AuditLogView
        initialEvents={events.map((e) => ({
          id: e.id,
          action: e.action,
          actorType: e.actorType,
          entityType: e.entityType,
          entityId: e.entityId,
          afterSummary: e.afterSummary,
          metadata: e.metadata,
          createdAt: e.createdAt.toISOString(),
        }))}
      />
    </PageShell>
  );
}
