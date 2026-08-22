'use client';

import { CircleHelp, Link2, PencilLine, Rss, ShieldCheck, Building2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { SOURCE_TYPE_LABELS, SOURCE_TYPE_TONES, type JobSourceType } from '@/lib/jobs/registry';

const ICONS: Record<JobSourceType, typeof ShieldCheck> = {
  authorized_api: ShieldCheck,
  public_board: Building2,
  public_feed: Rss,
  user_provided: Link2,
  manual: PencilLine,
  external_link: Link2,
};

/**
 * Every job carries this. The label states the provenance category and the
 * tooltip carries the source's own policy note verbatim, so a user can always
 * see where a listing came from and what was or was not fetched.
 */
export function SourceBadge({
  sourceType,
  sourceName,
  policyNote,
  fetchedAt,
}: {
  sourceType: JobSourceType;
  sourceName: string;
  policyNote?: string | null;
  fetchedAt?: string | Date | null;
}) {
  const Icon = ICONS[sourceType] ?? CircleHelp;
  const label = SOURCE_TYPE_LABELS[sourceType] ?? sourceName;

  const freshness = fetchedAt
    ? new Date(fetchedAt).toISOString().slice(0, 10)
    : null;

  return (
    <SimpleTooltip
      content={
        <span className="block space-y-1">
          <span className="block font-semibold">{sourceName}</span>
          {policyNote ? <span className="block">{policyNote}</span> : null}
          {freshness ? <span className="block text-ink-4">Data read {freshness}</span> : null}
        </span>
      }
    >
      <span className="inline-flex cursor-help">
        <Badge tone={SOURCE_TYPE_TONES[sourceType] ?? 'neutral'}>
          <Icon aria-hidden />
          {label}
        </Badge>
      </span>
    </SimpleTooltip>
  );
}
