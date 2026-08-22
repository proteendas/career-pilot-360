'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/field';
import { CheckboxField } from '@/components/ui/checkbox';
import { PasswordInput } from './password-input';
import { PasswordStrength } from './password-strength';
import { AuthCard, AuthFooterLink, FormBanner, LinkedInButton, OrDivider } from './auth-card';
import { signupAction, loginAction } from '@/server/actions/auth';
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/password';

const schema = z.object({
  name: z.string().trim().min(1, 'Tell us your name.').max(120),
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z.string().min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`).max(200),
  acceptedTerms: z.boolean().refine((v) => v, 'You must accept the Terms and Privacy Policy.'),
});

type Values = z.infer<typeof schema>;

export function SignupForm({ linkedinConfigured }: { linkedinConfigured: boolean }) {
  const router = useRouter();
  const [banner, setBanner] = React.useState<string>();
  const [done, setDone] = React.useState<string>();

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '', acceptedTerms: false },
  });

  const password = form.watch('password');
  const email = form.watch('email');
  const name = form.watch('name');

  async function onSubmit(values: Values) {
    setBanner(undefined);
    const res = await signupAction(values);
    if (!res.ok) {
      setBanner(res.error);
      if (res.field) {
        form.setError(res.field as keyof Values, { message: res.error });
      }
      return;
    }

    // Sign the new account straight in, then send them to onboarding.
    const login = await loginAction({ email: values.email, password: values.password });
    if (login.ok) {
      router.replace('/onboarding');
      router.refresh();
      return;
    }
    setDone(res.notice ?? 'Account created. You can sign in now.');
  }

  const { errors, isSubmitting } = form.formState;

  if (done) {
    return (
      <AuthCard title="Account created" description={done}>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-success-soft text-success">
            <CheckCircle2 className="size-5" aria-hidden />
          </span>
          <Button asChild className="w-full">
            <Link href="/login">Go to sign in</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      description="Start with a resume analysis. No AI key needed for the deterministic scoring."
      footer={<AuthFooterLink href="/login" prompt="Already have an account?" action="Sign in" />}
    >
      <FormBanner error={banner} />

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field label="Full name" htmlFor="name" required error={errors.name?.message}>
          <Input
            id="name"
            autoComplete="name"
            autoFocus
            placeholder="Priya Sharma"
            aria-invalid={Boolean(errors.name) || undefined}
            aria-describedby={describedBy('name', { error: errors.name })}
            {...form.register('name')}
          />
        </Field>

        <Field label="Work email" htmlFor="email" required error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={Boolean(errors.email) || undefined}
            aria-describedby={describedBy('email', { error: errors.email })}
            {...form.register('email')}
          />
        </Field>

        <div className="space-y-2">
          <Field
            label="Password"
            htmlFor="password"
            required
            error={errors.password?.message}
            help={`At least ${PASSWORD_MIN_LENGTH} characters. A passphrase beats a short complex string.`}
          >
            <PasswordInput
              id="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password) || undefined}
              aria-describedby={
                [describedBy('password', { help: true, error: errors.password }), 'password-strength']
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              {...form.register('password')}
            />
          </Field>
          <PasswordStrength id="password-strength" password={password} email={email} name={name} />
        </div>

        <CheckboxField
          id="acceptedTerms"
          checked={form.watch('acceptedTerms')}
          onCheckedChange={(v) => form.setValue('acceptedTerms', v, { shouldValidate: true })}
          label={
            <>
              I accept the{' '}
              <Link href="/terms" className="text-accent hover:underline" target="_blank">
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="text-accent hover:underline" target="_blank">
                Privacy Policy
              </Link>
            </>
          }
          description="You also acknowledge that AI-generated content must be reviewed by you before it is used in an application or sent to anyone."
        />
        {errors.acceptedTerms ? (
          <p role="alert" className="text-xs font-medium text-danger">
            {errors.acceptedTerms.message}
          </p>
        ) : null}

        <Button type="submit" className="w-full" loading={isSubmitting} loadingLabel="Creating account…">
          Create account
        </Button>
      </form>

      <OrDivider />
      <LinkedInButton configured={linkedinConfigured} />
    </AuthCard>
  );
}
