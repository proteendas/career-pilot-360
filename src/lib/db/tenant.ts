/**
 * Tenant isolation helpers.
 *
 * Rule: any read or write of user-owned data goes through one of these
 * functions, which force a `user_id` predicate into the query. Unit tests in
 * tests/authorization.test.ts assert that ownership is enforced.
 */
import { and, eq, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { getDb } from './index';

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = 'You do not have access to that resource.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = 'Not found.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

type OwnedTable = PgTable & { id: never } & Record<string, unknown>;

/** Compose `user_id = :userId AND <extra>` for any user-owned table. */
export function ownedBy<T extends Record<string, unknown>>(
  table: T,
  userId: string,
  extra?: SQL | undefined,
): SQL {
  const col = (table as Record<string, unknown>)['userId'];
  if (!col) throw new Error('ownedBy() used on a table without a userId column.');
  const base = eq(col as never, userId);
  return (extra ? and(base, extra) : base) as SQL;
}

/**
 * Fetch exactly one row owned by `userId`.
 * Throws NotFoundError when it does not exist OR belongs to someone else -
 * deliberately indistinguishable, so ids cannot be probed.
 */
export async function findOwned<T extends Record<string, unknown>>(
  table: T,
  userId: string,
  id: string,
): Promise<Record<string, unknown>> {
  const db = getDb();
  const idCol = (table as Record<string, unknown>)['id'];
  if (!idCol) throw new Error('findOwned() used on a table without an id column.');
  const rows = await db
    .select()
    .from(table as unknown as OwnedTable)
    .where(and(ownedBy(table, userId), eq(idCol as never, id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError();
  return row as Record<string, unknown>;
}

/** Assert a loaded row belongs to the caller. Defence in depth. */
export function assertOwner(row: { userId?: string | null } | null | undefined, userId: string): void {
  if (!row || row.userId !== userId) throw new ForbiddenError();
}
