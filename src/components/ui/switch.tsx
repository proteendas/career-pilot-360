'use client';

import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full border border-transparent',
        'bg-line-strong transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)] focus-visible:ring-offset-1',
        'data-[state=checked]:bg-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-[18px] translate-x-0.5 rounded-full bg-white shadow-soft transition-transform',
          'data-[state=checked]:translate-x-[18px]',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export function SwitchField({
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
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="space-y-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-ink-2 select-none">
          {label}
        </label>
        {description ? (
          <p id={`${id}-desc`} className="text-xs leading-relaxed text-ink-4">
            {description}
          </p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={description ? `${id}-desc` : undefined}
      />
    </div>
  );
}
