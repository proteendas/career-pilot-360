import * as React from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
  tone?: 'default' | 'setup';
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  tone = 'default',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border px-6 py-14 text-center',
        tone === 'setup' ? 'border-warning/40 bg-warning-soft/40' : 'border-dashed border-line-strong bg-surface-2/60',
        className,
      )}
    >
      {tone === 'default' ? <div className="cp-grid-bg pointer-events-none absolute inset-0 opacity-50" /> : null}
      {icon ? (
        <div
          className={cn(
            'relative flex size-11 items-center justify-center rounded-xl border',
            tone === 'setup'
              ? 'border-warning/30 bg-surface text-warning'
              : 'border-line bg-surface text-ink-3',
          )}
        >
          {icon}
        </div>
      ) : null}
      <div className="relative max-w-md space-y-1.5">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {description ? <p className="text-sm leading-relaxed text-ink-3">{description}</p> : null}
      </div>
      {action || secondaryAction ? (
        <div className="relative mt-1 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
