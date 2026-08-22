import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { isDatabaseConfigured } from '@/lib/db';
import { enqueueDueSchedules } from '@/lib/scheduling/service';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Finds every user schedule due "today" and enqueues one background task per
 * schedule (see `enqueueDueSchedules`). Triggered by Vercel Cron — see
 * vercel.json for the schedule, and its comment for why this currently runs
 * once a day rather than more often.
 */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET is not configured.' }, { status: 503 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'The database is not configured.' }, { status: 503 });
  }

  try {
    const result = await enqueueDueSchedules();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/enqueue-schedules] failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'Failed to enqueue schedules.' }, { status: 500 });
  }
}
