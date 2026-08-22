import type { Metadata } from 'next';
import { OnboardingWizard } from '@/components/onboarding/wizard';
import { requireUserPage } from '@/lib/auth';
import { loadProfile } from '@/lib/profile/service';

export const metadata: Metadata = { title: 'Set up your profile' };

export default async function OnboardingPage() {
  const user = await requireUserPage('/onboarding');
  const profile = await loadProfile(user.id);

  // Prefill from the account record when the profile block is still blank.
  if (!profile.personal.fullName && user.name) profile.personal.fullName = user.name;
  if (!profile.personal.email) profile.personal.email = user.email;

  return <OnboardingWizard initialProfile={profile} />;
}
