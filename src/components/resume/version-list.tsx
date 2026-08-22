'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Copy,
  Download,
  Ellipsis,
  FileText,
  Gauge,
  History,
  Pencil,
  Star,
  Trash2,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  deleteGeneratedPdfAction,
  deleteVersionAction,
  duplicateVersionAction,
  renameVersionAction,
  restoreVersionAction,
  setDefaultVersionAction,
} from '@/server/actions/resume';
import { formatDateTime, relativeTime, scoreTone } from '@/lib/utils';

export interface VersionRow {
  id: string;
  name: string;
  isDefault: boolean;
  isTailored: boolean;
  template: string;
  createdAt: string;
  updatedAt: string;
  parentVersionId: string | null;
  jobTitle: string | null;
  company: string | null;
  latestScore: number | null;
  pendingSuggestions: number;
  hasPdf: boolean;
}

export function VersionList({ versions }: { versions: VersionRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<VersionRow | null>(null);
  const [deletePdfTarget, setDeletePdfTarget] = React.useState<VersionRow | null>(null);
  const [renameTarget, setRenameTarget] = React.useState<VersionRow | null>(null);
  const [renameValue, setRenameValue] = React.useState('');

  async function run(id: string, fn: () => Promise<{ ok: boolean; error?: string; notice?: string }>) {
    setBusyId(id);
    const res = await fn();
    setBusyId(null);
    if (res.ok) {
      toast.success(res.notice ?? 'Done.');
      router.refresh();
    } else {
      toast.error(res.error ?? 'That did not work.');
    }
    return res;
  }

  if (versions.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="size-5" />}
        title="No resume versions yet"
        description="Upload a PDF or DOCX above. Every edit you make afterwards becomes a new version, so nothing is ever overwritten."
      />
    );
  }

  return (
    <>
      <ul className="space-y-3">
        {versions.map((version) => {
          const tone = version.latestScore === null ? 'neutral' : scoreTone(version.latestScore);
          return (
            <li key={version.id}>
              <Card className="transition-shadow hover:shadow-lift">
                <CardContent className="flex flex-wrap items-center gap-4 pt-5">
                  {/* score */}
                  <div
                    className={
                      version.latestScore === null
                        ? 'flex size-14 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-line-strong text-ink-4'
                        : `flex size-14 shrink-0 flex-col items-center justify-center rounded-xl border ${
                            tone === 'success'
                              ? 'border-success/30 bg-success-soft text-success'
                              : tone === 'warning'
                                ? 'border-warning/30 bg-warning-soft text-warning'
                                : 'border-danger/30 bg-danger-soft text-danger'
                          }`
                    }
                  >
                    {version.latestScore === null ? (
                      <Gauge className="size-4" aria-hidden />
                    ) : (
                      <>
                        <span className="text-lg leading-none font-semibold tabular-nums">{version.latestScore}</span>
                        <span className="text-[9px] tracking-wide uppercase">ATS</span>
                      </>
                    )}
                  </div>

                  {/* details */}
                  <div className="min-w-[12rem] flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/resume/${version.id}/analysis`}
                        className="text-[15px] font-semibold text-ink hover:text-accent"
                      >
                        {version.name}
                      </Link>
                      {version.isDefault ? <Badge tone="accent">Default</Badge> : null}
                      {version.isTailored ? (
                        <Badge tone="info">
                          Tailored{version.company ? ` · ${version.company}` : ''}
                        </Badge>
                      ) : null}
                      {version.parentVersionId ? <Badge tone="outline">Derived</Badge> : null}
                    </div>
                    <p className="text-xs text-ink-4">
                      Created {formatDateTime(version.createdAt)}
                      {version.updatedAt !== version.createdAt ? ` · edited ${relativeTime(version.updatedAt)}` : ''}
                      {` · ${version.template} template`}
                    </p>
                    {version.pendingSuggestions > 0 ? (
                      <Link
                        href={`/resume/${version.id}/suggestions`}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
                      >
                        <Wand2 className="size-3" aria-hidden />
                        {version.pendingSuggestions} suggestion{version.pendingSuggestions === 1 ? '' : 's'} to review
                      </Link>
                    ) : null}
                  </div>

                  {/* actions */}
                  <div className="flex shrink-0 items-center gap-2">
                    <Button asChild variant="secondary" size="sm">
                      <Link href={`/resume/${version.id}/analysis`}>Analysis</Link>
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                      <a href={`/api/resume/${version.id}/pdf`}>
                        <Download aria-hidden />
                        PDF
                      </a>
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                      <a href={`/api/resume/${version.id}/docx`}>
                        <Download aria-hidden />
                        DOCX
                      </a>
                    </Button>
                    {version.hasPdf ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete generated PDF for ${version.name}`}
                        onClick={() => setDeletePdfTarget(version)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    ) : null}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${version.name}`}>
                          <Ellipsis aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem asChild>
                          <Link href={`/resume/${version.id}`}>
                            <Pencil aria-hidden /> Edit content
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/resume/${version.id}/versions`}>
                            <History aria-hidden /> Version history
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => {
                            setRenameTarget(version);
                            setRenameValue(version.name);
                          }}
                        >
                          <Pencil aria-hidden /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={busyId === version.id}
                          onSelect={() => void run(version.id, () => duplicateVersionAction(version.id))}
                        >
                          <Copy aria-hidden /> Duplicate
                        </DropdownMenuItem>
                        {!version.isDefault ? (
                          <DropdownMenuItem
                            disabled={busyId === version.id}
                            onSelect={() => void run(version.id, () => setDefaultVersionAction(version.id))}
                          >
                            <Star aria-hidden /> Set as default
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          disabled={busyId === version.id}
                          onSelect={() => void run(version.id, () => restoreVersionAction(version.id))}
                        >
                          <History aria-hidden /> Restore as new version
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onSelect={() => setDeleteTarget(version)}>
                          <Trash2 aria-hidden /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      {/* rename */}
      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Rename version</DialogTitle>
          </DialogHeader>
          <Field label="Version name" htmlFor="rename-input">
            <Input
              id="rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={80}
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!renameTarget) return;
                const res = await run(renameTarget.id, () => renameVersionAction(renameTarget.id, renameValue));
                if (res.ok) setRenameTarget(null);
              }}
              disabled={!renameValue.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        tone="danger"
        title={`Delete “${deleteTarget?.name ?? ''}”?`}
        description="This cannot be undone."
        details={
          <ul className="space-y-1.5">
            <li>· This version and its generated PDFs are removed.</li>
            <li>· Suggestions attached to it are removed.</li>
            <li>
              · Your <strong className="font-semibold text-ink">original uploaded file is kept</strong> — you can create
              a new version from it.
            </li>
            {deleteTarget?.isDefault ? <li>· Another version will become your default.</li> : null}
          </ul>
        }
        confirmLabel="Delete version"
        loading={busyId === deleteTarget?.id}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const res = await run(deleteTarget.id, () => deleteVersionAction(deleteTarget.id));
          if (res.ok) setDeleteTarget(null);
        }}
      />

      {/* delete generated PDF */}
      <ConfirmDialog
        open={Boolean(deletePdfTarget)}
        onOpenChange={(open) => !open && setDeletePdfTarget(null)}
        tone="danger"
        title={`Delete the generated PDF for “${deletePdfTarget?.name ?? ''}”?`}
        description="The version's content, edits and history are untouched — you can export a new PDF from it any time."
        confirmLabel="Delete PDF"
        loading={busyId === deletePdfTarget?.id}
        onConfirm={async () => {
          if (!deletePdfTarget) return;
          const res = await run(deletePdfTarget.id, () => deleteGeneratedPdfAction(deletePdfTarget.id));
          if (res.ok) setDeletePdfTarget(null);
        }}
      />
    </>
  );
}
