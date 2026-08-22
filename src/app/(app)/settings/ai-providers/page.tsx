import type { Metadata } from 'next';
import { AiProvidersView } from '@/components/settings/ai-providers-view';
import { requireUserPage } from '@/lib/auth';
import { isDatabaseConfigured } from '@/lib/db';
import { isEncryptionConfigured } from '@/lib/crypto';
import { listProviderKeys } from '@/lib/ai/keys';
import { Alert } from '@/components/ui/alert';

export const metadata: Metadata = { title: 'AI providers' };

export default async function AiProvidersPage() {
  const user = await requireUserPage('/settings/ai-providers');

  if (!isDatabaseConfigured()) {
    return (
      <Alert tone="warning" title="Database not configured">
        Set DATABASE_URL and run the migrations.
      </Alert>
    );
  }

  const keys = await listProviderKeys(user.id);

  return (
    <AiProvidersView
      encryptionConfigured={isEncryptionConfigured()}
      keys={keys.map((k) => ({
        provider: k.provider,
        maskedKey: k.maskedKey,
        baseUrl: k.baseUrl,
        defaultModel: k.defaultModel,
        enabled: k.enabled,
        isDefault: k.isDefault,
        monthlyTokenLimit: k.monthlyTokenLimit,
        validationStatus: k.validationStatus,
        lastValidatedAt: k.lastValidatedAt ? k.lastValidatedAt.toISOString() : null,
      }))}
    />
  );
}
