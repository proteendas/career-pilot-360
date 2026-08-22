/**
 * Apply SQL migrations. Works against both drivers.
 *
 *   npm run db:migrate
 *
 * Idempotent: Drizzle records applied migrations in `drizzle.__drizzle_migrations`.
 */
import { loadEnv } from './load-env';

loadEnv();
import { closeDb, databaseDriverId, isPgliteUrl, pgliteDataDir } from '../src/lib/db';

const MIGRATIONS_FOLDER = './src/lib/db/migrations';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env.local first.');
    process.exit(1);
  }

  console.info(`[migrate] driver=${databaseDriverId()}`);

  if (isPgliteUrl(url)) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const client = new PGlite(pgliteDataDir(url));
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await client.close();
  } else {
    const postgres = (await import('postgres')).default;
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await sql.end({ timeout: 5 });
  }

  await closeDb();
  console.info('[migrate] up to date');
}

main().catch((err) => {
  console.error('[migrate] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
