import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';
import { AuthCard } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { verifyEmailAction } from '@/server/actions/auth';

export const metadata: Metadata = { title: 'Verify your email' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <AuthCard
        title="Verification link needed"
        description="Open the link from your verification email to confirm your address."
      >
        <Button asChild variant="secondary" className="w-full">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </AuthCard>
    );
  }

  const result = await verifyEmailAction(token);

  return (
    <AuthCard
      title={result.ok ? 'Email verified' : 'Could not verify'}
      description={result.ok ? result.notice : result.error}
    >
      <div className="flex flex-col items-center gap-4 py-3">
        <span
          className={
            result.ok
              ? 'flex size-11 items-center justify-center rounded-xl bg-success-soft text-success'
              : 'flex size-11 items-center justify-center rounded-xl bg-danger-soft text-danger'
          }
        >
          {result.ok ? <CheckCircle2 className="size-5" aria-hidden /> : <XCircle className="size-5" aria-hidden />}
        </span>
        <Button asChild className="w-full">
          <Link href={result.ok ? '/dashboard' : '/login'}>{result.ok ? 'Continue' : 'Back to sign in'}</Link>
        </Button>
      </div>
    </AuthCard>
  );
}
