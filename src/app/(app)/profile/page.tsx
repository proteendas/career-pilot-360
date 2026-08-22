import type { Metadata } from 'next';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { ProfileEditor } from '@/components/profile/profile-editor';
import { requireUserPage } from '@/lib/auth';
import { loadProfile } from '@/lib/profile/service';

export const metadata: Metadata = { title: 'Profile' };

export default async function ProfilePage() {
  const user = await requireUserPage('/profile');
  const profile = await loadProfile(user.id);

  return (
    <PageShell>
      <PageHeader
        title="Profile"
        description="Everything the matching engine and packet generator are allowed to use. Nothing here is invented, and nothing is shared until you send it."
      />
      <ProfileEditor initialProfile={profile} />
    </PageShell>
  );
}
