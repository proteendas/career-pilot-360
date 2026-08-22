import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(function Input(
  { className, type = 'text', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink shadow-soft',
        'placeholder:text-ink-4 transition-shadow outline-none',
        'focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)]',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-[var(--cp-danger-soft)]',
        'file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-accent',
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'min-h-24 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm leading-relaxed text-ink shadow-soft',
        'placeholder:text-ink-4 transition-shadow outline-none resize-y',
        'focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)]',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
});
