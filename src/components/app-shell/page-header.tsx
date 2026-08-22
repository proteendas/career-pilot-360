import * as React from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Rendered under the description, e.g. a source badge row or tab strip. */
  meta?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, meta, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-6 space-y-3', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight text-ink">{title}</h1>
          {description ? <p className="max-w-2xl text-sm leading-relaxed text-ink-3">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {meta}
    </div>
  );
}

/** Standard content container for app pages. */
export function PageShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8', className)}>{children}</div>;
}
