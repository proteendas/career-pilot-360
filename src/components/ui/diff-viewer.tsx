'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { diffWords, type DiffToken } from '@/lib/diff';

export interface DiffViewerProps {
  before: string;
  after: string;
  /** 'inline' shows one merged stream; 'split' shows before/after side by side. */
  mode?: 'inline' | 'split';
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
}

function Token({ token }: { token: DiffToken }) {
  if (token.type === 'equal') return <span>{token.value}</span>;
  if (token.type === 'insert') {
    return (
      <ins className="rounded bg-success-soft px-0.5 text-success no-underline decoration-clone">{token.value}</ins>
    );
  }
  return (
    <del className="rounded bg-danger-soft px-0.5 text-danger decoration-clone line-through">{token.value}</del>
  );
}

/** Word-level before/after diff. Rendered as plain text - never as HTML. */
export function DiffViewer({
  before,
  after,
  mode = 'inline',
  beforeLabel = 'Current',
  afterLabel = 'Suggested',
  className,
}: DiffViewerProps) {
  const tokens = React.useMemo(() => diffWords(before, after), [before, after]);

  if (mode === 'split') {
    return (
      <div className={cn('grid gap-3 sm:grid-cols-2', className)}>
        <figure className="space-y-1.5">
          <figcaption className="text-[11px] font-semibold tracking-wide text-ink-4 uppercase">
            {beforeLabel}
          </figcaption>
          <div className="cp-prose-plain rounded-lg border border-line bg-surface-2 p-3 text-[13px] text-ink-2">
            {tokens
              .filter((t) => t.type !== 'insert')
              .map((t, i) => (
                <Token key={i} token={t} />
              ))}
          </div>
        </figure>
        <figure className="space-y-1.5">
          <figcaption className="text-[11px] font-semibold tracking-wide text-ink-4 uppercase">
            {afterLabel}
          </figcaption>
          <div className="cp-prose-plain rounded-lg border border-accent/30 bg-accent-soft/30 p-3 text-[13px] text-ink-2">
            {tokens
              .filter((t) => t.type !== 'delete')
              .map((t, i) => (
                <Token key={i} token={t} />
              ))}
          </div>
        </figure>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'cp-prose-plain rounded-lg border border-line bg-surface-2 p-3 text-[13px] text-ink-2',
        className,
      )}
    >
      {tokens.map((t, i) => (
        <Token key={i} token={t} />
      ))}
    </div>
  );
}
