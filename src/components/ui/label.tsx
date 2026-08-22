'use client';

import * as React from 'react';
import { Label as LabelPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.ComponentProps<typeof LabelPrimitive.Root> & { required?: boolean }
>(function Label({ className, required, children, ...props }, ref) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn('flex items-center gap-1 text-sm font-medium text-ink-2 select-none', className)}
      {...props}
    >
      {children}
      {required ? (
        <span className="text-danger" aria-hidden>
          *
        </span>
      ) : null}
    </LabelPrimitive.Root>
  );
});
