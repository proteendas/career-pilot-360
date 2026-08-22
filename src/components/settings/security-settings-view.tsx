'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Download, ShieldAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { SimpleSelect } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { deleteAccountAction, exportDataAction, updateRetentionAction } from '@/server/actions/account';

const RETENTION_OPTIONS = [
  { value: 'forever', label: 'Keep until I delete my account' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '1 year' },
];

export function SecuritySettingsView({ retentionDays }: { retentionDays: number | null }) {
  const router = useRouter();
  const [retention, setRetention] = React.useState(retentionDays === null ? 'forever' : String(retentionDays));
  const [savingRetention, setSavingRetention] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  async function saveRetention(value: string) {
    setRetention(value);
    setSavingRetention(true);
    const res = await updateRetentionAction({ retentionDays: value === 'forever' ? null : Number(value) });
    setSavingRetention(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save.');
      return;
    }
    toast.success(res.notice ?? 'Saved.');
    router.refresh();
  }

  async function exportData() {
    setExporting(true);
    const res = await exportDataAction();
    setExporting(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not export your data.');
      return;
    }
    const blob = new Blob([res.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `careerpilot360-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('Export downloaded.');
  }

  async function confirmDelete() {
    setDeleting(true);
    const res = await deleteAccountAction({ confirmation: 'DELETE' });
    setDeleting(false);
    if (res && !res.ok) {
      toast.error(res.error ?? 'Could not delete your account.');
    }
    // A successful deletion redirects the whole page — nothing else to do here.
  }

  return (
    <div className="max-w-xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">Data retention</CardTitle>
          <CardDescription>
            How long CareerPilot360 keeps your data before a scheduled cleanup task purges it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SimpleSelect value={retention} onValueChange={saveRetention} options={RETENTION_OPTIONS} disabled={savingRetention} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">Export your data</CardTitle>
          <CardDescription>A single JSON file with everything CareerPilot360 has stored about you.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" onClick={() => void exportData()} loading={exporting}>
            <Download aria-hidden />
            Download export
          </Button>
        </CardContent>
      </Card>

      <Card className="border-danger/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[15px] text-danger">
            <ShieldAlert className="size-4" aria-hidden />
            Delete account
          </CardTitle>
          <CardDescription>
            Permanently deletes your profile, resumes, applications, outreach history and AI provider keys. This
            cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 aria-hidden />
            Delete my account
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete your account?"
        description="This permanently removes your account and everything in it."
        details={
          <Alert tone="danger">
            This cannot be undone. Everything — your resumes, applications, outreach history, and AI provider keys —
            is permanently deleted.
          </Alert>
        }
        confirmLabel="Delete my account"
        tone="danger"
        requireTyped="DELETE"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
