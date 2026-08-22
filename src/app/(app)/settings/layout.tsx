import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { SettingsTabs } from '@/components/settings/settings-tabs';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageShell>
      <PageHeader title="Settings" description="AI providers, security and privacy, and connected integrations." />
      <SettingsTabs />
      {children}
    </PageShell>
  );
}
