'use server';

/**
 * Schedule server actions. Every schedule only ever reads data and writes a
 * notification — see `src/lib/scheduling/tasks.ts` for the fixed set of task
 * types and exactly what each one does.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { NotFoundError } from '@/lib/db/tenant';
import {
  createSchedule,
  deleteSchedule,
  runScheduleNow,
  ScheduleError,
  setScheduleEnabled,
  SCHEDULE_EXPRESSIONS,
} from '@/lib/scheduling/service';
import { TASK_TYPES, type TaskType } from '@/lib/scheduling/tasks';

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  notice?: string;
  data?: T;
}

function toResult(err: unknown): ActionResult<never> {
  if (err instanceof ScheduleError) return { ok: false, error: err.message };
  if (err instanceof NotFoundError) return { ok: false, error: err.message };
  console.error('[schedule-action] unexpected failure', err);
  return { ok: false, error: 'Something went wrong. Please try again.' };
}

const createSchema = z.object({
  taskType: z.enum([...TASK_TYPES] as [TaskType, ...TaskType[]]),
  scheduleExpression: z.enum(SCHEDULE_EXPRESSIONS),
  hourOfDay: z.number().int().min(0).max(23),
});

export async function createScheduleAction(raw: unknown): Promise<ActionResult<{ scheduleId: string }>> {
  try {
    const user = await requireUser();
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };

    const scheduleId = await createSchedule(user.id, parsed.data as Parameters<typeof createSchedule>[1]);
    revalidatePath('/schedule');
    return { ok: true, notice: 'Schedule created.', data: { scheduleId } };
  } catch (err) {
    return toResult(err);
  }
}

export async function setScheduleEnabledAction(scheduleId: string, enabled: boolean): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await setScheduleEnabled(user.id, scheduleId, enabled);
    revalidatePath('/schedule');
    return { ok: true, notice: enabled ? 'Enabled.' : 'Disabled.' };
  } catch (err) {
    return toResult(err);
  }
}

export async function deleteScheduleAction(scheduleId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await deleteSchedule(user.id, scheduleId);
    revalidatePath('/schedule');
    return { ok: true, notice: 'Removed.' };
  } catch (err) {
    return toResult(err);
  }
}

export async function runScheduleNowAction(scheduleId: string): Promise<ActionResult<{ summary: string }>> {
  try {
    const user = await requireUser();
    const result = await runScheduleNow(user.id, scheduleId);
    revalidatePath('/schedule');
    revalidatePath('/dashboard');
    return {
      ok: true,
      notice: result.notified ? 'Done — check your notifications.' : `Done. ${result.summary}`,
      data: { summary: result.summary },
    };
  } catch (err) {
    return toResult(err);
  }
}
