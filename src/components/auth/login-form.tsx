'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/field';
import { PasswordInput } from './password-input';
import { AuthCard, AuthFooterLink, FormBanner, LinkedInButton, OrDivider } from './auth-card';
import { loginAction } from '@/server/actions/auth';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

type Values = z.infer<typeof schema>;

export function LoginForm({ next, linkedinConfigured }: { next?: string; linkedinConfigured: boolean }) {
  const router = useRouter();
  const [banner, setBanner] = React.useState<string>();

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: Values) {
    setBanner(undefined);
    const res = await loginAction({ ...values, next });
    if (!res.ok) {
      setBanner(res.error);
      return;
    }
    // A full navigation so the new session cookie is picked up by the server.
    router.replace(next && next.startsWith('/') ? next : '/dashboard');
    router.refresh();
  }

  const { errors, isSubmitting } = form.formState;

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to pick up your resume analysis, matches and applications."
      footer={<AuthFooterLink href="/signup" prompt="New to CareerPilot360?" action="Create an account" />}
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

        <Field
          label="Password"
          htmlFor="password"
          required
          error={errors.password?.message}
        >
          <PasswordInput
            id="password"
            autoComplete="current-password"
            aria-invalid={Boolean(errors.password) || undefined}
            aria-describedby={describedBy('password', { error: errors.password })}
            {...form.register('password')}
          />
        </Field>

        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-xs font-medium text-accent hover:underline">
            Forgot your password?
          </Link>
        </div>

        <Button type="submit" className="w-full" loading={isSubmitting} loadingLabel="Signing in…">
          Sign in
        </Button>
      </form>

      <OrDivider />
      <LinkedInButton next={next} configured={linkedinConfigured} />
    </AuthCard>
  );
}
