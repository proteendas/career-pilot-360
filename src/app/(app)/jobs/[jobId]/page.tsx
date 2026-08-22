import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader, PageShell } from '@/components/app-shell/page-header';
import { MatchDetailView, type JobDetailData } from '@/components/jobs/match-detail';
import { requireUserPage } from '@/lib/auth';
import { NotFoundError } from '@/lib/db/tenant';
import { getJob } from '@/lib/jobs/service';
import { getMatch } from '@/lib/jobs/match-service';
import { getDefaultVersion } from '@/lib/resume/service';
import { aiAvailability } from '@/lib/ai/client';
import { formatMoney } from '@/lib/utils';

export const metadata: Metadata = { title: 'Job details' };

/** Loaded before any JSX exists, so `notFound()` can run first. */
async function load(userId: string, jobId: string) {
  try {
    return await Promise.all([
      getJob(userId, jobId),
      getMatch(userId, jobId),
      getDefaultVersion(userId),
      aiAvailability(userId, 'job_matching'),
    ] as const);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

export default async function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const user = await requireUserPage(`/jobs/${jobId}`);

  const loaded = await load(user.id, jobId);
  if (!loaded) notFound();
  const [job, match, defaultVersion, ai] = loaded;

  const loc = job.locationData as { raw?: string; city?: string } | null;
  const salary = job.salaryData as { min?: number; max?: number; currency?: string } | null;

  const detail: JobDetailData = {
    id: job.id,
    title: job.title,
    company: job.company,
    locationLabel: loc?.raw ?? loc?.city ?? null,
    workMode: job.workMode,
    employmentType: job.employmentType,
    salaryLabel:
      salary?.min || salary?.max
        ? `${salary.min ? formatMoney(salary.min, salary.currency ?? 'INR') : ''}${
            salary.max ? ` – ${formatMoney(salary.max, salary.currency ?? 'INR')}` : ''
          }`
        : null,
    description: job.description,
    responsibilities: (job.responsibilities as string[]) ?? [],
    requirements: (job.requirements as string[]) ?? [],
    preferredQualifications: (job.preferredQualifications as string[]) ?? [],
    applyUrl: job.applyUrl,
    canonicalUrl: job.canonicalUrl,
    postedAt: job.postedAt ? job.postedAt.toISOString() : null,
    sourceType: job.sourceType,
    sourceName: job.sourceName,
    sourcePolicyNote: job.sourcePolicyNote,
  };

  return (
    <PageShell>
      <PageHeader title={job.title} description={job.company} />
      <MatchDetailView
        job={detail}
        match={match}
        aiConfigured={ai.available}
        {...(ai.reason ? { aiReason: ai.reason } : {})}
        hasResume={Boolean(defaultVersion)}
      />
    </PageShell>
  );
}
