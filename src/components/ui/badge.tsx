import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-line-strong bg-surface-2 text-ink-2',
        accent: 'border-transparent bg-accent-soft text-accent',
        success: 'border-transparent bg-success-soft text-success',
        warning: 'border-transparent bg-warning-soft text-warning',
        danger: 'border-transparent bg-danger-soft text-danger',
        info: 'border-transparent bg-info-soft text-info',
        outline: 'border-line-strong bg-transparent text-ink-3',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps extends React.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { badgeVariants };
