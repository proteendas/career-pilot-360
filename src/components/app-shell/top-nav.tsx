'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, ChevronRight, LogOut, Menu, Settings, ShieldCheck, UserRound } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SidebarNav } from './sidebar';
import { CommandPaletteHint } from './command-palette';
import { segmentLabel } from '@/lib/nav';
import { initials, relativeTime } from '@/lib/utils';
import { logoutAction } from '@/server/actions/auth';
import type { AuthedUser } from '@/lib/auth';

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  href: string | null;
  createdAt: string;
  readAt: string | null;
}

function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
      <ol className="flex items-center gap-1 text-sm">
        {segments.map((seg, i) => {
          const href = `/${segments.slice(0, i + 1).join('/')}`;
          const last = i === segments.length - 1;
          return (
            <li key={href} className="flex min-w-0 items-center gap-1">
              {i > 0 ? <ChevronRight className="size-3.5 shrink-0 text-ink-4" aria-hidden /> : null}
              {last ? (
                <span aria-current="page" className="truncate font-medium text-ink">
                  {segmentLabel(seg)}
                </span>
              ) : (
                <Link href={href} className="truncate text-ink-4 transition-colors hover:text-ink-2">
                  {segmentLabel(seg)}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function NotificationsMenu({ items }: { items: NotificationItem[] }) {
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
          <Bell aria-hidden />
          {unread > 0 ? (
            <span className="absolute top-1.5 right-1.5 flex size-2 rounded-full bg-accent ring-2 ring-paper" aria-hidden />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
          <p className="text-sm font-semibold text-ink">Notifications</p>
          {unread > 0 ? <Badge tone="accent">{unread} new</Badge> : null}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-ink-4">
            Nothing yet. Scheduled work and reminders will appear here.
          </p>
        ) : (
          <ul className="max-h-80 divide-y divide-line overflow-y-auto cp-scroll">
            {items.map((n) => (
              <li key={n.id}>
                <Link
                  href={n.href ?? '/dashboard'}
                  className="block px-3 py-2.5 transition-colors hover:bg-surface-2"
                >
                  <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
                    {!n.readAt ? <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden /> : null}
                    {n.title}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-3">{n.body}</p>
                  <p className="mt-1 text-[11px] text-ink-4">{relativeTime(n.createdAt)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function UserMenu({ user }: { user: AuthedUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)]"
          aria-label="Account menu"
        >
          <Avatar>
            {user.image ? <AvatarImage src={user.image} alt="" /> : null}
            <AvatarFallback>{initials(user.name ?? user.email)}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel className="pb-2">
          <span className="block truncate text-sm font-semibold text-ink">{user.name ?? 'Your account'}</span>
          <span className="block truncate text-xs font-normal text-ink-4">{user.email}</span>
          {!user.emailVerified ? (
            <Badge tone="warning" className="mt-2">
              Email not verified
            </Badge>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserRound aria-hidden /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/security">
            <ShieldCheck aria-hidden /> Security & privacy
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={logoutAction}>
          <button type="submit" className="w-full">
            <DropdownMenuItem destructive onSelect={(e) => e.preventDefault()} asChild>
              <span className="w-full">
                <LogOut aria-hidden /> Sign out
              </span>
            </DropdownMenuItem>
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopNav({
  user,
  notifications = [],
}: {
  user: AuthedUser;
  notifications?: NotificationItem[];
}) {
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-paper/85 px-4 backdrop-blur-md sm:px-6">
      {/* Mobile drawer */}
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
            <Menu aria-hidden />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" title="Navigation" className="pt-4">
          <div className="mb-4 px-3">
            <Logo href="/dashboard" />
          </div>
          <div className="flex-1 overflow-y-auto pb-6 cp-scroll">
            <SidebarNav />
          </div>
        </SheetContent>
      </Sheet>

      <Breadcrumbs />

      <div className="ml-auto flex items-center gap-1.5">
        <CommandPaletteHint />
        <NotificationsMenu items={notifications} />
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
