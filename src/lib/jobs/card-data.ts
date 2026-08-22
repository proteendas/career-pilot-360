/**
 * Pure mapping from a stored job row to the shape `JobCard` renders.
 *
 * Split out from `components/jobs/job-card.tsx` because that file is a client
 * component — a server component (a page) cannot call a function exported from
 * a `'use client'` module, even a pure one.
 */
import { formatMoney } from '@/lib/utils';
import type { JobSourceType } from '@/lib/jobs/registry';
import type { JobCardData } from '@/components/jobs/job-card';

export function jobToCardData(
  job: {
    id: string;
    title: string;
    company: string;
    locationData: unknown;
    workMode: string | null;
    employmentType: string | null;
    salaryData: unknown;
    postedAt: Date | string | null;
    sourceType: JobSourceType;
    sourceName: string;
    sourcePolicyNote: string | null;
    saved: boolean;
    hidden: boolean;
    skills: unknown;
  },
  matchScore: number | null,
): JobCardData {
  const loc = (job.locationData ?? {}) as { raw?: string; city?: string; country?: string };
  const salary = (job.salaryData ?? {}) as { min?: number; max?: number; currency?: string };

  const salaryLabel =
    salary.min || salary.max
      ? `${salary.min ? formatMoney(salary.min, salary.currency ?? 'INR') : ''}${
          salary.max ? ` – ${formatMoney(salary.max, salary.currency ?? 'INR')}` : ''
        }`
      : null;

  return {
    id: job.id,
    title: job.title,
    company: job.company,
    locationLabel: loc.raw ?? loc.city ?? null,
    workMode: job.workMode,
    employmentType: job.employmentType,
    salaryLabel,
    postedAt: job.postedAt ? new Date(job.postedAt).toISOString() : null,
    sourceType: job.sourceType,
    sourceName: job.sourceName,
    sourcePolicyNote: job.sourcePolicyNote,
    saved: job.saved,
    hidden: job.hidden,
    matchScore,
    skills: (job.skills as string[]) ?? [],
  };
}
