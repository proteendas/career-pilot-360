'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { addProviderKeyAction } from '@/server/actions/settings';
import { PROVIDERS, type ProviderId } from '@/lib/ai/registry';

export function AddProviderDialog({
  open,
  onOpenChange,
  configuredProviders,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Providers the user already has a key for — offered again as "replace". */
  configuredProviders: ProviderId[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add an AI provider</DialogTitle>
          <DialogDescription>
            Your key is encrypted before it is stored and is only ever decrypted on the server to make a request on
            your behalf. It is never shown again after you save it.
          </DialogDescription>
        </DialogHeader>
        {open ? <AddProviderForm onOpenChange={onOpenChange} configuredProviders={configuredProviders} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AddProviderForm({
  onOpenChange,
  configuredProviders,
}: {
  onOpenChange: (open: boolean) => void;
  configuredProviders: ProviderId[];
}) {
  const router = useRouter();
  const [providerId, setProviderId] = React.useState<ProviderId>(PROVIDERS[0]!.id);
  const [apiKey, setApiKey] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState('');
  const [defaultModel, setDefaultModel] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const provider = PROVIDERS.find((p) => p.id === providerId)!;
  const alreadyConfigured = configuredProviders.includes(providerId);

  function selectProvider(id: string) {
    setProviderId(id as ProviderId);
    const next = PROVIDERS.find((p) => p.id === id)!;
    setBaseUrl(next.defaultBaseUrl);
    setDefaultModel(next.defaultModel);
  }

  async function save() {
    if (!apiKey.trim()) {
      toast.error('Enter an API key.');
      return;
    }
    if (provider.requiresBaseUrl && !baseUrl.trim()) {
      toast.error(`${provider.name} requires a base URL.`);
      return;
    }
    setSaving(true);
    const res = await addProviderKeyAction({
      provider: providerId,
      apiKey,
      baseUrl: baseUrl || undefined,
      defaultModel: defaultModel || undefined,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save this key.');
      return;
    }
    toast.success(res.notice ?? 'Saved.');
    onOpenChange(false);
    router.refresh();
  }

  return (
    <>
      <div className="space-y-3.5">
        <Field label="Provider" htmlFor="provider-select" required>
          <SimpleSelect
            id="provider-select"
            value={providerId}
            onValueChange={selectProvider}
            options={PROVIDERS.map((p) => ({ value: p.id, label: p.name }))}
          />
          <p className="mt-1.5 text-xs leading-relaxed text-ink-4">
            {provider.description}
            {provider.freeTierToday ? (
              <>
                {' '}
                <Badge tone="success" className="ml-1 align-middle">
                  Free tier today
                </Badge>
              </>
            ) : null}
          </p>
          {alreadyConfigured ? (
            <p className="mt-1 text-xs font-medium text-warning">
              You already have a key for {provider.name} — saving will replace it.
            </p>
          ) : null}
        </Field>

        <Field
          label="API key"
          htmlFor="provider-api-key"
          required
          help={
            provider.consoleUrl ? (
              <>
                {provider.keyFormatHint} — get one at{' '}
                <a href={provider.consoleUrl} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
                  {new URL(provider.consoleUrl).hostname}
                </a>
                .
              </>
            ) : (
              provider.keyFormatHint
            )
          }
        >
          <Input
            id="provider-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            maxLength={2000}
          />
        </Field>

        {provider.requiresBaseUrl || provider.id === 'openai-compatible' || provider.id === 'azure-openai' ? (
          <Field label="Base URL" htmlFor="provider-base-url" required>
            <Input
              id="provider-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              maxLength={2048}
              placeholder="https://…"
            />
          </Field>
        ) : null}

        {provider.models.length > 0 ? (
          <Field label="Default model" htmlFor="provider-model">
            <SimpleSelect
              id="provider-model"
              value={defaultModel}
              onValueChange={setDefaultModel}
              options={provider.models.map((m) => ({ value: m.id, label: m.label }))}
            />
          </Field>
        ) : (
          <Field label="Default model" htmlFor="provider-model-text" help="The exact model or deployment name your endpoint expects.">
            <Input id="provider-model-text" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} maxLength={200} />
          </Field>
        )}
      </div>

      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={saving}>
          Save key
        </Button>
      </DialogFooter>
    </>
  );
}
