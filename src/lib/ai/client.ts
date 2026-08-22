/**
 * The AI entry point for the rest of the app. Server-only.
 *
 * Responsibilities:
 *  - resolve which provider to use for a task (per-task override → default →
 *    priority order → application-level fallback);
 *  - decrypt the user's key inside this boundary and nowhere else;
 *  - enforce per-provider monthly token ceilings and per-task disabling;
 *  - fall back to the next provider on a retryable failure;
 *  - record usage for the dashboard.
 *
 * Callers never see a key, never choose a provider, and never see a raw
 * provider error — they get an `AiError` with a code they can branch on, or a
 * documented deterministic fallback.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { aiProviderKeys, aiUsage, getDb, isDatabaseConfigured } from '@/lib/db';
import { decryptSecret, isEncryptionConfigured } from '@/lib/crypto';
import { env } from '@/lib/env';
import {
  AiError,
  addUsage,
  emptyUsage,
  type AiTask,
  type AIProvider,
  type ChatMessage,
  type GenerateTextResult,
  type ProviderCredentials,
  type TokenUsage,
  type ToolDefinition,
} from './types';
import { DEFAULT_PROVIDER_PRIORITY, findProvider, isProviderId, type ProviderId } from './registry';
import { OpenAiCompatibleProvider } from './providers/openai-compatible';
import { AnthropicProvider } from './providers/anthropic';
import { GoogleProvider } from './providers/google';

/* ------------------------------------------------------------- adapter map */

const adapters = new Map<string, AIProvider>();

export function getAdapter(providerId: string): AIProvider {
  const cached = adapters.get(providerId);
  if (cached) return cached;

  const def = findProvider(providerId);
  if (!def) throw new AiError('unknown', `Unknown provider: ${providerId}`);

  const adapter: AIProvider =
    def.kind === 'anthropic'
      ? new AnthropicProvider()
      : def.kind === 'google'
        ? new GoogleProvider()
        : new OpenAiCompatibleProvider(def.id);

  adapters.set(providerId, adapter);
  return adapter;
}

/* --------------------------------------------------------- key resolution -- */

/** Per-provider settings stored alongside the key. */
export interface ProviderSettings {
  /** Task → model override. */
  taskModels?: Partial<Record<AiTask, string>>;
  /** Tasks explicitly disabled for this provider. */
  disabledTasks?: AiTask[];
  /** Tasks this provider is the preferred choice for. */
  preferredTasks?: AiTask[];
}

interface ResolvedProvider {
  providerId: string;
  adapter: AIProvider;
  creds: ProviderCredentials;
  model: string;
  monthlyTokenLimit: number | null;
  settings: ProviderSettings;
  /** True when this came from environment configuration, not the user. */
  isAppFallback: boolean;
}

/**
 * All providers the user can use for `task`, best first.
 * Ordering: explicitly preferred for this task → user default → registry
 * priority. Disabled providers and disabled tasks are filtered out.
 */
async function resolveProviders(userId: string, task: AiTask): Promise<ResolvedProvider[]> {
  const out: ResolvedProvider[] = [];

  if (isDatabaseConfigured() && isEncryptionConfigured()) {
    const rows = await getDb()
      .select()
      .from(aiProviderKeys)
      .where(and(eq(aiProviderKeys.userId, userId), eq(aiProviderKeys.enabled, true)));

    for (const row of rows) {
      if (!isProviderId(row.provider)) continue;
      const settings = (row.settings ?? {}) as ProviderSettings;
      if (settings.disabledTasks?.includes(task)) continue;

      let apiKey: string;
      try {
        apiKey = decryptSecret(row.encryptedKey);
      } catch {
        // A key sealed with a retired encryption key: skip it rather than
        // failing the whole request, and leave it for re-encryption.
        console.error('[ai] could not decrypt a stored provider key', { provider: row.provider });
        continue;
      }

      const def = findProvider(row.provider)!;
      out.push({
        providerId: row.provider,
        adapter: getAdapter(row.provider),
        creds: { apiKey, ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}) },
        model: settings.taskModels?.[task] || row.defaultModel || def.defaultModel,
        monthlyTokenLimit: row.monthlyTokenLimit ?? null,
        settings,
        isAppFallback: false,
      });
    }

    out.sort((a, b) => {
      const aPreferred = a.settings.preferredTasks?.includes(task) ? 0 : 1;
      const bPreferred = b.settings.preferredTasks?.includes(task) ? 0 : 1;
      if (aPreferred !== bPreferred) return aPreferred - bPreferred;

      const aDefault = rows.find((r) => r.provider === a.providerId)?.isDefault ? 0 : 1;
      const bDefault = rows.find((r) => r.provider === b.providerId)?.isDefault ? 0 : 1;
      if (aDefault !== bDefault) return aDefault - bDefault;

      return (
        DEFAULT_PROVIDER_PRIORITY.indexOf(a.providerId as ProviderId) -
        DEFAULT_PROVIDER_PRIORITY.indexOf(b.providerId as ProviderId)
      );
    });
  }

  // Application-level fallback, so the product is usable before a user
  // configures anything. Always last.
  const e = env();
  if (e.APP_AI_PROVIDER && e.APP_AI_API_KEY && isProviderId(e.APP_AI_PROVIDER)) {
    const def = findProvider(e.APP_AI_PROVIDER)!;
    out.push({
      providerId: e.APP_AI_PROVIDER,
      adapter: getAdapter(e.APP_AI_PROVIDER),
      creds: { apiKey: e.APP_AI_API_KEY, ...(e.APP_AI_BASE_URL ? { baseUrl: e.APP_AI_BASE_URL } : {}) },
      model: e.APP_AI_MODEL || def.defaultModel,
      monthlyTokenLimit: null,
      settings: {},
      isAppFallback: true,
    });
  }

  return out;
}

