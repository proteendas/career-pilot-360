'use server';

/** Read-only: paginates the current user's own audit log. */
import { requireUser } from '@/lib/auth';
import { listAuditEvents } from '@/lib/audit';

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface AuditEventRow {
  id: string;
  action: string;
  actorType: string;
  entityType: string | null;
  entityId: string | null;
  afterSummary: string | null;
  metadata: unknown;
  createdAt: string;
}

export async function loadMoreAuditEventsAction(before: string): Promise<ActionResult<{ events: AuditEventRow[] }>> {
  try {
    const user = await requireUser();
    const beforeDate = new Date(before);
    if (Number.isNaN(beforeDate.getTime())) return { ok: false, error: 'Invalid cursor.' };

    const rows = await listAuditEvents(user.id, { before: beforeDate, limit: 50 });
    return {
      ok: true,
      data: {
        events: rows.map((r) => ({
          id: r.id,
          action: r.action,
          actorType: r.actorType,
          entityType: r.entityType,
          entityId: r.entityId,
          afterSummary: r.afterSummary,
          metadata: r.metadata,
          createdAt: r.createdAt.toISOString(),
        })),
      },
    };
  } catch (err) {
    console.error('[audit-action] unexpected failure', err);
    return { ok: false, error: 'Something went wrong.' };
  }
}
