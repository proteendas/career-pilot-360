'use client';

import Link from 'next/link';
import { CheckCircle2, LogOut, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { resendVerificationAction } from '@/server/actions/account';
import { logoutAction } from '@/server/actions/auth';
import { formatDate, relativeTime } from '@/lib/utils';

export interface GeneralAccountData {
  email: string;
  name: string | null;
  emailVerified: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
  hasPassword: boolean;
  linkedProviders: string[];
}

export function GeneralSettingsView({ account }: { account: GeneralAccountData }) {
  async function resend() {
    const res = await resendVerificationAction();
    if (!res.ok) {
      toast.error(res.error ?? 'Could not send the email.');
      return;
    }
    toast.success(res.notice ?? 'Sent.');
  }

  return (
    <div className="max-w-xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">{account.name || 'No name set'}</p>
              <p className="text-sm text-ink-3">{account.email}</p>
            </div>
            {account.emailVerified ? (
              <Badge tone="success">
                <CheckCircle2 aria-hidden />
                Verified
              </Badge>
            ) : (
              <Badge tone="warning">
                <XCircle aria-hidden />
                Unverified
              </Badge>
            )}
          </div>

          {!account.emailVerified ? (
            <Button size="sm" variant="secondary" onClick={() => void resend()}>
              Resend verification email
            </Button>
          ) : null}

          <div className="grid grid-cols-2 gap-3 border-t border-line pt-3 text-[13px] text-ink-3">
            <p>Member since {account.createdAt ? formatDate(account.createdAt) : '—'}</p>
            <p>Last sign-in {account.lastLoginAt ? relativeTime(account.lastLoginAt) : '—'}</p>
          </div>

          <p className="text-xs text-ink-4">
            Edit your personal, professional and job-search details on the{' '}
            <Link href="/profile" className="text-accent hover:underline">
              Profile
            </Link>{' '}
            page.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">Sign-in methods</CardTitle>
          <CardDescription>How you can sign in to this account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-2">Email and password</span>
            <Badge tone={account.hasPassword ? 'success' : 'neutral'}>{account.hasPassword ? 'Set' : 'Not set'}</Badge>
          </div>
          {account.linkedProviders.map((p) => (
            <div key={p} className="flex items-center justify-between text-sm">
              <span className="text-ink-2 capitalize">{p}</span>
              <Badge tone="success">Connected</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Button variant="secondary" onClick={() => void logoutAction()}>
        <LogOut aria-hidden />
        Sign out
      </Button>
    </div>
  );
}
