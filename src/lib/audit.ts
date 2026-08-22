/**
 * Append-only audit log. The ONLY writer to `audit_events`.
 *
 * Redaction contract (enforced by `redactMetadata`, tested in tests/audit.test.ts):
 *  - Never records an API key, password, token or encryption envelope.
 *  - Never records full resume or job-description text - only lengths/hashes.
 *  - Long strings are truncated; suspicious keys are replaced with '[redacted]'.
 */
import { and, desc, eq, lt } from 'drizzle-orm';
import { auditEvents, getDb, isDatabaseConfigured, type AuditEvent } from '@/lib/db';
import { hashIp } from '@/lib/crypto';

export const AUDIT_ACTIONS = [
  'auth.signup',
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.oauth_connected',
  'auth.email_verified',
  'auth.password_reset_requested',
  'auth.password_reset_completed',
  'profile.updated',
  'consent.accepted',
  'consent.revoked',
  'resume.uploaded',
  'resume.parsed',
  'resume.parse_failed',
  'resume.analysis_created',
  'resume.suggestion_accepted',
  'resume.suggestion_rejected',
  'resume.suggestion_edited',
  'resume.version_created',
  'resume.version_restored',
  'resume.version_deleted',
  'resume.default_changed',
  'resume.pdf_generated',
  'job.imported',
  'job.searched',
  'job.matched',
  'packet.generated',
  'application.created',
  'application.approved',
  'application.external_portal_opened',
  'application.marked_submitted',
  'application.status_changed',
  'application.withdrawn',
  'outreach.contact_created',
  'outreach.draft_created',
  'outreach.email_confirmed',
  'outreach.email_sent',
  'outreach.email_failed',
  'outreach.suppressed',
  'schedule.created',
  'schedule.updated',
  'schedule.deleted',
  'schedule.executed',
  'task.enqueued',
  'task.completed',
  'task.failed',
  'ai.provider_key_added',
  'ai.provider_key_removed',
  'ai.provider_key_validated',
  'ai.assistant_tool_confirmed',
  'account.data_exported',
  'account.deleted',
  'account.retention_changed',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type ActorType = 'user' | 'system' | 'assistant' | 'connector';

export interface AuditInput {
  userId: string | null;
  action: AuditAction;
  actorType?: ActorType;
  entityType?: string | null;
  entityId?: string | null;
  beforeSummary?: string | null;
  afterSummary?: string | null;
  metadata?: Record<string, unknown>;
  requestId?: string | null;
  ip?: string | null;
}

const SENSITIVE_KEY = /(api[_-]?key|secret|password|passwd|token|authorization|cookie|encrypted|credential|bearer)/i;
const BULK_TEXT_KEY = /(resumeText|extractedText|plainText|description|coverLetter|body|content|jobDescription)/i;
const MAX_STRING = 300;

/**
 * Strip secrets and bulk document text from an audit payload.
 * Exported for direct unit testing.
 */
export function redactMetadata(input: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return input.length > MAX_STRING ? `${input.slice(0, MAX_STRING)}…[+${input.length - MAX_STRING} chars]` : input;
  }
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (Array.isArray(input)) return input.slice(0, 40).map((v) => redactMetadata(v, depth + 1));
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] = '[redacted]';
        continue;
      }
      if (BULK_TEXT_KEY.test(k) && typeof v === 'string') {
        out[`${k}Length`] = v.length;
        continue;
      }
      out[k] = redactMetadata(v, depth + 1);
    }
    return out;
  }
  return '[unserialisable]';
}

/**
 * Record an audit event. Never throws - a logging failure must not break a
 * user-facing action, but it is reported to the server console.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    const db = getDb();
    await db.insert(auditEvents).values({
      userId: input.userId,
      actorType: input.actorType ?? 'user',
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      beforeSummary: input.beforeSummary ? String(input.beforeSummary).slice(0, 1000) : null,
      afterSummary: input.afterSummary ? String(input.afterSummary).slice(0, 1000) : null,
      metadata: (redactMetadata(input.metadata ?? {}) ?? {}) as Record<string, unknown>,
      requestId: input.requestId ?? null,
      ipHash: await hashIp(input.ip),
    });
  } catch (err) {
    console.error('[audit] failed to record event', input.action, err instanceof Error ? err.message : err);
  }
}

/**
 * Read-only, paginated by `before` (an exclusive `createdAt` cursor) so a
 * page can "load more" without an offset that shifts as new events arrive.
 */
export async function listAuditEvents(
  userId: string,
  opts: { limit?: number; before?: Date } = {},
): Promise<AuditEvent[]> {
  if (!isDatabaseConfigured()) return [];
  const conditions = [eq(auditEvents.userId, userId)];
  if (opts.before) conditions.push(lt(auditEvents.createdAt, opts.before));
  return getDb()
    .select()
    .from(auditEvents)
    .where(and(...conditions))
    .orderBy(desc(auditEvents.createdAt))
    .limit(Math.min(200, opts.limit ?? 50));
}
