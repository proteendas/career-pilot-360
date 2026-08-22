'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/field';
import { AuthCard, AuthFooterLink, FormBanner } from './auth-card';
import { requestPasswordResetAction } from '@/server/actions/auth';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
});
type Values = z.infer<typeof schema>;

export function ForgotPasswordForm() {
  const [sent, setSent] = React.useState<string>();
  const [banner, setBanner] = React.useState<string>();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  async function onSubmit(values: Values) {
    setBanner(undefined);
    const res = await requestPasswordResetAction(values);
    if (!res.ok) {
      setBanner(res.error);
      return;
    }
    setSent(res.notice);
  }

  if (sent) {
    return (
      <AuthCard title="Check your inbox" description={sent}>
        <div className="flex flex-col items-center gap-3 py-3 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <MailCheck className="size-5" aria-hidden />
          </span>
          <p className="text-xs leading-relaxed text-ink-4">
            Running locally with the console email driver? The link is printed in your terminal.
          </p>
        </div>
      </AuthCard>
    );
  }

  const { errors, isSubmitting } = form.formState;

  return (
    <AuthCard
      title="Reset your password"
      description="We will email you a single-use link that expires in 60 minutes."
      footer={<AuthFooterLink href="/login" prompt="Remembered it?" action="Back to sign in" />}
    >
      <FormBanner error={banner} />
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email" required error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            aria-invalid={Boolean(errors.email) || undefined}
            aria-describedby={describedBy('email', { error: errors.email })}
            {...form.register('email')}
          />
        </Field>
        <Button type="submit" className="w-full" loading={isSubmitting} loadingLabel="Sending…">
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}
