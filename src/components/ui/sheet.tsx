'use client';

import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  className,
  children,
  side = 'left',
  title,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: 'left' | 'right';
  /** Required for accessibility - Radix needs a title even when visually hidden. */
  title: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-y-0 z-50 flex w-[min(20rem,85vw)] flex-col border-line bg-surface shadow-pop outline-none',
          side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Close className="absolute top-3.5 right-3.5 rounded-md p-1 text-ink-4 hover:bg-surface-2 hover:text-ink">
          <X className="size-4" />
          <span className="sr-only">Close menu</span>
        </DialogPrimitive.Close>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
