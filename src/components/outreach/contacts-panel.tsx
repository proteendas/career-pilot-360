'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Pencil, Sparkles, Trash2, UserPlus, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CheckboxField } from '@/components/ui/checkbox';
import { ContactFormDialog, type ContactFormValues } from './contact-form-dialog';
import { deleteContactAction, generateDraftAction, suppressEmailAction } from '@/server/actions/outreach';
import { CONTACT_SOURCE_LABELS, type ContactSource } from '@/lib/outreach/contact-types';
import { relativeTime } from '@/lib/utils';

export interface ContactRow {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  email: string | null;
  linkedinUrl: string | null;
  source: ContactSource;
  provenance: string;
  notes: string | null;
  createdAt: string;
  suppressed: boolean;
}

export function ContactsPanel({ contacts, aiAvailable }: { contacts: ContactRow[]; aiAvailable: boolean }) {
  const router = useRouter();
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ContactFormValues | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = React.useState<ContactRow | null>(null);
  const [draftingId, setDraftingId] = React.useState<string | null>(null);
  const [useAiForDraft, setUseAiForDraft] = React.useState(aiAvailable);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  function openCreate() {
    setEditing(undefined);
    setFormOpen(true);
  }

  function openEdit(c: ContactRow) {
    setEditing({
      contactId: c.id,
      name: c.name,
      title: c.title ?? '',
      company: c.company ?? '',
      email: c.email ?? '',
      linkedinUrl: c.linkedinUrl ?? '',
      source: c.source,
      provenance: c.provenance,
      notes: c.notes ?? '',
    });
    setFormOpen(true);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    const res = await deleteContactAction(deleteTarget.id);
    setBusyId(null);
    setDeleteTarget(null);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not remove this contact.');
      return;
    }
    toast.success('Contact removed.');
    router.refresh();
  }

  async function stopContact(c: ContactRow) {
    if (!c.email) return;
    setBusyId(c.id);
    const res = await suppressEmailAction(c.email);
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not add to the stop-contact list.');
      return;
    }
    toast.success(res.notice ?? 'Added to your stop-contact list.');
    router.refresh();
  }

  async function draftEmail(c: ContactRow) {
    setDraftingId(c.id);
    const res = await generateDraftAction(c.id, { useAi: useAiForDraft && aiAvailable });
    setDraftingId(null);
    if (!res.ok || !res.data) {
      toast.error(res.error ?? 'Could not prepare a draft.');
      return;
    }
    toast.success(res.notice ?? 'Draft prepared.');
    router.push(`/outreach/${res.data.draftId}`);
  }

  if (contacts.length === 0) {
    return (
      <>
        <EmptyState
          icon={<UserPlus className="size-5" />}
          title="No contacts yet"
          description="Add a recruiter or hiring contact you have a legitimate, non-scraped way to reach — from a reply, a public company page, or an authorised API."
          action={<Button onClick={openCreate}>Add a contact</Button>}
        />
        <ContactFormDialog open={formOpen} onOpenChange={setFormOpen} initial={editing} />
      </>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <CheckboxField
          id="use-ai-draft"
          label={
            <span className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-accent" aria-hidden />
              Draft with AI assistance
            </span>
          }
          description={aiAvailable ? undefined : 'No AI provider configured — drafts will use templates.'}
          checked={useAiForDraft}
          onCheckedChange={setUseAiForDraft}
          disabled={!aiAvailable}
        />
        <Button size="sm" onClick={openCreate}>
          <UserPlus aria-hidden />
          Add contact
        </Button>
      </div>

      <ul className="space-y-3">
        {contacts.map((c) => (
          <li key={c.id}>
            <Card>
              <CardContent className="flex flex-wrap items-start gap-4 pt-5">
                <div className="min-w-[14rem] flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[15px] font-semibold text-ink">{c.name}</p>
                    {c.suppressed ? <Badge tone="danger">Stop-contact</Badge> : null}
                  </div>
                  <p className="text-sm text-ink-3">
                    {[c.title, c.company].filter(Boolean).join(' · ') || '—'}
                  </p>
                  <p className="text-xs text-ink-4">
                    {c.email ?? 'No email on file'} · {CONTACT_SOURCE_LABELS[c.source]} · added {relativeTime(c.createdAt)}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => void draftEmail(c)}
                    loading={draftingId === c.id}
                    disabled={!c.email || c.suppressed}
                  >
                    <Wand2 aria-hidden />
                    Draft email
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
                    <Pencil aria-hidden />
                    Edit
                  </Button>
                  {c.email && !c.suppressed ? (
                    <Button size="sm" variant="ghost" onClick={() => void stopContact(c)} disabled={busyId === c.id}>
                      <Ban aria-hidden />
                      Stop contact
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(c)}>
                    <Trash2 aria-hidden />
                    Remove
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <ContactFormDialog open={formOpen} onOpenChange={setFormOpen} initial={editing} />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Remove this contact?"
        description={deleteTarget ? `${deleteTarget.name} will be removed. Drafts already sent to them are kept for your records.` : ''}
        confirmLabel="Remove"
        tone="danger"
        loading={Boolean(deleteTarget && busyId === deleteTarget.id)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
