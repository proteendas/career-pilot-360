'use client';

import * as React from 'react';
import { cn, scoreTone } from '@/lib/utils';
import { useHydrated } from '@/hooks/use-hydrated';

export interface ScoreRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  sublabel?: string;
  className?: string;
  animate?: boolean;
}

const toneVar = {
  success: 'var(--cp-success)',
  warning: 'var(--cp-warning)',
  danger: 'var(--cp-danger)',
} as const;

/**
 * Circular score gauge. The numeric value is always rendered as text too, so
 * the information is never colour-only.
 */
export function ScoreRing({
  score,
  size = 112,
  strokeWidth = 9,
  label,
  sublabel,
  className,
  animate = true,
}: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const tone = scoreTone(clamped);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // The arc starts empty on the server render and fills once hydrated, so the
  // CSS transition below has something to animate from. No effect needed.
  const hydrated = useHydrated();
  const shown = animate && !hydrated ? 0 : clamped;

  return (
    <div className={cn('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--cp-line)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={toneVar[tone]}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (shown / 100) * circumference}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0">
        <span className="text-2xl leading-none font-semibold tabular-nums text-ink">{clamped}</span>
        {label ? <span className="mt-0.5 text-[10px] font-medium tracking-wide text-ink-4 uppercase">{label}</span> : null}
        {sublabel ? <span className="text-[10px] text-ink-4">{sublabel}</span> : null}
      </div>
      <span className="sr-only">{`${clamped} out of 100`}</span>
    </div>
  );
}

/** Horizontal score bar for section-level scores. */
export function ScoreBar({
  score,
  label,
  weight,
  className,
}: {
  score: number;
  label: string;
  weight?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const tone = scoreTone(clamped);
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate font-medium text-ink-2">{label}</span>
        <span className="flex shrink-0 items-baseline gap-1.5">
          <span className="font-semibold tabular-nums text-ink">{clamped}</span>
          {weight !== undefined ? <span className="text-[11px] text-ink-4">×{weight}</span> : null}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line" role="img" aria-label={`${label}: ${clamped} out of 100`}>
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${clamped}%`, backgroundColor: toneVar[tone] }}
        />
      </div>
    </div>
  );
}
