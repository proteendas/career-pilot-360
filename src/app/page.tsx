import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { Hero } from '@/components/marketing/hero';
import {
  CtaSection,
  ComplianceSection,
  FaqSection,
  FeaturesSection,
  WorkflowSection,
} from '@/components/marketing/sections';
import { getCurrentUser } from '@/lib/auth';

export default async function LandingPage() {
  const user = await getCurrentUser().catch(() => null);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader signedIn={Boolean(user)} />
      <main id="main" className="flex-1">
        <Hero />
        <WorkflowSection />
        <FeaturesSection />
        <ComplianceSection />
        <FaqSection />
        <CtaSection />
      </main>
      <SiteFooter />
    </div>
  );
}
