'use client';

import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export const RadioGroup = ({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) => (
  <RadioGroupPrimitive.Root className={cn('grid gap-2', className)} {...props} />
);

export function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'size-[18px] shrink-0 rounded-full border border-line-strong bg-surface shadow-soft outline-none',
        'focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)]',
        'data-[state=checked]:border-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex size-full items-center justify-center">
        <span className="size-2 rounded-full bg-accent" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

/** Card-style radio options, used for work mode / template pickers. */
export function RadioCards({
  value,
  onValueChange,
  options,
  name,
  columns = 2,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string; description?: string }[];
  name: string;
  columns?: 1 | 2 | 3;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={onValueChange}
      className={cn(
        columns === 1 ? 'grid-cols-1' : columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3',
      )}
    >
      {options.map((o) => {
        const id = `${name}-${o.value}`;
        return (
          <label
            key={o.value}
            htmlFor={id}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors',
              value === o.value
                ? 'border-accent bg-accent-soft/50'
                : 'border-line-strong bg-surface hover:bg-surface-2',
            )}
          >
            <RadioGroupItem id={id} value={o.value} className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium text-ink">{o.label}</span>
              {o.description ? <span className="block text-xs text-ink-4">{o.description}</span> : null}
            </span>
          </label>
        );
      })}
    </RadioGroup>
  );
}
