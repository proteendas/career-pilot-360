import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SignupForm } from '@/components/auth/signup-form';
import { getCurrentUser } from '@/lib/auth';
import { featureFlags } from '@/lib/env';

export const metadata: Metadata = { title: 'Create your account' };

export default async function SignupPage() {
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect('/dashboard');

  return <SignupForm linkedinConfigured={featureFlags().linkedinOAuth} />;
}
