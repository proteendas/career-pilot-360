import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/login-form';
import { getCurrentUser } from '@/lib/auth';
import { featureFlags } from '@/lib/env';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next } = await searchParams;
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect(next?.startsWith('/') ? next : '/dashboard');

  return <LoginForm next={next} linkedinConfigured={featureFlags().linkedinOAuth} />;
}
