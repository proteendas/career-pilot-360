'use server';

/**
 * AI provider (BYOK) server actions. Every key is sealed before storage and
 * never returned to the client — see `src/lib/ai/keys.ts`.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import {
  addProviderKey,
  deleteProviderKey,
  ProviderKeyError,
  setDefaultProvider,
  setProviderEnabled,
  testProviderKey,
  updateProviderSettings,
} from '@/lib/ai/keys';
import { isProviderId } from '@/lib/ai/registry';
import { AI_TASKS, type AiTask } from '@/lib/ai/types';

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  notice?: string;
  data?: T;
}

function toResult(err: unknown): ActionResult<never> {
  if (err instanceof ProviderKeyError) return { ok: false, error: err.message };
  console.error('[settings-action] unexpected failure', err);
  return { ok: false, error: 'Something went wrong. Please try again.' };
}

const addKeySchema = z.object({
  provider: z.string().refine(isProviderId, 'Unknown provider.'),
  apiKey: z.string().trim().min(1, 'Enter an API key.').max(2000),
  baseUrl: z.string().trim().max(2048).optional(),
  defaultModel: z.string().trim().max(200).optional(),
  monthlyTokenLimit: z.number().int().positive().optional(),
});

export async function addProviderKeyAction(raw: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = addKeySchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };

    await addProviderKey(user.id, parsed.data as Parameters<typeof addProviderKey>[1]);
    revalidatePath('/settings/ai-providers');
    return { ok: true, notice: 'Key saved. Run a connection test to confirm it works.' };
  } catch (err) {
    return toResult(err);
  }
}

export async function setProviderEnabledAction(provider: string, enabled: boolean): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await setProviderEnabled(user.id, provider, enabled);
    revalidatePath('/settings/ai-providers');
    return { ok: true, notice: enabled ? 'Enabled.' : 'Disabled.' };
  } catch (err) {
    return toResult(err);
  }
}

export async function setDefaultProviderAction(provider: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await setDefaultProvider(user.id, provider);
    revalidatePath('/settings/ai-providers');
    return { ok: true, notice: 'Default provider updated.' };
  } catch (err) {
    return toResult(err);
  }
}

const updateSettingsSchema = z.object({
  provider: z.string().refine(isProviderId, 'Unknown provider.'),
  defaultModel: z.string().trim().max(200).optional(),
  monthlyTokenLimit: z.number().int().positive().nullable().optional(),
  disabledTasks: z.array(z.enum(AI_TASKS as [AiTask, ...AiTask[]])).optional(),
});

export async function updateProviderSettingsAction(raw: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = updateSettingsSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'Those settings could not be understood.' };

    const { provider, defaultModel, monthlyTokenLimit, disabledTasks } = parsed.data;
    await updateProviderSettings(user.id, provider, {
      ...(defaultModel !== undefined ? { defaultModel: defaultModel || null } : {}),
      ...(monthlyTokenLimit !== undefined ? { monthlyTokenLimit } : {}),
      ...(disabledTasks !== undefined ? { settings: { disabledTasks } } : {}),
    });
    revalidatePath('/settings/ai-providers');
    return { ok: true, notice: 'Saved.' };
  } catch (err) {
    return toResult(err);
  }
}

export async function deleteProviderKeyAction(provider: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await deleteProviderKey(user.id, provider);
    revalidatePath('/settings/ai-providers');
    return { ok: true, notice: 'Removed.' };
  } catch (err) {
    return toResult(err);
  }
}

export async function testProviderKeyAction(provider: string): Promise<ActionResult<{ ok: boolean }>> {
  try {
    const user = await requireUser();
    const result = await testProviderKey(user.id, provider);
    revalidatePath('/settings/ai-providers');
    return result.ok
      ? { ok: true, notice: 'Connection succeeded.', data: { ok: true } }
      : { ok: false, error: result.error ?? 'The connection test failed.', data: { ok: false } };
  } catch (err) {
    return toResult(err);
  }
}
