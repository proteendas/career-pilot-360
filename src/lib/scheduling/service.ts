/**
 * User-configured recurring schedules, and the background task queue they
 * feed. Server-only.
 *
 * Two Vercel Cron routes drive this: `enqueue-schedules` finds schedules due
 * "today" and enqueues one `background_tasks` row per due schedule (an
 * idempotency key keyed on the schedule and its due date prevents a retried
 * or overlapping cron invocation from enqueuing the same firing twice), and
 * `process-tasks` claims queued rows and runs them — see `tasks.ts` for what
 * each task type actually does.
 *
 * Both cron routes currently run once a day (see vercel.json) because
 * Vercel's Hobby plan caps every cron job at one run per day. That means
 * "weekly" and "weekdays" schedules behave exactly as configured, but there
 * is no finer-grained trigger available below Pro — see the Automation page
 * for the user-facing note.
 */
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { backgroundTasks, getDb, isDatabaseConfigured, schedules, type BackgroundTask, type Schedule } from '@/lib/db';
import { NotFoundError } from '@/lib/db/tenant';
import { recordAudit } from '@/lib/audit';
import { TASK_TYPES, runTask, type TaskType } from './tasks';

export const SCHEDULE_EXPRESSIONS = ['daily', 'weekdays', 'weekly'] as const;
export type ScheduleExpression = (typeof SCHEDULE_EXPRESSIONS)[number];

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleError';
  }
}

/**
 * Next UTC instant this schedule should fire, given `from` as "now".
 *
 * `hourOfDay` is interpreted in UTC. The `schedules.timezone` column exists
 * for a future per-user-timezone version of this but is not applied yet —
 * every schedule effectively runs on UTC hours today. `createSchedule`
 * therefore doesn't expose a timezone choice in its public input; don't wire
 * one up without implementing the conversion here first.
 */
export function computeNextRunAt(
  scheduleExpression: string,
  hourOfDay: number,
  from: Date = new Date(),
): Date {
  const next = new Date(from);
  next.setUTCHours(hourOfDay, 0, 0, 0);
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1);

  if (scheduleExpression === 'weekly') {
    while (next.getUTCDay() !== 1) next.setUTCDate(next.getUTCDate() + 1);
  } else if (scheduleExpression === 'weekdays') {
    while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

export interface CreateScheduleInput {
  taskType: TaskType;
  scheduleExpression: ScheduleExpression;
  /** Interpreted in UTC — see the note on `computeNextRunAt`. */
  hourOfDay: number;
}

export async function createSchedule(userId: string, input: CreateScheduleInput): Promise<string> {
  if (!TASK_TYPES.includes(input.taskType)) throw new ScheduleError('Unknown task type.');
  if (!SCHEDULE_EXPRESSIONS.includes(input.scheduleExpression)) throw new ScheduleError('Unknown schedule frequency.');
  if (input.hourOfDay < 0 || input.hourOfDay > 23) throw new ScheduleError('Hour must be between 0 and 23.');

  const rows = await getDb()
    .insert(schedules)
    .values({
      userId,
      taskType: input.taskType,
      scheduleExpression: input.scheduleExpression,
      hourOfDay: input.hourOfDay,
      nextRunAt: computeNextRunAt(input.scheduleExpression, input.hourOfDay),
    })
    .returning({ id: schedules.id });

  await recordAudit({
    userId,
    action: 'schedule.created',
    entityType: 'schedule',
    entityId: rows[0]!.id,
    metadata: { taskType: input.taskType, scheduleExpression: input.scheduleExpression },
  });

  return rows[0]!.id;
}

export async function listSchedules(userId: string): Promise<Schedule[]> {
  if (!isDatabaseConfigured()) return [];
  return getDb().select().from(schedules).where(eq(schedules.userId, userId)).orderBy(asc(schedules.createdAt));
}

async function getOwnedSchedule(userId: string, scheduleId: string): Promise<Schedule> {
  const rows = await getDb()
    .select()
    .from(schedules)
    .where(and(eq(schedules.userId, userId), eq(schedules.id, scheduleId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('That schedule was not found.');
  return row;
}

export async function setScheduleEnabled(userId: string, scheduleId: string, enabled: boolean): Promise<void> {
  const row = await getOwnedSchedule(userId, scheduleId);
  await getDb()
    .update(schedules)
    .set({
      enabled,
      nextRunAt: enabled ? computeNextRunAt(row.scheduleExpression, row.hourOfDay) : null,
      updatedAt: new Date(),
    })
    .where(and(eq(schedules.userId, userId), eq(schedules.id, scheduleId)));

  await recordAudit({
    userId,
    action: 'schedule.updated',
    entityType: 'schedule',
    entityId: scheduleId,
    metadata: { enabled },
  });
}

export async function deleteSchedule(userId: string, scheduleId: string): Promise<void> {
  await getOwnedSchedule(userId, scheduleId);
  await getDb().delete(schedules).where(and(eq(schedules.userId, userId), eq(schedules.id, scheduleId)));
  await recordAudit({ userId, action: 'schedule.deleted', entityType: 'schedule', entityId: scheduleId });
}

/** Runs a schedule's task immediately, bypassing the queue, for instant feedback in the UI. */
export async function runScheduleNow(userId: string, scheduleId: string) {
  const row = await getOwnedSchedule(userId, scheduleId);
  const result = await runTask(row.taskType, userId);
  await getDb()
    .update(schedules)
    .set({ lastRunAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schedules.userId, userId), eq(schedules.id, scheduleId)));
  await recordAudit({
    userId,
    action: 'schedule.executed',
    entityType: 'schedule',
    entityId: scheduleId,
    metadata: { taskType: row.taskType, manual: true, summary: result.summary },
  });
  return result;
}

/* ------------------------------------------------------------------ queue -- */

/**
 * Finds every schedule due at or before `now`, enqueues one background task
 * per schedule (idempotent per schedule+due-instant), and advances each
 * schedule's `nextRunAt`. Called by the `enqueue-schedules` cron route.
 */
export async function enqueueDueSchedules(now: Date = new Date()): Promise<{ enqueued: number }> {
  const db = getDb();
  const due = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.enabled, true), lte(schedules.nextRunAt, now)));

  let enqueued = 0;
  for (const row of due) {
    const dueAt = row.nextRunAt ?? now;
    const idempotencyKey = `schedule:${row.id}:${dueAt.toISOString()}`;
    const inserted = await db
      .insert(backgroundTasks)
      .values({
        userId: row.userId,
        scheduleId: row.id,
        taskType: row.taskType,
        idempotencyKey,
      })
      .onConflictDoNothing({ target: backgroundTasks.idempotencyKey })
      .returning({ id: backgroundTasks.id });
    if (inserted.length > 0) enqueued += 1;

    await db
      .update(schedules)
      .set({ nextRunAt: computeNextRunAt(row.scheduleExpression, row.hourOfDay, now) })
      .where(eq(schedules.id, row.id));
  }

  return { enqueued };
}

