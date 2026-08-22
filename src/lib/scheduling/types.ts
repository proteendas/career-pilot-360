/**
 * Client-safe scheduling constants. Deliberately has zero server-only
 * imports (no `@/lib/db`, no drizzle) so client components can import from
 * here instead of `tasks.ts` / `service.ts` — importing anything from those
 * files into a client component drags the `postgres` driver into the
 * browser bundle.
 */
export const TASK_TYPES = ['refresh_matches', 'stale_application_reminder'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  refresh_matches: 'Refresh job matches',
  stale_application_reminder: 'Remind me about stale applications',
};

export const TASK_TYPE_DESCRIPTIONS: Record<TaskType, string> = {
  refresh_matches: 'Re-scores your saved jobs against your current default resume and notifies you if anything changed.',
  stale_application_reminder:
    'Checks for applications sitting in "opened externally" or "in progress" for more than 5 days and reminds you to follow up.',
};

export const SCHEDULE_EXPRESSIONS = ['daily', 'weekdays', 'weekly'] as const;
export type ScheduleExpression = (typeof SCHEDULE_EXPRESSIONS)[number];
