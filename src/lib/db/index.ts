/**
 * Database client. Server-only.
 *
 * Two drivers, one schema, one `Database` type:
 *
 *  - `postgres.js` — the production path. `max: 1` + `prepare: false` is the
 *    configuration that behaves correctly behind a Vercel Postgres / Neon
 *    connection pooler, and a single connection is reused across warm
 *    invocations.
 *
 *  - `PGlite` — real PostgreSQL compiled to WebAssembly, running in-process.
 *    Selected when `DATABASE_URL` uses the `pglite:` scheme. This exists so
 *    local development and CI can exercise the genuine SQL (jsonb, uuid,
 *    cascades, ON CONFLICT, row locking) with no database to install. It is
 *    NOT for production: use a Marketplace Postgres there.
 *
 *      DATABASE_URL="pglite://.pglite"     persistent, on disk
 *      DATABASE_URL="pglite://memory"      ephemeral, per process
 */
import { drizzle as drizzlePg, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import postgres from 'postgres';
import { env } from '@/lib/env';
import * as schema from './schema';

export * from './schema';
export { schema };

/**
 * One canonical handle type. Both drivers expose the same query-builder
 * surface, so `Database` is pinned to the postgres.js shape and the PGlite
 * handle is adapted to it. Keeping this a single type (rather than a union)
 * matters: a union would break overloaded builder calls such as
 * `.returning({ id })` at every call site.
 */
export type Database = PostgresJsDatabase<typeof schema>;

declare global {
   
  var __cp360Sql: ReturnType<typeof postgres> | undefined;
   
  var __cp360Db: Database | undefined;
   
  var __cp360Pglite: unknown | undefined;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super(
      'DATABASE_URL is not set. Provision a Postgres database from the Vercel Marketplace, ' +
        'point DATABASE_URL at a local Postgres, or use DATABASE_URL="pglite://.pglite" for ' +
        'an in-process development database.',
    );
    this.name = 'DatabaseNotConfiguredError';
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(env().DATABASE_URL);
}

export function isPgliteUrl(url: string | undefined = env().DATABASE_URL): boolean {
  return Boolean(url?.startsWith('pglite:'));
}

/** Which driver is active. Surfaced in the UI so the mode is never a surprise. */
export function databaseDriverId(): 'postgres' | 'pglite' | 'none' {
  if (!isDatabaseConfigured()) return 'none';
  return isPgliteUrl() ? 'pglite' : 'postgres';
}

/** Translate `pglite://<target>` into a PGlite data directory or `:memory:`. */
export function pgliteDataDir(url: string): string {
  const target = url.replace(/^pglite:(\/\/)?/, '').trim();
  if (!target || target === 'memory' || target === ':memory:') return 'memory://';
  return target;
}

export function getSql(): ReturnType<typeof postgres> {
  const url = env().DATABASE_URL;
  if (!url) throw new DatabaseNotConfiguredError();
  if (isPgliteUrl(url)) {
    throw new Error('getSql() is only available for the postgres.js driver, not PGlite.');
  }
  if (!globalThis.__cp360Sql) {
    globalThis.__cp360Sql = postgres(url, {
      max: 1,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 15,
      onnotice: () => undefined,
    });
  }
  return globalThis.__cp360Sql;
}

/**
 * The Drizzle handle. Throws {@link DatabaseNotConfiguredError} when unset.
 *
 * PGlite is loaded through `require` so the WASM bundle is never pulled into a
 * production build that does not use it.
 */
export function getDb(): Database {
  if (globalThis.__cp360Db) return globalThis.__cp360Db;
  const url = env().DATABASE_URL;
  if (!url) throw new DatabaseNotConfiguredError();

  if (isPgliteUrl(url)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PGlite } = require('@electric-sql/pglite') as typeof import('@electric-sql/pglite');
    const client = (globalThis.__cp360Pglite ??= new PGlite(pgliteDataDir(url)));
    const lite: PgliteDatabase<typeof schema> = drizzlePglite(client as InstanceType<typeof PGlite>, { schema });
    globalThis.__cp360Db = lite as unknown as Database;
  } else {
    globalThis.__cp360Db = drizzlePg(getSql(), { schema });
  }
  return globalThis.__cp360Db;
}

/** Returns null instead of throwing, for pages that render a setup state. */
export function tryGetDb(): Database | null {
  return isDatabaseConfigured() ? getDb() : null;
}

/** Close pooled handles. Used by scripts and test teardown. */
export async function closeDb(): Promise<void> {
  if (globalThis.__cp360Sql) {
    await globalThis.__cp360Sql.end({ timeout: 5 });
    globalThis.__cp360Sql = undefined;
  }
  const lite = globalThis.__cp360Pglite as { close?: () => Promise<void> } | undefined;
  if (lite?.close) await lite.close();
  globalThis.__cp360Pglite = undefined;
  globalThis.__cp360Db = undefined;
}

/** Test-only: inject a prepared Drizzle handle. */
export function __setDb(db: Database | null): void {
  globalThis.__cp360Db = db ?? undefined;
}
