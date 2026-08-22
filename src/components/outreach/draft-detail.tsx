'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Info, Mail, Pencil, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Input, Textarea } from '@/components/ui/input';
import { CopyButton } from '@/components/ui/copy-button';
import { OutreachStatusBadge } from './outreach-status-badge';
import { SendConfirmDialog } from './send-confirm-dialog';
import { updateDraftAction } from '@/server/actions/outreach';

export interface DraftDetailData {
  draftId: string;
  status: string;
  subject: string;
  body: string;
  followUpBody: string;
  linkedinMessage: string;
  suggestedTiming: string;
  contact: {
    id: string;
    name: string;
    title: string | null;
    company: string | null;
    email: string | null;
  };
  jobLabel: string | null;
}

export function DraftDetailView({ data }: { data: DraftDetailData }) {
  const router = useRouter();
  const [subject, setSubject] = React.useState(data.subject);
  const [body, setBody] = React.useState(data.body);
  const [followUpBody, setFollowUpBody] = React.useState(data.followUpBody);
  const [saving, setSaving] = React.useState(false);
  const [sendOpen, setSendOpen] = React.useState(false);
  const [followUpOpen, setFollowUpOpen] = React.useState(false);

  const hasEmail = Boolean(data.contact.email);
  const canSendInitial = hasEmail && (data.status === 'draft' || data.status === 'approved' || data.status === 'failed');
  const canSendFollowUp = hasEmail && data.status === 'sent' && followUpBody.trim().length > 0;

  async function save() {
    setSaving(true);
    const res = await updateDraftAction({ draftId: data.draftId, subject, body, followUpBody });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save your edits.');
      return;
    }
    toast.success('Saved.');
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold text-ink">{data.contact.name}</h1>
                <OutreachStatusBadge status={data.status} />
              </div>
              <p className="text-ink-3">
                {[data.contact.title, data.contact.company].filter(Boolean).join(' · ') || '—'}
                {data.jobLabel ? ` · ${data.jobLabel}` : ''}
              </p>
              <p className="text-xs text-ink-4">{data.contact.email ?? 'No email on file for this contact'}</p>
            </div>
          </div>

          <Alert tone="neutral" className="mt-4" icon={<Info className="size-4" />}>
            <p className="text-[13px] leading-relaxed">
              Nothing here is sent until you review it and confirm — the confirmation dialog shows the exact
              recipient and content one more time.
            </p>
          </Alert>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Email</CardTitle>
              <CardDescription>Edit freely — this is entirely yours to change before sending.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label htmlFor="draft-subject" className="mb-1.5 block text-xs font-medium text-ink-2">
                  Subject
                </label>
                <Input id="draft-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} />
              </div>
              <div>
                <label htmlFor="draft-body" className="mb-1.5 block text-xs font-medium text-ink-2">
                  Body
                </label>
                <Textarea id="draft-body" value={body} onChange={(e) => setBody(e.target.value)} rows={10} maxLength={1500} />
                <div className="mt-2 flex justify-end">
                  <CopyButton value={body} label="Copy" />
                </div>
              </div>
              <div>
                <label htmlFor="draft-followup" className="mb-1.5 block text-xs font-medium text-ink-2">
                  Follow-up (sent only after you confirm the initial email went out)
                </label>
                <Textarea
                  id="draft-followup"
                  value={followUpBody}
                  onChange={(e) => setFollowUpBody(e.target.value)}
                  rows={4}
                  maxLength={800}
                />
                <div className="mt-2 flex justify-end">
                  <CopyButton value={followUpBody} label="Copy" />
                </div>
              </div>
              <Button onClick={() => void save()} loading={saving} size="sm" variant="secondary">
                <Pencil aria-hidden />
                Save edits
              </Button>
            </CardContent>
          </Card>

          {data.linkedinMessage ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-[15px]">LinkedIn message (draft-and-copy only)</CardTitle>
                <CardDescription>This is never sent by this app — copy it and send it yourself on LinkedIn.</CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea value={data.linkedinMessage} readOnly rows={3} maxLength={600} />
                <div className="mt-2 flex justify-end">
                  <CopyButton value={data.linkedinMessage} label="Copy" />
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-4">
          <Card className="lg:sticky lg:top-20">
            <CardContent className="space-y-3 pt-5">
              {!hasEmail ? (
                <Alert tone="warning">Add an email address to this contact before sending.</Alert>
              ) : null}

              {data.suggestedTiming ? (
                <p className="text-xs text-ink-4">Suggested timing: {data.suggestedTiming}</p>
              ) : null}

              {canSendInitial ? (
                <Button className="w-full" onClick={() => setSendOpen(true)}>
                  <Send aria-hidden />
                  {data.status === 'failed' ? 'Retry send' : 'Send email'}
                </Button>
              ) : null}

              {canSendFollowUp ? (
                <Button className="w-full" variant="secondary" onClick={() => setFollowUpOpen(true)}>
                  <Mail aria-hidden />
                  Send follow-up
                </Button>
              ) : null}

              {data.status === 'sent' && !canSendFollowUp ? (
                <Alert tone="success">
                  <p className="text-[13px]">Sent. Add a follow-up message above to enable a follow-up send.</p>
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </div>

      <SendConfirmDialog open={sendOpen} onOpenChange={setSendOpen} draftId={data.draftId} kind="initial" />
      <SendConfirmDialog open={followUpOpen} onOpenChange={setFollowUpOpen} draftId={data.draftId} kind="follow_up" />
    </div>
  );
}