/** Tokens this provider has consumed for this user in the current month. */
async function monthlyTokens(userId: string, provider: string): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const rows = await getDb()
    .select({ total: sql<number>`coalesce(sum(${aiUsage.totalTokens}), 0)` })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.provider, provider), gte(aiUsage.createdAt, monthStart)));

  return Number(rows[0]?.total ?? 0);
}

async function recordUsage(input: {
  userId: string;
  provider: string;
  model: string;
  task: AiTask;
  usage: TokenUsage;
  latencyMs: number;
  succeeded: boolean;
  errorCode?: string | null;
}): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    await getDb().insert(aiUsage).values({
      userId: input.userId,
      provider: input.provider,
      model: input.model,
      task: input.task,
      promptTokens: input.usage.promptTokens,
      completionTokens: input.usage.completionTokens,
      totalTokens: input.usage.totalTokens,
      latencyMs: input.latencyMs,
      succeeded: input.succeeded,
      errorCode: input.errorCode ?? null,
    });
  } catch (err) {
    console.error('[ai] failed to record usage', err instanceof Error ? err.message : err);
  }
}

/* ------------------------------------------------------------------ status */

export interface AiAvailability {
  available: boolean;
  reason?: string;
  providers: { id: string; name: string; model: string; isAppFallback: boolean }[];
}

/** Whether AI is usable for a task right now. Drives the UI's honest states. */
export async function aiAvailability(userId: string, task: AiTask): Promise<AiAvailability> {
  if (!isEncryptionConfigured() && !env().APP_AI_API_KEY) {
    return {
      available: false,
      reason:
        'ENCRYPTION_KEY is not configured, so provider keys cannot be stored. ' +
        'The deterministic analysis still works.',
      providers: [],
    };
  }

  const resolved = await resolveProviders(userId, task);
  if (resolved.length === 0) {
    return {
      available: false,
      reason: 'No AI provider is configured for this task. Add a key in Settings → AI providers.',
      providers: [],
    };
  }

  return {
    available: true,
    providers: resolved.map((r) => ({
      id: r.providerId,
      name: findProvider(r.providerId)?.name ?? r.providerId,
      model: r.model,
      isAppFallback: r.isAppFallback,
    })),
  };
}

/* -------------------------------------------------------------- execution -- */

