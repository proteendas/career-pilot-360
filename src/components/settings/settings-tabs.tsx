'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SETTINGS_TABS } from '@/lib/nav';
import { cn } from '@/lib/utils';

export function SettingsTabs() {
  const pathname = usePathname();

  return (
    <div className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-line bg-surface-2 p-1 cp-scroll">
      {SETTINGS_TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
              active ? 'bg-surface text-ink shadow-soft' : 'text-ink-3 hover:text-ink',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