/** Atomically claims up to `limit` queued tasks so two overlapping cron runs never double-process one. */
async function claimQueuedTasks(limit: number, lockedBy: string): Promise<BackgroundTask[]> {
  const db = getDb();
  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE ${backgroundTasks}
    SET status = 'running', locked_at = now(), locked_by = ${lockedBy}, started_at = now(), updated_at = now()
    WHERE id IN (
      SELECT id FROM ${backgroundTasks}
      WHERE status = 'queued' AND run_after <= now()
      ORDER BY run_after ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  const ids = (Array.isArray(claimed) ? claimed : (claimed as { rows?: { id: string }[] }).rows ?? []).map((r) => r.id);
  if (ids.length === 0) return [];

  return db.select().from(backgroundTasks).where(inArray(backgroundTasks.id, ids));
}

/**
 * Claims and runs up to `limit` queued tasks, marking each completed or
 * (on failure, up to `maxAttempts`) re-queued. Called by the `process-tasks`
 * cron route.
 */
export async function processQueuedTasks(
  limit: number,
  lockedBy = 'cron',
): Promise<{ processed: number; failed: number }> {
  const db = getDb();
  const tasks = await claimQueuedTasks(limit, lockedBy);
  let processed = 0;
  let failed = 0;

  for (const task of tasks) {
    try {
      const result = await runTask(task.taskType, task.userId);
      await db
        .update(backgroundTasks)
        .set({ status: 'completed', completedAt: new Date(), result, updatedAt: new Date() })
        .where(eq(backgroundTasks.id, task.id));
      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Task failed.';
      const attempts = task.attempts + 1;
      const willRetry = attempts < task.maxAttempts;
      await db
        .update(backgroundTasks)
        .set({
          status: willRetry ? 'queued' : 'failed',
          attempts,
          errorMessage: message,
          runAfter: willRetry ? new Date(Date.now() + 5 * 60_000) : task.runAfter,
          lockedAt: null,
          lockedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(backgroundTasks.id, task.id));
      failed += 1;
    }
  }

  return { processed, failed };
}

export async function listRecentTasks(userId: string, limit = 20): Promise<BackgroundTask[]> {
  return getDb()
    .select()
    .from(backgroundTasks)
    .where(eq(backgroundTasks.userId, userId))
    .orderBy(sql`${backgroundTasks.createdAt} DESC`)
    .limit(limit);
}
