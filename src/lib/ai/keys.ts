/**
 * AI provider key management — the BYOK store. Server-only.
 *
 * Keys are sealed with `encryptSecret` (AES-256-GCM, key-ring rotation) before
 * they ever touch the database, and `resolveProviders` in `client.ts` is the
 * only place they are decrypted. Nothing in this module, and nothing that
 * calls it, ever receives the plaintext key back — only a masked preview.
 */
import { and, eq } from 'drizzle-orm';
import { aiProviderKeys, getDb, isDatabaseConfigured, type AiProviderKey } from '@/lib/db';
import { decryptSecret, encryptSecret, isEncryptionConfigured } from '@/lib/crypto';
import { recordAudit } from '@/lib/audit';
import { findProvider, isProviderId, type ProviderId } from './registry';
import type { ProviderSettings } from './client';
import { getAdapter } from './client';

export class ProviderKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderKeyError';
  }
}

function assertConfigured(): void {
  if (!isDatabaseConfigured()) throw new ProviderKeyError('Database is not configured.');
  if (!isEncryptionConfigured()) {
    throw new ProviderKeyError('ENCRYPTION_KEY is not set — provider keys cannot be stored until it is.');
  }
}

function mask(apiKey: string): string {
  const tail = apiKey.trim().slice(-4);
  return tail ? `••••${tail}` : '••••';
}

export interface AddProviderKeyInput {
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  monthlyTokenLimit?: number;
}

/** Adds a new key, or replaces the stored key for a provider the user already has. */
export async function addProviderKey(userId: string, input: AddProviderKeyInput): Promise<void> {
  assertConfigured();
  if (!isProviderId(input.provider)) throw new ProviderKeyError('Unknown provider.');
  const def = findProvider(input.provider)!;
  if (def.requiresBaseUrl && !input.baseUrl?.trim()) {
    throw new ProviderKeyError(`${def.name} requires a base URL.`);
  }
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new ProviderKeyError('Enter an API key.');

  const db = getDb();
  const existing = await db
    .select({ id: aiProviderKeys.id })
    .from(aiProviderKeys)
    .where(and(eq(aiProviderKeys.userId, userId), eq(aiProviderKeys.provider, input.provider)));
  const isFirstKey = (
    await db.select({ id: aiProviderKeys.id }).from(aiProviderKeys).where(eq(aiProviderKeys.userId, userId))
  ).length === 0;

  await db
    .insert(aiProviderKeys)
    .values({
      userId,
      provider: input.provider,
      encryptedKey: encryptSecret(apiKey),
      maskedKey: mask(apiKey),
      baseUrl: input.baseUrl?.trim() || null,
      defaultModel: input.defaultModel?.trim() || null,
      monthlyTokenLimit: input.monthlyTokenLimit ?? null,
      isDefault: isFirstKey,
      validationStatus: 'untested',
    })
    .onConflictDoUpdate({
      target: [aiProviderKeys.userId, aiProviderKeys.provider],
      set: {
        encryptedKey: encryptSecret(apiKey),
        maskedKey: mask(apiKey),
        baseUrl: input.baseUrl?.trim() || null,
        defaultModel: input.defaultModel?.trim() || null,
        monthlyTokenLimit: input.monthlyTokenLimit ?? null,
        enabled: true,
        validationStatus: 'untested',
        lastValidatedAt: null,
        updatedAt: new Date(),
      },
    });

  await recordAudit({
    userId,
    action: 'ai.provider_key_added',
    entityType: 'ai_provider_key',
    metadata: { provider: input.provider, replaced: existing.length > 0 },
  });
}

export async function listProviderKeys(userId: string): Promise<AiProviderKey[]> {
  if (!isDatabaseConfigured()) return [];
  return getDb().select().from(aiProviderKeys).where(eq(aiProviderKeys.userId, userId));
}

async function getOwnedKey(userId: string, provider: string) {
  const rows = await getDb()
    .select()
    .from(aiProviderKeys)
    .where(and(eq(aiProviderKeys.userId, userId), eq(aiProviderKeys.provider, provider)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new ProviderKeyError('That provider key was not found.');
  return row;
}

export async function setProviderEnabled(userId: string, provider: string, enabled: boolean): Promise<void> {
  await getOwnedKey(userId, provider);
  await getDb()
    .update(aiProviderKeys)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(aiProviderKeys.userId, userId), eq(aiProviderKeys.provider, provider)));
}

/** Makes this provider the first one tried for every task that doesn't prefer another. */
export async function setDefaultProvider(userId: string, provider: string): Promise<void> {
  await getOwnedKey(userId, provider);
  const db = getDb();
  await db.update(aiProviderKeys).set({ isDefault: false, updatedAt: new Date() }).where(eq(aiProviderKeys.userId, userId));
  await db
    .update(aiProviderKeys)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(and(eq(aiProviderKeys.userId, userId), eq(aiProviderKeys.provider, provider)));
}

export async function updateProviderSettings(
  userId: string,
  provider: string,
  patch: Partial<{ defaultModel: string | null; monthlyTokenLimit: number | null; settings: ProviderSettings }>,
): Promise<void> {
  await getOwnedKey(userId, provider);
  await getDb()
    .update(aiProviderKeys)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(aiProviderKeys.userId, userId), eq(aiProviderKeys.provider, provider)));
}

export async function deleteProviderKey(userId: string, provider: string): Promise<void> {
  await getOwnedKey(userId, provider);
  await getDb().delete(aiProviderKeys).where(and(eq(aiProviderKeys.userId, userId), eq(aiProviderKeys.provider, provider)));
  await recordAudit({
    userId,
    action: 'ai.provider_key_removed',
    entityType: 'ai_provider_key',
    metadata: { provider },
  });
}

/**
 * Sends one tiny request directly to this specific provider's adapter — not
 * through `generateText`'s fallback chain — so a passing test can only mean
 * this exact key and provider work, never a different provider quietly
 * covering for a broken one.
 */
export async function testProviderKey(userId: string, provider: string): Promise<{ ok: boolean; error?: string }> {
  const row = await getOwnedKey(userId, provider);
  const db = getDb();
  const def = findProvider(provider);
  if (!def) throw new ProviderKeyError('Unknown provider.');

  try {
    const apiKey = decryptSecret(row.encryptedKey);
    await getAdapter(provider).generateText(
      {
        messages: [
          { role: 'system', content: 'Reply with exactly one word: OK.' },
          { role: 'user', content: 'Connection test.' },
        ],
        model: row.defaultModel || def.defaultModel,
        maxOutputTokens: 8,
      },
      { apiKey, ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}) },
    );
    await db
      .update(aiProviderKeys)
      .set({ validationStatus: 'valid', lastValidatedAt: new Date() })
      .where(and(eq(aiProviderKeys.userId, userId), eq(aiProviderKeys.provider, provider)));
    await recordAudit({
      userId,
      action: 'ai.provider_key_validated',
      entityType: 'ai_provider_key',
      metadata: { provider, ok: true },
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The test request failed.';
    await db
      .update(aiProviderKeys)
      .set({ validationStatus: 'invalid', lastValidatedAt: new Date() })
      .where(and(eq(aiProviderKeys.userId, userId), eq(aiProviderKeys.provider, provider)));
    await recordAudit({
      userId,
      action: 'ai.provider_key_validated',
      entityType: 'ai_provider_key',
      metadata: { provider, ok: false, error: message },
    });
    return { ok: false, error: message };
  }
}
