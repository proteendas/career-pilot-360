'use client';

import { Progress as ProgressPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export interface ProgressProps extends React.ComponentProps<typeof ProgressPrimitive.Root> {
  tone?: 'accent' | 'success' | 'warning' | 'danger';
  barClassName?: string;
}

const toneClass = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
} as const;

export function Progress({ className, value, tone = 'accent', barClassName, ...props }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <ProgressPrimitive.Root
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-line', className)}
      value={pct}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn('h-full rounded-full transition-[width] duration-500 ease-out', toneClass[tone], barClassName)}
        style={{ width: `${pct}%` }}
      />
    </ProgressPrimitive.Root>
  );
}
