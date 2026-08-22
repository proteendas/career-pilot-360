'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Banknote,
  Briefcase,
  Building2,
  Calendar,
  Eye,
  EyeOff,
  MapPin,
  Star,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScoreRing } from '@/components/ui/score-ring';
import { SourceBadge } from './source-badge';
import { relativeTime } from '@/lib/utils';
import type { JobSourceType } from '@/lib/jobs/registry';
import { setJobStateAction } from '@/server/actions/jobs';
import { toast } from 'sonner';

export interface JobCardData {
  id: string;
  title: string;
  company: string;
  locationLabel: string | null;
  workMode: string | null;
  employmentType: string | null;
  salaryLabel: string | null;
  postedAt: string | null;
  sourceType: JobSourceType;
  sourceName: string;
  sourcePolicyNote: string | null;
  saved: boolean;
  hidden: boolean;
  matchScore: number | null;
  skills: string[];
}

const WORK_MODE_LABEL: Record<string, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  unknown: '',
};

export function JobCard({ job, onChanged }: { job: JobCardData; onChanged?: () => void }) {
  const [saved, setSaved] = React.useState(job.saved);
  const [pending, setPending] = React.useState(false);

  async function toggleSave() {
    setPending(true);
    const res = await setJobStateAction(job.id, saved ? 'none' : 'saved');
    setPending(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not update.');
      return;
    }
    setSaved(!saved);
    onChanged?.();
  }

  async function hide() {
    setPending(true);
    const res = await setJobStateAction(job.id, 'hidden');
    setPending(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not update.');
      return;
    }
    toast.success('Hidden from your list.');
    onChanged?.();
  }

  return (
    <Card className="transition-shadow hover:shadow-lift">
      <CardContent className="flex flex-wrap gap-4 pt-5">
        {job.matchScore !== null ? (
          <ScoreRing score={job.matchScore} size={64} strokeWidth={6} label="Match" animate={false} />
        ) : (
          <div className="flex size-16 shrink-0 flex-col items-center justify-center rounded-full border border-dashed border-line-strong text-ink-4">
            <span className="text-[10px] tracking-wide uppercase">No score</span>
          </div>
        )}

        <div className="min-w-[14rem] flex-1 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <Link href={`/jobs/${job.id}`} className="text-[15px] font-semibold text-ink hover:text-accent">
                {job.title}
              </Link>
              <p className="flex items-center gap-1.5 text-sm text-ink-3">
                <Building2 className="size-3.5" aria-hidden />
                {job.company}
              </p>
            </div>
            <SourceBadge sourceType={job.sourceType} sourceName={job.sourceName} policyNote={job.sourcePolicyNote} />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-3">
            {job.locationLabel ? (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-3.5" aria-hidden />
                {job.locationLabel}
                {job.workMode && WORK_MODE_LABEL[job.workMode] ? ` · ${WORK_MODE_LABEL[job.workMode]}` : ''}
              </span>
            ) : null}
            {job.salaryLabel ? (
              <span className="flex items-center gap-1.5">
                <Banknote className="size-3.5" aria-hidden />
                {job.salaryLabel}
              </span>
            ) : null}
            {job.employmentType ? (
              <span className="flex items-center gap-1.5">
                <Briefcase className="size-3.5" aria-hidden />
                {job.employmentType.replace('_', ' ')}
              </span>
            ) : null}
            {job.postedAt ? (
              <span className="flex items-center gap-1.5">
                <Calendar className="size-3.5" aria-hidden />
                {relativeTime(job.postedAt)}
              </span>
            ) : null}
          </div>

          {job.skills.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {job.skills.slice(0, 8).map((s) => (
                <Badge key={s} tone="outline">
                  {s}
                </Badge>
              ))}
              {job.skills.length > 8 ? <Badge tone="outline">+{job.skills.length - 8}</Badge> : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button asChild size="sm">
            <Link href={`/jobs/${job.id}`}>View</Link>
          </Button>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={saved ? 'Remove from saved' : 'Save job'}
              onClick={() => void toggleSave()}
              disabled={pending}
            >
              <Star className={saved ? 'fill-accent text-accent' : ''} aria-hidden />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Hide job" onClick={() => void hide()} disabled={pending}>
              {job.hidden ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
