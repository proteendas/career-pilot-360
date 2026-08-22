'use client';

import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer size-[18px] shrink-0 rounded-[5px] border border-line-strong bg-surface shadow-soft outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)]',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-white',
        'data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-white',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        {props.checked === 'indeterminate' ? <Minus className="size-3" /> : <Check className="size-3" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/** Checkbox + label + optional description, correctly associated. */
export function CheckboxField({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        disabled={disabled}
        aria-describedby={description ? `${id}-desc` : undefined}
        className="mt-0.5"
      />
      <div className="space-y-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm leading-snug font-medium text-ink-2 select-none">
          {label}
        </label>
        {description ? (
          <p id={`${id}-desc`} className="text-xs leading-relaxed text-ink-4">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
