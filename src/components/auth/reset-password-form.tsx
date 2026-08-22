'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, describedBy } from '@/components/ui/field';
import { PasswordInput } from './password-input';
import { PasswordStrength } from './password-strength';
import { AuthCard, FormBanner } from './auth-card';
import { resetPasswordAction } from '@/server/actions/auth';
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/password';

const schema = z
  .object({
    password: z.string().min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`).max(200),
    confirmPassword: z.string().min(1, 'Confirm your new password.'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Both passwords must match.',
    path: ['confirmPassword'],
  });

type Values = z.infer<typeof schema>;

export function ResetPasswordForm({ token }: { token: string }) {
  const [banner, setBanner] = React.useState<string>();
  const [done, setDone] = React.useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  async function onSubmit(values: Values) {
    setBanner(undefined);
    const res = await resetPasswordAction({ ...values, token });
    if (!res.ok) {
      setBanner(res.error);
      return;
    }
    setDone(true);
  }

  if (!token) {
    return (
      <AuthCard title="This link is not valid" description="The reset link is missing its token.">
        <Button asChild className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title="Password updated" description="You can sign in with your new password now.">
        <div className="flex flex-col items-center gap-4 py-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-success-soft text-success">
            <CheckCircle2 className="size-5" aria-hidden />
          </span>
          <Button asChild className="w-full">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  const { errors, isSubmitting } = form.formState;
  const password = form.watch('password');

  return (
    <AuthCard title="Choose a new password" description="This link can be used once.">
      <FormBanner error={banner} />
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Field label="New password" htmlFor="password" required error={errors.password?.message}>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              autoFocus
              aria-invalid={Boolean(errors.password) || undefined}
              aria-describedby={describedBy('password', { error: errors.password })}
              {...form.register('password')}
            />
          </Field>
          <PasswordStrength id="password-strength" password={password} />
        </div>

        <Field label="Confirm new password" htmlFor="confirmPassword" required error={errors.confirmPassword?.message}>
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.confirmPassword) || undefined}
            aria-describedby={describedBy('confirmPassword', { error: errors.confirmPassword })}
            {...form.register('confirmPassword')}
          />
        </Field>

        <Button type="submit" className="w-full" loading={isSubmitting} loadingLabel="Updating…">
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}
