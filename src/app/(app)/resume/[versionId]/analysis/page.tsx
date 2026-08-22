import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { and, eq, sql } from 'drizzle-orm';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { AnalysisView } from '@/components/resume/analysis-view';
import { requireUserPage } from '@/lib/auth';
import { getDb, resumeSuggestions } from '@/lib/db';
import { NotFoundError } from '@/lib/db/tenant';
import { getLatestAnalysis, getVersion } from '@/lib/resume/service';
import { aiAvailability } from '@/lib/ai/client';

export const metadata: Metadata = { title: 'Resume analysis' };

/**
 * Data loading is kept out of the render path: JSX built inside a try/catch
 * would not have its render errors caught there anyway, and `notFound()` needs
 * to be called before any element is constructed.
 */
async function load(userId: string, versionId: string) {
  try {
    return await Promise.all([
      getVersion(userId, versionId),
      getLatestAnalysis(userId, versionId),
      getDb()
        .select({ count: sql<number>`count(*)` })
        .from(resumeSuggestions)
        .where(
          and(
            eq(resumeSuggestions.userId, userId),
            eq(resumeSuggestions.resumeVersionId, versionId),
            eq(resumeSuggestions.status, 'pending'),
          ),
        ),
      aiAvailability(userId, 'resume_suggestions'),
    ] as const);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

export default async function AnalysisPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const user = await requireUserPage(`/resume/${versionId}/analysis`);

  const loaded = await load(user.id, versionId);
  if (!loaded) notFound();
  const [version, analysis, pending, ai] = loaded;

  return (
    <PageShell>
      <PageHeader
        title="ATS analysis"
        description="A transparent, reproducible read on the things applicant tracking systems and human screeners demonstrably struggle with."
      />
      <AnalysisView
        versionId={versionId}
        versionName={version.name}
        report={analysis?.report ?? null}
        analysedAt={analysis?.createdAt.toISOString() ?? null}
        pendingSuggestions={Number(pending[0]?.count ?? 0)}
        aiConfigured={ai.available}
        {...(ai.reason ? { aiReason: ai.reason } : {})}
      />
    </PageShell>
  );
}
