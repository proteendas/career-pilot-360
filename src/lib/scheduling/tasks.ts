/**
 * The fixed set of background task types a schedule can run, and what each
 * one actually does. Server-only.
 *
 * Every task here is read-then-notify: it recomputes something already
 * computed elsewhere (match scores) or looks for something worth surfacing
 * (a stale application) and writes a notification. None of them send an
 * email, submit an application, or otherwise perform an outward-facing side
 * effect — those all stay behind their own explicit-confirmation flow.
 */
import { and, eq, inArray, lt } from 'drizzle-orm';
import { applications, getDb, jobs, notifications } from '@/lib/db';
import { scoreJobsForUser } from '@/lib/jobs/match-service';

export { TASK_TYPES, TASK_TYPE_LABELS, TASK_TYPE_DESCRIPTIONS, type TaskType } from './types';
import { TASK_TYPES, type TaskType } from './types';

export interface TaskResult {
  summary: string;
  notified: boolean;
}

const STALE_AFTER_MS = 5 * 24 * 60 * 60 * 1000;

async function notify(userId: string, kind: string, title: string, body: string, href: string | null): Promise<void> {
  await getDb().insert(notifications).values({ userId, kind, title, body, href });
}

async function refreshMatchesTask(userId: string): Promise<TaskResult> {
  const { scored, skipped } = await scoreJobsForUser(userId, { limit: 50 });
  if (scored === 0) {
    return { summary: 'No resume or no saved jobs to score.', notified: false };
  }
  await notify(
    userId,
    'matches_refreshed',
    'Your job matches were refreshed',
    `Re-scored ${scored} job${scored === 1 ? '' : 's'} against your current resume${skipped > 0 ? ` (${skipped} skipped)` : ''}.`,
    '/matches',
  );
  return { summary: `Scored ${scored}, skipped ${skipped}.`, notified: true };
}

async function staleApplicationReminderTask(userId: string): Promise<TaskResult> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const rows = await getDb()
    .select({ id: applications.id, jobTitle: jobs.title, company: jobs.company })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(
      and(
        eq(applications.userId, userId),
        inArray(applications.status, ['opened_externally', 'in_progress']),
        lt(applications.updatedAt, cutoff),
      ),
    );

  if (rows.length === 0) {
    return { summary: 'Nothing stale.', notified: false };
  }

  const preview = rows
    .slice(0, 3)
    .map((r) => `${r.jobTitle} at ${r.company}`)
    .join(', ');
  await notify(
    userId,
    'stale_application',
    `${rows.length} application${rows.length === 1 ? '' : 's'} may need a follow-up`,
    `${preview}${rows.length > 3 ? `, and ${rows.length - 3} more` : ''} — opened more than 5 days ago with no update.`,
    '/applications',
  );
  return { summary: `${rows.length} stale application(s) found.`, notified: true };
}

const RUNNERS: Record<TaskType, (userId: string) => Promise<TaskResult>> = {
  refresh_matches: refreshMatchesTask,
  stale_application_reminder: staleApplicationReminderTask,
};

export function isTaskType(value: string): value is TaskType {
  return (TASK_TYPES as readonly string[]).includes(value);
}

export async function runTask(taskType: string, userId: string): Promise<TaskResult> {
  if (!isTaskType(taskType)) throw new Error(`Unknown task type: ${taskType}`);
  return RUNNERS[taskType](userId);
}
