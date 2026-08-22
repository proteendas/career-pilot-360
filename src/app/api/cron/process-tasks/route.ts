import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { isDatabaseConfigured } from '@/lib/db';
import { processQueuedTasks } from '@/lib/scheduling/service';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** How many queued tasks one invocation claims. Keeps each run well inside maxDuration. */
const BATCH_SIZE = 20;

/**
 * Claims and runs up to `BATCH_SIZE` queued background tasks — see
 * `processQueuedTasks`. Triggered by Vercel Cron; see vercel.json for the
 * schedule and why it currently runs once a day rather than every few
 * minutes (Vercel Hobby plan limit).
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
    const result = await processQueuedTasks(BATCH_SIZE, `cron:${Date.now()}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/process-tasks] failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'Failed to process tasks.' }, { status: 500 });
  }
}