export interface RunOptions {
  userId: string;
  task: AiTask;
  messages: ChatMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

export interface RunResult<T> {
  value: T;
  provider: string;
  model: string;
  usage: TokenUsage;
  /** Providers that failed before this one succeeded. */
  attempts: { provider: string; error: string }[];
}

/**
 * Try each eligible provider in turn. A retryable failure moves to the next
 * provider; a non-retryable one (an invalid key, say) stops immediately, because
 * retrying will not help and the user needs to know.
 */
async function withFallback<T>(
  opts: { userId: string; task: AiTask },
  run: (p: ResolvedProvider) => Promise<{ value: T; usage: TokenUsage; model: string }>,
): Promise<RunResult<T>> {
  const providers = await resolveProviders(opts.userId, opts.task);
  if (providers.length === 0) {
    throw new AiError('no_provider_configured', 'No AI provider is configured for this task.');
  }

  const attempts: { provider: string; error: string }[] = [];
  let lastError: AiError | null = null;

  for (const provider of providers) {
    if (provider.monthlyTokenLimit !== null) {
      const used = await monthlyTokens(opts.userId, provider.providerId);
      if (used >= provider.monthlyTokenLimit) {
        const err = new AiError(
          'token_limit_reached',
          `You have used ${used.toLocaleString('en-US')} of your ${provider.monthlyTokenLimit.toLocaleString('en-US')} monthly token limit for ${provider.providerId}.`,
          { provider: provider.providerId },
        );
        attempts.push({ provider: provider.providerId, error: err.message });
        lastError = err;
        continue;
      }
    }

    const startedAt = Date.now();
    try {
      const result = await run(provider);
      await recordUsage({
        userId: opts.userId,
        provider: provider.providerId,
        model: result.model,
        task: opts.task,
        usage: result.usage,
        latencyMs: Date.now() - startedAt,
        succeeded: true,
      });
      return {
        value: result.value,
        provider: provider.providerId,
        model: result.model,
        usage: result.usage,
        attempts,
      };
    } catch (err) {
      const aiErr =
        err instanceof AiError
          ? err
          : new AiError('unknown', err instanceof Error ? err.message : 'Unknown AI failure', {
              provider: provider.providerId,
            });

      await recordUsage({
        userId: opts.userId,
        provider: provider.providerId,
        model: provider.model,
        task: opts.task,
        usage: emptyUsage(),
        latencyMs: Date.now() - startedAt,
        succeeded: false,
        errorCode: aiErr.code,
      });

      attempts.push({ provider: provider.providerId, error: aiErr.message });
      lastError = aiErr;

      if (!aiErr.retryable) throw aiErr;
    }
  }

  throw lastError ?? new AiError('unknown', 'Every configured AI provider failed.');
}

/** Free-form text generation. */
export async function generateText(opts: RunOptions): Promise<RunResult<GenerateTextResult>> {
  return withFallback({ userId: opts.userId, task: opts.task }, async (p) => {
    const res = await p.adapter.generateText(
      {
        messages: opts.messages,
        model: p.model,
        ...(opts.maxOutputTokens === undefined ? {} : { maxOutputTokens: opts.maxOutputTokens }),
        ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
        ...(opts.tools ? { tools: opts.tools } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
      p.creds,
    );
    return { value: res, usage: res.usage, model: res.model };
  });
}

/** Schema-validated structured generation — the primary interface. */
export async function generateObject<T>(
  opts: RunOptions & { schema: z.ZodType<T>; schemaName: string; schemaDescription?: string },
): Promise<RunResult<T>> {
  return withFallback({ userId: opts.userId, task: opts.task }, async (p) => {
    const res = await p.adapter.generateObject<T>(
      {
        messages: opts.messages,
        schema: opts.schema,
        schemaName: opts.schemaName,
        ...(opts.schemaDescription ? { schemaDescription: opts.schemaDescription } : {}),
        model: p.model,
        ...(opts.maxOutputTokens === undefined ? {} : { maxOutputTokens: opts.maxOutputTokens }),
        ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
      p.creds,
    );
    return { value: res.object, usage: res.usage, model: res.model };
  });
}

/**
 * Run an AI task, but never fail the caller: on any AI error the deterministic
 * fallback is used instead. This is how every AI feature in CareerPilot360
 * degrades — the product keeps working without a provider.
 */
export async function generateObjectOrFallback<T>(
  opts: RunOptions & { schema: z.ZodType<T>; schemaName: string; schemaDescription?: string },
  fallback: () => T,
): Promise<{ value: T; usedAi: boolean; provider: string | null; model: string | null; usage: TokenUsage; error?: string }> {
  try {
    const res = await generateObject(opts);
    return {
      value: res.value,
      usedAi: true,
      provider: res.provider,
      model: res.model,
      usage: res.usage,
    };
  } catch (err) {
    const message = err instanceof AiError ? err.message : 'The AI request failed.';
    return {
      value: fallback(),
      usedAi: false,
      provider: null,
      model: null,
      usage: emptyUsage(),
      error: message,
    };
  }
}

export { addUsage, emptyUsage };
