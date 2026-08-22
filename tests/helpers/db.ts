/**
 * Integration-test harness.
 *
 * Spins up a real PostgreSQL (PGlite, in-process WASM), applies the actual
 * migrations, and injects the handle into the app's `getDb()`. Integration
 * tests therefore exercise the genuine SQL — cascades, unique indexes, row
 * locking, `ON CONFLICT` — rather than a mock that agrees with itself.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { __setDb, type Database } from '@/lib/db';
import { __setStorageDriver, type StorageDriver, type StoredObject } from '@/lib/storage';
import { __setEmailProvider, type EmailProvider, type SendEmailInput, type SendEmailResult } from '@/lib/email';
import { JOB_SOURCE_REGISTRY } from '@/lib/jobs/registry';
import { hashPassword } from '@/lib/auth/password';
import { __resetEnvCache } from '@/lib/env';

export interface TestDb {
  db: Database;
  client: PGlite;
  close: () => Promise<void>;
}

/** Fresh in-memory database with migrations applied, wired into the app. */
export async function createTestDb(): Promise<TestDb> {
  // Faithfulness matters here: modules such as `recordAudit` and the rate
  // limiter check `isDatabaseConfigured()` and no-op when DATABASE_URL is
  // unset. Without this, integration tests would silently exercise a
  // different code path than production.
  process.env.DATABASE_URL ??= 'pglite://memory';
  __resetEnvCache();

  const client = new PGlite('memory://');
  const db = drizzle(client, { schema }) as unknown as Database;
  await migrate(drizzle(client), { migrationsFolder: './src/lib/db/migrations' });
  __setDb(db);

  return {
    db,
    client,
    close: async () => {
      __setDb(null);
      await client.close();
    },
  };
}

/** In-memory storage driver, so tests never touch the filesystem. */
export class MemoryStorage implements StorageDriver {
  readonly id = 'local' as const;
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async put(path: string, bytes: Uint8Array, contentType: string): Promise<StoredObject> {
    // Copy, matching the real drivers (Vercel Blob does `Buffer.from`, the
    // filesystem driver writes to disk). Storing the caller's reference would
    // hide bugs where a buffer is mutated or detached after being stored.
    this.objects.set(path, { bytes: new Uint8Array(bytes), contentType });
    return { path, url: null, size: bytes.byteLength, contentType };
  }

  async get(path: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    return this.objects.get(path) ?? null;
  }

  async remove(path: string): Promise<void> {
    this.objects.delete(path);
  }
}

export function useMemoryStorage(): MemoryStorage {
  const storage = new MemoryStorage();
  __setStorageDriver(storage);
  return storage;
}

/** Captures messages instead of sending them, so a test can assert on content. */
export class CapturingEmailProvider implements EmailProvider {
  readonly id = 'capturing';
  readonly sent: SendEmailInput[] = [];
  shouldFail = false;

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (this.shouldFail) {
      return { ok: false, providerMessageId: null, provider: this.id, error: 'Simulated provider failure.' };
    }
    this.sent.push(input);
    return { ok: true, providerMessageId: `test-${this.sent.length}`, provider: this.id };
  }
}

export function useCapturingEmail(): CapturingEmailProvider {
  const provider = new CapturingEmailProvider();
  __setEmailProvider(provider);
  return provider;
}

export function resetAdapters(): void {
  __setStorageDriver(null);
  __setEmailProvider(null);
}

/* ------------------------------------------------------------------ seeding */

export interface TestUser {
  id: string;
  email: string;
}

/** Create a user with a complete profile, as onboarding would. */
export async function createUser(
  db: Database,
  email: string,
  overrides: Partial<{
    fullName: string;
    skills: string[];
    targetTitles: string[];
    verified: boolean;
  }> = {},
): Promise<TestUser> {
  const rows = await db
    .insert(schema.users)
    .values({
      email,
      name: overrides.fullName ?? 'Test User',
      passwordHash: await hashPassword('correct horse battery staple'),
      emailVerifiedAt: overrides.verified === false ? null : new Date(),
      onboardingCompletedAt: new Date(),
    })
    .returning({ id: schema.users.id });

  const id = rows[0]!.id;

  await db.insert(schema.profiles).values({
    userId: id,
    personal: {
      fullName: overrides.fullName ?? 'Test User',
      email,
      phone: '+91 98765 43210',
      city: 'Bengaluru',
      country: 'India',
    },
    professional: {
      currentTitle: 'Senior Backend Engineer',
      targetTitles: overrides.targetTitles ?? ['Senior Backend Engineer'],
      yearsOfExperience: 7,
      skills: overrides.skills ?? ['TypeScript', 'PostgreSQL', 'Kafka', 'Kubernetes', 'AWS'],
      professionalSummary: 'Backend engineer.',
      education: [{ degree: 'B.E.', institution: 'Anna University' }],
    },
    jobPreferences: {
      preferredLocations: ['Bengaluru'],
      minExpectedCtc: 4_000_000,
      noticePeriodDays: 60,
      workAuthorization: 'citizen',
      currency: 'INR',
      minMatchScore: 60,
      maxApplicationsPerDay: 5,
      applicationSchedule: 'daily',
    },
    applicationProfile: { allowSensitiveAnswerReuse: false },
  });

  return { id, email };
}

/** Insert the job-source registry, as `npm run db:seed` does. */
export async function seedJobSources(db: Database): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const src of JOB_SOURCE_REGISTRY) {
    const rows = await db
      .insert(schema.jobSources)
      .values({
        name: src.name,
        adapterKey: src.adapterKey,
        sourceType: src.sourceType,
        policyStatus: src.policyStatus,
        policyNote: src.policyNote,
        enabled: src.enabledByDefault,
      })
      .returning({ id: schema.jobSources.id });
    out.set(src.adapterKey, rows[0]!.id);
  }
  return out;
}

/** Row counts for a user, used to assert cascade behaviour. */
export async function countUserRows(db: Database, userId: string): Promise<Record<string, number>> {
  const tables: [string, typeof schema.profiles][] = [
    ['profiles', schema.profiles],
    ['resumeDocuments', schema.resumeDocuments as never],
    ['resumeVersions', schema.resumeVersions as never],
    ['resumeAnalyses', schema.resumeAnalyses as never],
    ['resumeSuggestions', schema.resumeSuggestions as never],
    ['applications', schema.applications as never],
    ['outreachContacts', schema.outreachContacts as never],
    ['auditEvents', schema.auditEvents as never],
  ];

  const out: Record<string, number> = {};
  for (const [name, table] of tables) {
    const rows = await db
      .select()
      .from(table as never)
      .where(eq((table as unknown as { userId: never }).userId, userId as never));
    out[name] = rows.length;
  }
  return out;
}
