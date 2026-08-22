import * as React from 'react';
import { cn } from '@/lib/utils';

/** Wide tables scroll inside their own container; the page never scrolls sideways. */
export function TableWrap({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('w-full overflow-x-auto rounded-xl border border-line bg-surface cp-scroll', className)}
      {...props}
    />
  );
}

export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return <table className={cn('w-full caption-bottom text-sm', className)} {...props} />;
}

export function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('border-b border-line bg-surface-2', className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr className={cn('border-b border-line transition-colors hover:bg-surface-2/70', className)} {...props} />
  );
}

export function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-left text-xs font-semibold tracking-wide text-ink-3 uppercase whitespace-nowrap',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-4 py-3 align-top text-ink-2', className)} {...props} />;
}

export function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return <caption className={cn('mt-3 text-xs text-ink-4', className)} {...props} />;
}
