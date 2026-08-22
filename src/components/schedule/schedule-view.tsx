'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Play, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert } from '@/components/ui/alert';
import { SwitchField } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { SimpleSelect } from '@/components/ui/select';
import {
  createScheduleAction,
  deleteScheduleAction,
  runScheduleNowAction,
  setScheduleEnabledAction,
} from '@/server/actions/schedule';
import {
  SCHEDULE_EXPRESSIONS,
  TASK_TYPE_DESCRIPTIONS,
  TASK_TYPE_LABELS,
  TASK_TYPES,
  type ScheduleExpression,
  type TaskType,
} from '@/lib/scheduling/types';
import { relativeTime } from '@/lib/utils';

export interface ScheduleRow {
  id: string;
  taskType: string;
  scheduleExpression: string;
  hourOfDay: number;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

const FREQUENCY_LABELS: Record<ScheduleExpression, string> = {
  daily: 'Every day',
  weekdays: 'Weekdays only',
  weekly: 'Once a week (Monday)',
};

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, '0')}:00 UTC`,
}));

export function ScheduleView({ schedules }: { schedules: ScheduleRow[] }) {
  const [createOpen, setCreateOpen] = React.useState(false);

  return (
    <div className="space-y-4">
      <Alert tone="neutral" icon={<CalendarClock className="size-4" />}>
        <p className="text-[13px] leading-relaxed">
          Every scheduled task only reads your data and, if it finds something worth surfacing, writes a
          notification — nothing here sends an email, opens a portal, or submits anything on its own. Background
          processing currently runs once a day (a Vercel Hobby plan limit), so use{' '}
          <span className="font-medium">Run now</span> on a schedule below for an immediate check.
        </p>
      </Alert>

      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus aria-hidden />
          New schedule
        </Button>
      </div>

      {schedules.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-5" />}
          title="No schedules yet"
          description="Set up a recurring check — refreshed match scores, or a nudge about applications that have gone quiet."
          action={<Button onClick={() => setCreateOpen(true)}>New schedule</Button>}
        />
      ) : (
        <ul className="space-y-3">
          {schedules.map((s) => (
            <li key={s.id}>
              <ScheduleCard schedule={s} />
            </li>
          ))}
        </ul>
      )}

      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function ScheduleCard({ schedule }: { schedule: ScheduleRow }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const label = TASK_TYPE_LABELS[schedule.taskType as TaskType] ?? schedule.taskType;
  const description = TASK_TYPE_DESCRIPTIONS[schedule.taskType as TaskType];

  async function toggle(enabled: boolean) {
    setBusy(true);
    const res = await setScheduleEnabledAction(schedule.id, enabled);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not update.');
      return;
    }
    router.refresh();
  }

  async function runNow() {
    setRunning(true);
    const res = await runScheduleNowAction(schedule.id);
    setRunning(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not run this now.');
      return;
    }
    toast.success(res.notice ?? 'Done.');
    router.refresh();
  }

  async function confirmDelete() {
    setDeleting(true);
    const res = await deleteScheduleAction(schedule.id);
    setDeleting(false);
    setDeleteOpen(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not remove this schedule.');
      return;
    }
    toast.success('Removed.');
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[15px] font-semibold text-ink">{label}</p>
            <p className="text-sm text-ink-3">{description}</p>
            <p className="mt-1 text-xs text-ink-4">
              {FREQUENCY_LABELS[schedule.scheduleExpression as ScheduleExpression] ?? schedule.scheduleExpression} at{' '}
              {String(schedule.hourOfDay).padStart(2, '0')}:00 UTC
              {schedule.lastRunAt ? ` · last ran ${relativeTime(schedule.lastRunAt)}` : ''}
            </p>
          </div>
          <SwitchField id={`sched-${schedule.id}`} label="Enabled" checked={schedule.enabled} onCheckedChange={toggle} disabled={busy} />
        </div>

        <div className="flex items-center gap-2 border-t border-line pt-3">
          <Button size="sm" variant="secondary" onClick={() => void runNow()} loading={running}>
            <Play aria-hidden />
            Run now
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDeleteOpen(true)}>
            <Trash2 aria-hidden />
            Remove
          </Button>
        </div>
      </CardContent>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove this schedule?"
        confirmLabel="Remove"
        tone="danger"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </Card>
  );
}

function CreateScheduleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>New schedule</DialogTitle>
          <DialogDescription>Pick what to check and how often. You can change or remove this later.</DialogDescription>
        </DialogHeader>
        {open ? <CreateScheduleForm onOpenChange={onOpenChange} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateScheduleForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [taskType, setTaskType] = React.useState<TaskType>(TASK_TYPES[0]);
  const [scheduleExpression, setScheduleExpression] = React.useState<ScheduleExpression>('daily');
  const [hourOfDay, setHourOfDay] = React.useState('9');
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    const res = await createScheduleAction({
      taskType,
      scheduleExpression,
      hourOfDay: Number(hourOfDay),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not create this schedule.');
      return;
    }
    toast.success(res.notice ?? 'Created.');
    onOpenChange(false);
    router.refresh();
  }

  return (
    <>
      <div className="space-y-3.5">
        <Field label="What to check" htmlFor="task-type">
          <SimpleSelect
            id="task-type"
            value={taskType}
            onValueChange={(v) => setTaskType(v as TaskType)}
            options={TASK_TYPES.map((t) => ({ value: t, label: TASK_TYPE_LABELS[t] }))}
          />
          <p className="mt-1.5 text-xs leading-relaxed text-ink-4">{TASK_TYPE_DESCRIPTIONS[taskType]}</p>
        </Field>

        <Field label="How often" htmlFor="frequency">
          <SimpleSelect
            id="frequency"
            value={scheduleExpression}
            onValueChange={(v) => setScheduleExpression(v as ScheduleExpression)}
            options={SCHEDULE_EXPRESSIONS.map((e) => ({ value: e, label: FREQUENCY_LABELS[e] }))}
          />
        </Field>

        <Field label="Around what time" htmlFor="hour" help="In UTC — per-timezone scheduling isn't available yet.">
          <SimpleSelect id="hour" value={hourOfDay} onValueChange={setHourOfDay} options={HOUR_OPTIONS} />
        </Field>
      </div>

      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={saving}>
          Create schedule
        </Button>
      </DialogFooter>
    </>
  );
}
