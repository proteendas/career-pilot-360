'use client';

import { DropdownMenu as DM } from 'radix-ui';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export const DropdownMenuGroup = DM.Group;
export const DropdownMenuSub = DM.Sub;
export const DropdownMenuRadioGroup = DM.RadioGroup;

const itemClass =
  'relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-2 outline-none ' +
  'transition-colors data-[highlighted]:bg-surface-2 data-[highlighted]:text-ink ' +
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = 'end',
  ...props
}: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 min-w-[11rem] overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-pop',
          className,
        )}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentProps<typeof DM.Item> & { destructive?: boolean }) {
  return (
    <DM.Item
      className={cn(itemClass, destructive && 'text-danger data-[highlighted]:bg-danger-soft', className)}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DM.CheckboxItem>) {
  return (
    <DM.CheckboxItem className={cn(itemClass, 'pl-8', className)} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <DM.ItemIndicator>
          <Check className="size-3.5 text-accent" />
        </DM.ItemIndicator>
      </span>
      {children}
    </DM.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({ className, children, ...props }: React.ComponentProps<typeof DM.RadioItem>) {
  return (
    <DM.RadioItem className={cn(itemClass, 'pl-8', className)} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <DM.ItemIndicator>
          <Check className="size-3.5 text-accent" />
        </DM.ItemIndicator>
      </span>
      {children}
    </DM.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn('px-2 py-1.5 text-xs font-semibold text-ink-4', className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DM.Separator>) {
  return <DM.Separator className={cn('-mx-1 my-1 h-px bg-line', className)} {...props} />;
}

export function DropdownMenuSubTrigger({ className, children, ...props }: React.ComponentProps<typeof DM.SubTrigger>) {
  return (
    <DM.SubTrigger className={cn(itemClass, 'justify-between', className)} {...props}>
      {children}
      <ChevronRight className="size-3.5 text-ink-4" />
    </DM.SubTrigger>
  );
}

export function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof DM.SubContent>) {
  return (
    <DM.Portal>
      <DM.SubContent
        className={cn('z-50 min-w-[10rem] rounded-lg border border-line bg-surface p-1 shadow-pop', className)}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn('ml-auto font-mono text-xs text-ink-4', className)} {...props} />;
}
