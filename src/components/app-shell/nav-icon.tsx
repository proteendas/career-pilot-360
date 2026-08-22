'use client';

import {
  Bot,
  Briefcase,
  CalendarClock,
  FileText,
  History,
  KeyRound,
  LayoutDashboard,
  Mail,
  Plug,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  Target,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Resolves the icon names used in `src/lib/nav.ts`.
 * An explicit map keeps the nav config serialisable (it crosses the
 * server/client boundary) while still tree-shaking to only these icons.
 */
const ICONS: Record<string, LucideIcon> = {
  Bot,
  Briefcase,
  CalendarClock,
  FileText,
  History,
  KeyRound,
  LayoutDashboard,
  Mail,
  Plug,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  Target,
  UserRound,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? FileText;
  return <Icon className={cn('size-4 shrink-0', className)} aria-hidden />;
}
