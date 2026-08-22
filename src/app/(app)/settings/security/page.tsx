import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { requireUserPage } from '@/lib/auth';
import { getDb, isDatabaseConfigured, users } from '@/lib/db';
import { Alert } from '@/components/ui/alert';
import { SecuritySettingsView } from '@/components/settings/security-settings-view';

export const metadata: Metadata = { title: 'Security & privacy' };

export default async function SecuritySettingsPage() {
  const user = await requireUserPage('/settings/security');

  if (!isDatabaseConfigured()) {
    return (
      <Alert tone="warning" title="Database not configured">
        Set DATABASE_URL and run the migrations.
      </Alert>
    );
  }

  const [row] = await getDb()
    .select({ retentionDays: users.retentionDays })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  return <SecuritySettingsView retentionDays={row?.retentionDays ?? null} />;
}
