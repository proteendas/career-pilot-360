'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Password field with a show/hide affordance that keeps focus in the input. */
export const PasswordInput = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  function PasswordInput({ className, ...props }, ref) {
    const [visible, setVisible] = React.useState(false);
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('pr-10', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1.5 text-ink-4 transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)]"
          aria-label={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
    );
  },
);
