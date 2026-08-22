'use client';

import * as React from 'react';
import { Select as SelectPrimitive } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface px-3',
        'text-sm text-ink shadow-soft outline-none transition-shadow',
        'data-[placeholder]:text-ink-4',
        'focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)]',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    >
      <span className="truncate text-left">{children}</span>
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-ink-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        className={cn(
          'z-50 max-h-72 min-w-[8rem] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop cp-scroll',
          position === 'popper' && 'w-[var(--radix-select-trigger-width)]',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 pl-8 text-sm text-ink-2 outline-none',
        'data-[highlighted]:bg-surface-2 data-[highlighted]:text-ink',
        'data-[state=checked]:font-medium data-[state=checked]:text-ink',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5 text-accent" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn('px-2 py-1.5 text-xs font-semibold tracking-wide text-ink-4 uppercase', className)}
      {...props}
    />
  );
}

/** Plain-object convenience wrapper for simple option lists. */
export function SimpleSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  id,
  className,
  disabled,
  'aria-describedby': describedBy,
}: {
  value: string | undefined;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  'aria-describedby'?: string | undefined;
}) {
  return (
    <Select value={value ?? ''} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} className={className} aria-describedby={describedBy}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
