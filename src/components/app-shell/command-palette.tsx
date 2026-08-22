'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { CornerDownLeft, Search } from 'lucide-react';
import { Dialog, DialogPortal, DialogOverlay } from '@/components/ui/dialog';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { NavIcon } from './nav-icon';
import { ALL_NAV_ITEMS, SETTINGS_TABS } from '@/lib/nav';
import { useHydrated } from '@/hooks/use-hydrated';
import { cn } from '@/lib/utils';

interface Action {
  id: string;
  label: string;
  hint: string;
  icon: string;
  run: () => void;
  group: string;
}

/**
 * Cmd/Ctrl-K palette. Navigation and quick actions only — nothing here performs
 * an outward-facing side effect without landing on a confirmation screen first.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = React.useCallback(
    (href: string) => () => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const actions: Action[] = React.useMemo(
    () => [
      ...ALL_NAV_ITEMS.map((item) => ({
        id: `nav:${item.href}`,
        label: item.label,
        hint: item.description,
        icon: item.icon,
        run: go(item.href),
        group: 'Go to',
      })),
      ...SETTINGS_TABS.map((t) => ({
        id: `settings:${t.href}`,
        label: `Settings · ${t.label}`,
        hint: 'Open settings',
        icon: t.icon,
        run: go(t.href),
        group: 'Settings',
      })),
      {
        id: 'action:upload',
        label: 'Upload a resume',
        hint: 'PDF or DOCX, parsed and scored',
        icon: 'FileText',
        run: go('/resume?upload=1'),
        group: 'Actions',
      },
      {
        id: 'action:import-job',
        label: 'Import a job from a URL',
        hint: 'Paste any job listing URL',
        icon: 'Briefcase',
        run: go('/jobs?import=1'),
        group: 'Actions',
      },
      {
        id: 'action:ask',
        label: 'Ask the assistant',
        hint: 'Explain a match, find gaps, draft outreach',
        icon: 'Bot',
        run: go('/assistant'),
        group: 'Actions',
      },
    ],
    [go],
  );

  const groups = React.useMemo(() => {
    const map = new Map<string, Action[]>();
    for (const a of actions) {
      const list = map.get(a.group) ?? [];
      list.push(a);
      map.set(a.group, list);
    }
    return [...map.entries()];
  }, [actions]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className={cn(
            'fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2',
            'overflow-hidden rounded-2xl border border-line bg-surface shadow-pop outline-none',
          )}
          aria-label="Command palette"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <Command loop className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search className="size-4 shrink-0 text-ink-4" aria-hidden />
              <Command.Input
                autoFocus
                placeholder="Search pages and actions…"
                className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
              />
              <kbd className="hidden shrink-0 rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-4 sm:block">
                esc
              </kbd>
            </div>

            <Command.List className="max-h-[min(24rem,60vh)] overflow-y-auto p-2 cp-scroll">
              <Command.Empty className="px-3 py-8 text-center text-sm text-ink-4">
                Nothing matched that search.
              </Command.Empty>

              {groups.map(([group, items]) => (
                <Command.Group
                  key={group}
                  heading={
                    <span className="text-[10px] font-semibold tracking-[0.12em] text-ink-4 uppercase">{group}</span>
                  }
                >
                  {items.map((a) => (
                    <Command.Item
                      key={a.id}
                      value={`${a.label} ${a.hint}`}
                      onSelect={a.run}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none',
                        'data-[selected=true]:bg-surface-2',
                      )}
                    >
                      <NavIcon name={a.icon} className="text-ink-4" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{a.label}</span>
                        <span className="block truncate text-xs text-ink-4">{a.hint}</span>
                      </span>
                      <CornerDownLeft className="size-3.5 shrink-0 text-ink-4 opacity-0 data-[selected=true]:opacity-100" aria-hidden />
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

/** The visible trigger in the top bar. */
export function CommandPaletteHint() {
  const hydrated = useHydrated();
  // Read the platform during render once hydrated; no effect, no extra pass.
  const isMac = hydrated && /mac/i.test(navigator.userAgent);

  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
        );
      }}
      className={cn(
        'hidden items-center gap-2 rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-xs text-ink-4 shadow-soft transition-colors',
        'hover:border-accent/40 hover:text-ink-3 focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)] sm:flex',
      )}
      aria-label="Open command palette"
    >
      <Search className="size-3.5" aria-hidden />
      <span>Search</span>
      <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-[10px]">
        {isMac ? '⌘' : 'Ctrl'}K
      </kbd>
    </button>
  );
}
