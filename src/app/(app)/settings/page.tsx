import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { requireUserPage } from '@/lib/auth';
import { getDb, isDatabaseConfigured, oauthAccounts, users } from '@/lib/db';
import { Alert } from '@/components/ui/alert';
import { GeneralSettingsView } from '@/components/settings/general-settings-view';

export const metadata: Metadata = { title: 'Settings' };

export default async function GeneralSettingsPage() {
  const user = await requireUserPage('/settings');

  if (!isDatabaseConfigured()) {
    return (
      <Alert tone="warning" title="Database not configured">
        Set DATABASE_URL and run the migrations.
      </Alert>
    );
  }

  const db = getDb();
  const [row] = await db
    .select({
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      hasPassword: users.passwordHash,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const linked = await db
    .select({ provider: oauthAccounts.provider })
    .from(oauthAccounts)
    .where(eq(oauthAccounts.userId, user.id));

  return (
    <GeneralSettingsView
      account={{
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
        createdAt: row?.createdAt ? row.createdAt.toISOString() : null,
        lastLoginAt: row?.lastLoginAt ? row.lastLoginAt.toISOString() : null,
        hasPassword: Boolean(row?.hasPassword),
        linkedProviders: linked.map((l) => l.provider),
      }}
    />
  );
}
