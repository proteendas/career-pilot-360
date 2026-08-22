/**
 * The user-facing timeline: a merged, narrative feed of what actually
 * happened across applications, outreach and resume versions.
 *
 * Deliberately distinct from `src/lib/audit.ts`: the audit log is a complete
 * compliance record of every action, including logins and settings changes.
 * This is the subset a user would actually want to scroll through to
 * remember "what happened in my job search," so logins and key management
 * are left out on purpose.
 */
import { and, desc, eq } from 'drizzle-orm';
import {
  applicationEvents,
  applications,
  getDb,
  isDatabaseConfigured,
  jobs,
  outreachSends,
  resumeVersions,
} from '@/lib/db';
import { EVENT_TYPE_LABELS } from '@/lib/applications/state';

export interface HistoryItem {
  id: string;
  type: 'application' | 'outreach' | 'resume';
  title: string;
  detail: string | null;
  href: string;
  createdAt: Date;
}

/**
 * Fetches a generous batch from each source and merges them by time. Not
 * cursor-paginated like the audit log — a job search's own narrative history
 * is small enough per user that one bounded fetch covers it; revisit if that
 * stops being true.
 */
export async function listHistory(userId: string, limit = 60): Promise<HistoryItem[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb();

  const [events, sends, versions] = await Promise.all([
    db
      .select({
        id: applicationEvents.id,
        applicationId: applicationEvents.applicationId,
        eventType: applicationEvents.eventType,
        createdAt: applicationEvents.createdAt,
        jobTitle: jobs.title,
        company: jobs.company,
      })
      .from(applicationEvents)
      .innerJoin(applications, eq(applications.id, applicationEvents.applicationId))
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(eq(applicationEvents.userId, userId))
      .orderBy(desc(applicationEvents.createdAt))
      .limit(limit),
    db
      .select({ id: outreachSends.id, recipient: outreachSends.recipient, sentAt: outreachSends.sentAt })
      .from(outreachSends)
      .where(and(eq(outreachSends.userId, userId), eq(outreachSends.status, 'sent')))
      .orderBy(desc(outreachSends.sentAt))
      .limit(limit),
    db
      .select({
        id: resumeVersions.id,
        name: resumeVersions.name,
        isTailored: resumeVersions.isTailored,
        createdAt: resumeVersions.createdAt,
      })
      .from(resumeVersions)
      .where(eq(resumeVersions.userId, userId))
      .orderBy(desc(resumeVersions.createdAt))
      .limit(limit),
  ]);

  const items: HistoryItem[] = [
    ...events.map((e) => ({
      id: e.id,
      type: 'application' as const,
      title: EVENT_TYPE_LABELS[e.eventType] ?? e.eventType,
      detail: `${e.jobTitle} at ${e.company}`,
      href: `/applications/${e.applicationId}`,
      createdAt: e.createdAt,
    })),
    ...sends
      .filter((s): s is typeof s & { sentAt: Date } => s.sentAt !== null)
      .map((s) => ({
        id: s.id,
        type: 'outreach' as const,
        title: 'Outreach email sent',
        detail: s.recipient,
        href: '/outreach',
        createdAt: s.sentAt,
      })),
    ...versions.map((v) => ({
      id: v.id,
      type: 'resume' as const,
      title: v.isTailored ? 'Tailored resume version created' : 'Resume version saved',
      detail: v.name,
      href: `/resume/${v.id}`,
      createdAt: v.createdAt,
    })),
  ];

  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return items.slice(0, limit);
}
