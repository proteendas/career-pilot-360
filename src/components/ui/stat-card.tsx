import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  /** Short qualifier under the value, e.g. "of 100" or "this week". */
  unit?: string;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  href?: string;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  /** Rendered in place of the value when there is genuinely no data yet. */
  emptyLabel?: string;
  className?: string;
}

const toneRing = {
  neutral: 'text-ink-3 bg-surface-2',
  accent: 'text-accent bg-accent-soft',
  success: 'text-success bg-success-soft',
  warning: 'text-warning bg-warning-soft',
  danger: 'text-danger bg-danger-soft',
  info: 'text-info bg-info-soft',
} as const;

/**
 * Dashboard metric tile. When `value` is null/undefined it renders an honest
 * em-dash with `emptyLabel` rather than a fabricated zero-state number.
 */
export function StatCard({
  label,
  value,
  unit,
  hint,
  icon,
  href,
  tone = 'neutral',
  emptyLabel,
  className,
}: StatCardProps) {
  const empty = value === null || value === undefined;

  const body = (
    <div
      className={cn(
        'group relative h-full rounded-xl border border-line bg-surface p-4 shadow-soft transition-shadow',
        href && 'hover:shadow-lift',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold tracking-wide text-ink-4 uppercase">{label}</p>
        {icon ? (
          <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', toneRing[tone])}>
            {icon}
          </span>
        ) : null}
      </div>

      <p className="mt-2.5 flex items-baseline gap-1.5">
        {empty ? (
          <span className="text-2xl font-semibold text-ink-4">—</span>
        ) : (
          <span className="text-2xl leading-none font-semibold tabular-nums text-ink">{value}</span>
        )}
        {unit && !empty ? <span className="text-xs text-ink-4">{unit}</span> : null}
      </p>

      {empty && emptyLabel ? (
        <p className="mt-1.5 text-xs leading-relaxed text-ink-4">{emptyLabel}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{hint}</p>
      ) : null}

      {href ? (
        <ArrowUpRight
          className="absolute top-4 right-4 size-3.5 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      ) : null}
    </div>
  );

  if (!href) return body;
  return (
    <Link
      href={href}
      className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)]"
    >
      {body}
    </Link>
  );
}
