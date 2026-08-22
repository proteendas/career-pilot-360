'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Logo, LogoMark } from '@/components/brand/logo';
import { NavIcon } from './nav-icon';
import { NAV_SECTIONS, isNavActive } from '@/lib/nav';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { usePersistedFlag } from '@/hooks/use-hydrated';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'careerpilot360.sidebar.collapsed';

/** Collapsed state, persisted per browser. Expanded is the server default. */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = usePersistedFlag(STORAGE_KEY, false);
  const toggle = React.useCallback(() => setCollapsed((prev) => !prev), [setCollapsed]);
  return { collapsed, toggle };
}

/** Shared nav list, reused by the desktop rail and the mobile drawer. */
export function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Product" className="flex flex-col gap-5 px-3">
      {NAV_SECTIONS.map((section) => (
        <div key={section.title}>
          {!collapsed ? (
            <p className="mb-1.5 px-2 text-[10px] font-semibold tracking-[0.12em] text-ink-4 uppercase">
              {section.title}
            </p>
          ) : (
            <div className="mx-2 mb-2 h-px bg-line" aria-hidden />
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = isNavActive(item, pathname);
              const link = (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors outline-none',
                    'focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)]',
                    collapsed && 'justify-center px-0',
                    active
                      ? 'bg-accent-soft text-accent'
                      : 'text-ink-3 hover:bg-surface-2 hover:text-ink',
                  )}
                >
                  <NavIcon name={item.icon} className={active ? 'text-accent' : 'text-ink-4 group-hover:text-ink-2'} />
                  {!collapsed ? (
                    <>
                      <span className="truncate">{item.label}</span>
                      {item.badge ? (
                        <Badge tone={item.badge === 'setup' ? 'warning' : 'accent'} className="ml-auto shrink-0">
                          {item.badge}
                        </Badge>
                      ) : null}
                    </>
                  ) : null}
                </Link>
              );

              return (
                <li key={item.href}>
                  {collapsed ? (
                    <SimpleTooltip side="right" content={<span className="font-medium">{item.label}</span>}>
                      {link}
                    </SimpleTooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Desktop-only collapsible rail. */
export function Sidebar() {
  const { collapsed, toggle } = useSidebarCollapsed();

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-paper-2 transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[4.25rem]' : 'w-64',
      )}
    >
      <div className={cn('flex h-16 items-center px-4', collapsed && 'justify-center px-0')}>
        {collapsed ? (
          <Link href="/dashboard" aria-label="CareerPilot360 dashboard">
            <LogoMark />
          </Link>
        ) : (
          <Logo href="/dashboard" />
        )}
      </div>

      <div className="flex-1 overflow-y-auto pb-4 cp-scroll">
        <SidebarNav collapsed={collapsed} />
      </div>

      <div className="border-t border-line p-3">
        <button
          type="button"
          onClick={toggle}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium text-ink-4 transition-colors',
            'hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)]',
            collapsed && 'justify-center px-0',
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden />
          ) : (
            <>
              <PanelLeftClose className="size-4" aria-hidden />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
