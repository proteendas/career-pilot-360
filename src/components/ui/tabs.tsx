'use client';

import { Tabs as TabsPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex items-center gap-1 overflow-x-auto rounded-lg border border-line bg-surface-2 p-1 cp-scroll',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-3',
        'transition-colors outline-none hover:text-ink',
        'focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)]',
        'data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-soft',
        '[&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('mt-4 outline-none', className)} {...props} />;
}
