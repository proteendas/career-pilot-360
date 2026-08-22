'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Star, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SwitchField } from '@/components/ui/switch';
import { SimpleSelect } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  deleteProviderKeyAction,
  setDefaultProviderAction,
  setProviderEnabledAction,
  testProviderKeyAction,
  updateProviderSettingsAction,
} from '@/server/actions/settings';
import { findProvider } from '@/lib/ai/registry';
import { relativeTime } from '@/lib/utils';

export interface ProviderKeyRow {
  provider: string;
  maskedKey: string;
  baseUrl: string | null;
  defaultModel: string | null;
  enabled: boolean;
  isDefault: boolean;
  monthlyTokenLimit: number | null;
  validationStatus: string;
  lastValidatedAt: string | null;
}

export function ProviderCard({ row }: { row: ProviderKeyRow }) {
  const router = useRouter();
  const def = findProvider(row.provider);
  const [testing, setTesting] = React.useState(false);
  const [savingModel, setSavingModel] = React.useState(false);
  const [savingLimit, setSavingLimit] = React.useState(false);
  const [busyToggle, setBusyToggle] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [limitInput, setLimitInput] = React.useState(row.monthlyTokenLimit?.toString() ?? '');

  async function test() {
    setTesting(true);
    const res = await testProviderKeyAction(row.provider);
    setTesting(false);
    if (!res.ok) {
      toast.error(res.error ?? 'The connection test failed.');
      return;
    }
    toast.success(res.notice ?? 'Connection succeeded.');
    router.refresh();
  }

  async function toggleEnabled(enabled: boolean) {
    setBusyToggle(true);
    const res = await setProviderEnabledAction(row.provider, enabled);
    setBusyToggle(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not update.');
      return;
    }
    router.refresh();
  }

  async function makeDefault() {
    const res = await setDefaultProviderAction(row.provider);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not set as default.');
      return;
    }
    toast.success('Default provider updated.');
    router.refresh();
  }

  async function changeModel(model: string) {
    setSavingModel(true);
    const res = await updateProviderSettingsAction({ provider: row.provider, defaultModel: model });
    setSavingModel(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save.');
      return;
    }
    router.refresh();
  }

  async function saveLimit() {
    const value = limitInput.trim() ? Number(limitInput) : null;
    if (value !== null && (!Number.isInteger(value) || value <= 0)) {
      toast.error('Enter a positive whole number, or leave it blank for no limit.');
      return;
    }
    setSavingLimit(true);
    const res = await updateProviderSettingsAction({ provider: row.provider, monthlyTokenLimit: value });
    setSavingLimit(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save.');
      return;
    }
    toast.success('Saved.');
    router.refresh();
  }

  async function confirmDelete() {
    setDeleting(true);
    const res = await deleteProviderKeyAction(row.provider);
    setDeleting(false);
    setDeleteOpen(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not remove this key.');
      return;
    }
    toast.success('Removed.');
    router.refresh();
  }

  const validationBadge =
    row.validationStatus === 'valid' ? (
      <Badge tone="success">
        <CheckCircle2 aria-hidden />
        Working
      </Badge>
    ) : row.validationStatus === 'invalid' ? (
      <Badge tone="danger">
        <XCircle aria-hidden />
        Failing
      </Badge>
    ) : (
      <Badge tone="neutral">Untested</Badge>
    );

  return (
    <Card>
      <CardContent className="space-y-3.5 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[15px] font-semibold text-ink">{def?.name ?? row.provider}</p>
              {row.isDefault ? <Badge tone="accent"><Star aria-hidden />Default</Badge> : null}
              {validationBadge}
            </div>
            <p className="text-xs text-ink-4">
              Key {row.maskedKey}
              {row.lastValidatedAt ? ` · tested ${relativeTime(row.lastValidatedAt)}` : ''}
            </p>
          </div>
          <SwitchField
            id={`enabled-${row.provider}`}
            label="Enabled"
            checked={row.enabled}
            onCheckedChange={toggleEnabled}
            disabled={busyToggle}
          />
        </div>

        {def && def.models.length > 0 ? (
          <div className="max-w-xs">
            <label htmlFor={`model-${row.provider}`} className="mb-1.5 block text-xs font-medium text-ink-2">
              Default model
            </label>
            <SimpleSelect
              id={`model-${row.provider}`}
              value={row.defaultModel ?? def.defaultModel}
              onValueChange={changeModel}
              options={def.models.map((m) => ({ value: m.id, label: m.label }))}
              disabled={savingModel}
            />
          </div>
        ) : null}

        <div className="flex max-w-xs flex-wrap items-end gap-2">
          <div className="flex-1">
            <label htmlFor={`limit-${row.provider}`} className="mb-1.5 block text-xs font-medium text-ink-2">
              Monthly token limit
            </label>
            <Input
              id={`limit-${row.provider}`}
              type="number"
              min={1}
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              placeholder="No limit"
            />
          </div>
          <Button size="sm" variant="secondary" onClick={() => void saveLimit()} loading={savingLimit}>
            Save
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button size="sm" variant="secondary" onClick={() => void test()} loading={testing}>
            {testing ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Test connection
          </Button>
          {!row.isDefault ? (
            <Button size="sm" variant="ghost" onClick={() => void makeDefault()}>
              Make default
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setDeleteOpen(true)}>
            Remove
          </Button>
        </div>
      </CardContent>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Remove your ${def?.name ?? row.provider} key?`}
        description="Tasks that relied on this provider will fall back to your next configured one, or to the deterministic analysis if none is left."
        confirmLabel="Remove"
        tone="danger"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </Card>
  );
}
