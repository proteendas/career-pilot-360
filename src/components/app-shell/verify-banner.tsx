'use client';

import * as React from 'react';
import { MailWarning } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { resendVerificationAction } from '@/server/actions/account';

/**
 * Shown until the address is verified. Verification is not a hard gate on
 * signing in, but it IS required before any outward-facing send, so the banner
 * explains the actual consequence rather than nagging.
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function resend() {
    setSending(true);
    const res = await resendVerificationAction();
    setSending(false);
    if (res.ok) {
      setSent(true);
      toast.success(res.notice ?? 'Verification email sent.');
    } else {
      toast.error(res.error ?? 'Could not send the verification email.');
    }
  }

  return (
    <Alert tone="warning" icon={<MailWarning className="size-4" />} className="mb-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-relaxed">
          <strong className="font-semibold text-ink">Verify {email}</strong> to enable recruiter outreach. Everything
          else — resume analysis, matching and packet preparation — works now.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void resend()}
          loading={sending}
          disabled={sent}
          className="shrink-0"
        >
          {sent ? 'Email sent' : 'Resend link'}
        </Button>
      </div>
    </Alert>
  );
}
