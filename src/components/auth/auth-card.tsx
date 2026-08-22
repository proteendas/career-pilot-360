'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { LinkedInIcon } from '@/components/brand/icons';
import { Alert } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { loginWithLinkedInAction } from '@/server/actions/auth';
import { cn } from '@/lib/utils';

export function AuthCard({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-2xl border border-line bg-surface p-6 shadow-lift sm:p-7', className)}>
      <div className="mb-6 space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="text-sm leading-relaxed text-ink-3">{description}</p> : null}
      </div>
      {children}
      {footer ? <div className="mt-6 border-t border-line pt-5 text-center text-sm text-ink-3">{footer}</div> : null}
    </div>
  );
}

/** Inline form-level error / success banner. */
export function FormBanner({ error, notice }: { error?: string | undefined; notice?: string | undefined }) {
  if (!error && !notice) return null;
  return (
    <Alert tone={error ? 'danger' : 'success'} className="mb-4">
      {error ?? notice}
    </Alert>
  );
}

/**
 * LinkedIn sign-in. Rendered only when the integration is configured, so the
 * user never clicks a button that cannot work.
 */
export function LinkedInButton({ next, configured }: { next?: string; configured: boolean }) {
  const [pending, setPending] = React.useState(false);

  if (!configured) {
    return (
      <div className="rounded-lg border border-dashed border-line-strong bg-surface-2 px-3 py-2.5 text-center">
        <p className="text-xs leading-relaxed text-ink-4">
          LinkedIn sign-in is not configured on this deployment. Add{' '}
          <code className="font-mono text-[11px] text-ink-3">LINKEDIN_CLIENT_ID</code> and{' '}
          <code className="font-mono text-[11px] text-ink-3">LINKEDIN_CLIENT_SECRET</code> to enable it.
        </p>
      </div>
    );
  }

  return (
    <form
      action={async () => {
        setPending(true);
        await loginWithLinkedInAction(next);
      }}
    >
      <Button type="submit" variant="secondary" className="w-full" loading={pending}>
        <LinkedInIcon className="size-4" />
        Continue with LinkedIn
      </Button>
    </form>
  );
}

export function OrDivider({ label = 'or' }: { label?: string }) {
  return (
    <div className="relative my-5 flex items-center gap-3">
      <Separator className="flex-1" />
      <span className="text-[11px] font-medium tracking-wide text-ink-4 uppercase">{label}</span>
      <Separator className="flex-1" />
    </div>
  );
}

export function AuthFooterLink({ href, prompt, action }: { href: string; prompt: string; action: string }) {
  return (
    <>
      {prompt}{' '}
      <Link href={href} className="font-medium text-accent hover:underline">
        {action}
      </Link>
    </>
  );
}
