'use client';

import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ' +
    'transition-[background-color,color,box-shadow,transform] duration-150 active:translate-y-px ' +
    'disabled:pointer-events-none disabled:opacity-50 outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-paper ' +
    "[&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white shadow-soft hover:bg-accent-hover',
        secondary: 'bg-surface text-ink border border-line-strong shadow-soft hover:bg-surface-2',
        ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        outline: 'border border-line-strong text-ink hover:bg-surface-2',
        danger: 'bg-danger text-white hover:opacity-90',
        link: 'text-accent underline-offset-4 hover:underline',
        subtle: 'bg-accent-soft text-accent hover:brightness-95',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-10 px-4',
        lg: 'h-11 px-6 text-[15px]',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  /** Announced to screen readers while `loading` is true. */
  loadingLabel?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild, loading, loadingLabel = 'Working…', children, disabled, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          <span className="sr-only">{loadingLabel}</span>
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  );
});

export { buttonVariants };
