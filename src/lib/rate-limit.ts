/**
 * Durable fixed-window rate limiting.
 *
 * Backed by the `rate_limits` table so limits survive serverless cold starts
 * and apply across instances. Falls back to an in-process map when no database
 * is configured (local dev without Postgres) so the guard is never simply off.
 */
import { sql } from 'drizzle-orm';
import { getDb, isDatabaseConfigured, rateLimits } from '@/lib/db';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterSeconds: number;
}

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

/** Named limits used across the app. Tighten here, not at call sites. */
export const RATE_LIMITS = {
  login: { limit: 10, windowSeconds: 300 },
  signup: { limit: 5, windowSeconds: 3600 },
  passwordReset: { limit: 5, windowSeconds: 3600 },
  resumeUpload: { limit: 20, windowSeconds: 3600 },
  aiTask: { limit: 60, windowSeconds: 3600 },
  assistantMessage: { limit: 120, windowSeconds: 3600 },
  jobImport: { limit: 60, windowSeconds: 3600 },
  jobSearch: { limit: 60, windowSeconds: 3600 },
  pdfExport: { limit: 40, windowSeconds: 3600 },
  emailSend: { limit: 20, windowSeconds: 86_400 },
  urlFetch: { limit: 30, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

const memory = new Map<string, { count: number; windowStart: number }>();

/**
 * Consume one unit from `name:identifier`.
 * Never throws; on infrastructure failure it fails OPEN but logs, because a
 * broken counter must not lock users out of their own account.
 */
export async function checkRateLimit(
  name: RateLimitName,
  identifier: string,
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[name];
  const key = `${name}:${identifier}`;

  if (!isDatabaseConfigured()) return memoryCheck(key, rule);

  try {
    const db = getDb();
    const windowMs = rule.windowSeconds * 1000;
    const rows = await db.execute<{ count: number; window_start: string }>(sql`
      INSERT INTO ${rateLimits} (key, count, window_start)
      VALUES (${key}, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN ${rateLimits.windowStart} < now() - (${rule.windowSeconds} || ' seconds')::interval THEN 1
          ELSE ${rateLimits.count} + 1
        END,
        window_start = CASE
          WHEN ${rateLimits.windowStart} < now() - (${rule.windowSeconds} || ' seconds')::interval THEN now()
          ELSE ${rateLimits.windowStart}
        END
      RETURNING count, window_start
    `);
    // `db.execute()` returns the rows array directly on the postgres.js driver,
    // but `{ rows: [...] }` on the PGlite driver (used in tests/local dev) —
    // handle both shapes, or PGlite silently falls through to the `?? 1`
    // default below on every call and the cap never trips.
    const rowsArray = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] })?.rows ?? [];
    const row = rowsArray[0] as { count: number; window_start: string } | undefined;
    const count = Number(row?.count ?? 1);
    const startedAt = row?.window_start ? new Date(row.window_start).getTime() : Date.now();
    const elapsed = Date.now() - startedAt;
    return {
      allowed: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      limit: rule.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)),
    };
  } catch (err) {
    console.error('[rate-limit] backend failure, failing open', err instanceof Error ? err.message : err);
    return { allowed: true, remaining: rule.limit, limit: rule.limit, retryAfterSeconds: 0 };
  }
}

function memoryCheck(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;
  const entry = memory.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    memory.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: rule.limit - 1, limit: rule.limit, retryAfterSeconds: rule.windowSeconds };
  }
  entry.count += 1;
  return {
    allowed: entry.count <= rule.limit,
    remaining: Math.max(0, rule.limit - entry.count),
    limit: rule.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.windowStart + windowMs - now) / 1000)),
  };
}

/**
 * Test-only. Clears the in-memory fallback map AND, when a database is
 * configured, deletes the durable `rate_limits` rows — the in-memory map
 * alone is not enough once a test DB is wired in, since `checkRateLimit`
 * prefers the durable counter whenever `isDatabaseConfigured()` is true.
 */
export async function __clearRateLimitMemory(): Promise<void> {
  memory.clear();
  if (isDatabaseConfigured()) {
    try {
      await getDb().delete(rateLimits);
    } catch (err) {
      console.error('[rate-limit] __clearRateLimitMemory: failed to clear durable counters', err);
    }
  }
}

export class RateLimitError extends Error {
  readonly status = 429;
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super('Too many requests. Please slow down and try again shortly.');
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Throwing variant for route handlers and server actions. */
export async function enforceRateLimit(name: RateLimitName, identifier: string): Promise<void> {
  const res = await checkRateLimit(name, identifier);
  if (!res.allowed) throw new RateLimitError(res.retryAfterSeconds);
}
