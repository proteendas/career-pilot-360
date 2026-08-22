/**
 * Central environment contract.
 *
 * Rules:
 *  - Server-only secrets are read lazily so that importing this module from a
 *    client bundle can never leak a value.
 *  - Nothing here is exported to the browser except `publicEnv`.
 *  - Missing optional providers degrade to a documented "not configured" state
 *    rather than throwing at import time (see `featureFlags`).
 */
import { z } from 'zod';

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1).optional(),
  AUTH_SECRET: z.string().min(16).optional(),
  AUTH_URL: z.string().url().optional(),
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  SEARCH_PROVIDER: z.enum(['none', 'adzuna']).default('none'),
  ADZUNA_APP_ID: z.string().optional(),
  ADZUNA_APP_KEY: z.string().optional(),
  STORAGE_DRIVER: z.enum(['auto', 'blob', 'local']).default('auto'),
  LOCAL_STORAGE_DIR: z.string().default('.storage'),
  APP_AI_PROVIDER: z.string().optional(),
  APP_AI_API_KEY: z.string().optional(),
  APP_AI_MODEL: z.string().optional(),
  APP_AI_BASE_URL: z.string().optional(),
  ALLOW_INSECURE_URL_FETCH: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

/** Server-only. Never call from a client component. */
export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    // Surface which var is malformed without printing its value.
    const keys = Object.keys(z.flattenError(parsed.error).fieldErrors).join(', ');
    throw new Error(`Invalid environment configuration for: ${keys}`);
  }
  cached = parsed.data;
  return cached;
}

/** Reset the memoised env. Test-only. */
export function __resetEnvCache(): void {
  cached = null;
}

export const publicEnv = {
  appName: 'CareerPilot360',
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
} as const;

/**
 * Which optional capabilities are actually configured. The UI uses this to show
 * an honest "setup required" state instead of fabricating production data.
 */
export function featureFlags() {
  const e = env();
  return {
    database: Boolean(e.DATABASE_URL),
    linkedinOAuth: Boolean(e.LINKEDIN_CLIENT_ID && e.LINKEDIN_CLIENT_SECRET),
    vercelBlob: Boolean(e.BLOB_READ_WRITE_TOKEN),
    providerKeyEncryption: Boolean(e.ENCRYPTION_KEY),
    cron: Boolean(e.CRON_SECRET),
    emailSending: e.EMAIL_PROVIDER === 'resend' ? Boolean(e.RESEND_API_KEY && e.EMAIL_FROM) : false,
    emailDriver: e.EMAIL_PROVIDER,
    searchProvider: e.SEARCH_PROVIDER,
    externalJobSearch: e.SEARCH_PROVIDER === 'adzuna' ? Boolean(e.ADZUNA_APP_ID && e.ADZUNA_APP_KEY) : false,
    appLevelAiFallback: Boolean(e.APP_AI_API_KEY && e.APP_AI_PROVIDER),
  } as const;
}

export function isProduction(): boolean {
  return env().NODE_ENV === 'production';
}
