'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert } from '@/components/ui/alert';
import { AddProviderDialog } from './add-provider-dialog';
import { ProviderCard, type ProviderKeyRow } from './provider-card';
import type { ProviderId } from '@/lib/ai/registry';

export function AiProvidersView({
  keys,
  encryptionConfigured,
}: {
  keys: ProviderKeyRow[];
  encryptionConfigured: boolean;
}) {
  const [addOpen, setAddOpen] = React.useState(false);
  const configuredProviders = keys.map((k) => k.provider as ProviderId);

  if (!encryptionConfigured) {
    return (
      <Alert tone="warning" title="Encryption not configured">
        Set <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">ENCRYPTION_KEY</code> before any
        provider key can be stored. Every AI-assisted feature keeps working with its deterministic fallback until
        then.
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setAddOpen(true)}>
          <Plus aria-hidden />
          Add a provider
        </Button>
      </div>

      {keys.length === 0 ? (
        <EmptyState
          title="No AI provider configured"
          description="Every AI-assisted feature works without one — resume analysis, matching and drafts fall back to their deterministic version. Add a key to also get AI-written prose and explanations."
          action={<Button onClick={() => setAddOpen(true)}>Add a provider</Button>}
        />
      ) : (
        <ul className="space-y-3">
          {keys.map((k) => (
            <li key={k.provider}>
              <ProviderCard row={k} />
            </li>
          ))}
        </ul>
      )}

      <AddProviderDialog open={addOpen} onOpenChange={setAddOpen} configuredProviders={configuredProviders} />
    </div>
  );
}
