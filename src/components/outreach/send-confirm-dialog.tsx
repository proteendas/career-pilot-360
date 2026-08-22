'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Mail, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/alert';
import { CheckboxField } from '@/components/ui/checkbox';
import { getSendPreviewAction, sendOutreachAction, type SendPreviewPayload } from '@/server/actions/outreach';

export function SendConfirmDialog({
  open,
  onOpenChange,
  draftId,
  kind,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftId: string;
  kind: 'initial' | 'follow_up';
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{kind === 'follow_up' ? 'Send this follow-up?' : 'Send this email?'}</DialogTitle>
          <DialogDescription>
            Review the exact recipient and content below. Nothing is sent until you confirm.
          </DialogDescription>
        </DialogHeader>

        {/*
          Mounted only while open, re-keyed per draft+kind, so a fresh fetch
          and fresh local state happen every time this is opened — no reset
          effect needed for the close case.
        */}
        {open ? (
          <SendPreviewBody onOpenChange={onOpenChange} draftId={draftId} kind={kind} key={`${draftId}:${kind}`} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SendPreviewBody({
  onOpenChange,
  draftId,
  kind,
}: {
  onOpenChange: (open: boolean) => void;
  draftId: string;
  kind: 'initial' | 'follow_up';
}) {
  const router = useRouter();
  const [preview, setPreview] = React.useState<SendPreviewPayload | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [sending, setSending] = React.useState(false);
  const [overrideDuplicate, setOverrideDuplicate] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    getSendPreviewAction(draftId, kind).then((res) => {
      if (!active) return;
      setLoading(false);
      if (!res.ok || !res.data) {
        setLoadError(res.error ?? 'Could not load a preview for this draft.');
        return;
      }
      setPreview(res.data);
    });
    return () => {
      active = false;
    };
  }, [draftId, kind]);

  const hasDuplicateWarning = preview?.warnings.some((w) => /already emailed/i.test(w)) ?? false;
  const isSuppressedWarning = preview?.warnings.some((w) => /stop-contact list/i.test(w)) ?? false;
  const atLimit = preview ? preview.sentToday >= preview.dailyLimit : false;

  async function confirmSend() {
    setSending(true);
    const res = await sendOutreachAction({
      draftId,
      kind,
      confirmed: true,
      ...(overrideDuplicate ? { overrideDuplicate: true } : {}),
    });
    setSending(false);
    if (!res.ok) {
      toast.error(res.error ?? 'The email could not be sent.');
      return;
    }
    toast.success(res.notice ?? 'Sent.');
    onOpenChange(false);
    router.refresh();
  }

  return (
    <>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-ink-3">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Preparing preview…
        </div>
      ) : loadError ? (
        <Alert tone="danger">{loadError}</Alert>
      ) : preview ? (
        <div className="space-y-3.5">
            {!preview.realSendingConfigured ? (
              <Alert tone="warning" icon={<AlertTriangle className="size-4" />}>
                <p className="text-[13px] leading-relaxed">
                  No real email provider is configured. This will be logged to the server console instead of
                  actually delivered — useful for testing, not for a real outreach campaign.
                </p>
              </Alert>
            ) : null}

            <div className="rounded-lg border border-line bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-2">
              <p>
                <span className="font-medium text-ink">To:</span> {preview.recipient}
              </p>
              <p>
                <span className="font-medium text-ink">From:</span> {preview.senderDisplay}
              </p>
              <p>
                <span className="font-medium text-ink">Subject:</span> {preview.subject}
              </p>
              {preview.attachmentName ? (
                <p>
                  <span className="font-medium text-ink">Attachment:</span> {preview.attachmentName}
                </p>
              ) : null}
              <p className="mt-2 whitespace-pre-wrap border-t border-line pt-2 text-ink-2">{preview.body}</p>
            </div>

            <p className="text-xs text-ink-4">
              {preview.sentToday} of {preview.dailyLimit} outreach emails sent today.
            </p>

            {preview.warnings.map((w, i) => (
              <Alert key={i} tone={isSuppressedWarning ? 'danger' : 'warning'} icon={<ShieldAlert className="size-4" />}>
                <p className="text-[13px] leading-relaxed">{w}</p>
              </Alert>
            ))}

            {hasDuplicateWarning && !isSuppressedWarning ? (
              <CheckboxField
                id="override-duplicate"
                label="Send anyway"
                description="I understand I already emailed this address recently."
                checked={overrideDuplicate}
                onCheckedChange={setOverrideDuplicate}
              />
            ) : null}

            {atLimit ? <Alert tone="danger">You’ve reached today’s outreach limit — try again tomorrow.</Alert> : null}
        </div>
      ) : null}

      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={sending}>
          Cancel
        </Button>
        <Button
          onClick={() => void confirmSend()}
          loading={sending}
          disabled={
            !preview ||
            Boolean(loadError) ||
            isSuppressedWarning ||
            atLimit ||
            (hasDuplicateWarning && !overrideDuplicate)
          }
        >
          <Mail aria-hidden />
          Confirm and send
        </Button>
      </DialogFooter>
    </>
  );
}
