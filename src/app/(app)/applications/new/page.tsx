import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { PreparePacketView } from '@/components/applications/prepare-packet';
import { requireUserPage } from '@/lib/auth';
import { NotFoundError } from '@/lib/db/tenant';
import { getJob } from '@/lib/jobs/service';
import { getDefaultVersion } from '@/lib/resume/service';
import { aiAvailability } from '@/lib/ai/client';

export const metadata: Metadata = { title: 'Prepare application' };

async function load(userId: string, jobId: string) {
  try {
    return await Promise.all([
      getJob(userId, jobId),
      getDefaultVersion(userId),
      aiAvailability(userId, 'cover_letter'),
    ] as const);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

export default async function NewApplicationPage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string }>;
}) {
  const { jobId } = await searchParams;
  const user = await requireUserPage('/applications/new');
  if (!jobId) notFound();

  const loaded = await load(user.id, jobId);
  if (!loaded) notFound();
  const [job, defaultVersion, ai] = loaded;

  return (
    <PageShell>
      <PageHeader title="Prepare application" />
      <PreparePacketView
        job={{
          id: job.id,
          title: job.title,
          company: job.company,
          sourceType: job.sourceType,
          sourceName: job.sourceName,
          sourcePolicyNote: job.sourcePolicyNote,
        }}
        aiConfigured={ai.available}
        {...(ai.reason ? { aiReason: ai.reason } : {})}
        hasResume={Boolean(defaultVersion)}
      />
    </PageShell>
  );
}
