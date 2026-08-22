import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { requireUserPage } from '@/lib/auth';
import { getDb, isDatabaseConfigured, oauthAccounts } from '@/lib/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';

export const metadata: Metadata = { title: 'Integrations' };

export default async function IntegrationsSettingsPage() {
  const user = await requireUserPage('/settings/integrations');

  if (!isDatabaseConfigured()) {
    return (
      <Alert tone="warning" title="Database not configured">
        Set DATABASE_URL and run the migrations.
      </Alert>
    );
  }

  const linked = await getDb()
    .select({ provider: oauthAccounts.provider })
    .from(oauthAccounts)
    .where(eq(oauthAccounts.userId, user.id));
  const linkedInConnected = linked.some((l) => l.provider === 'linkedin');

  return (
    <div className="max-w-xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">LinkedIn sign-in</CardTitle>
          <CardDescription>
            Official OpenID Connect sign-in only. CareerPilot360 never automates LinkedIn, never stores a LinkedIn
            access token, and never acts on your account there.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Badge tone={linkedInConnected ? 'success' : 'neutral'}>
            {linkedInConnected ? 'Connected' : 'Not connected'}
          </Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">Email sending for outreach</CardTitle>
          <CardDescription>Not yet available.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert tone="neutral">
            <p className="text-[13px] leading-relaxed">
              Outreach emails are currently sent through the server-configured provider (Resend, or logged to the
              console if none is set) rather than your own inbox. Sending on your behalf via a connected Gmail or
              Microsoft account — so replies land in your real inbox — is the intended future path, but that OAuth
              integration has not been built yet.
            </p>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
