/**
 * Navigation model. Single source of truth for the sidebar, the mobile drawer,
 * the command palette and breadcrumb labels — so a route can never appear in
 * one and be missing from another.
 */
export interface NavItem {
  href: string;
  label: string;
  /** lucide-react icon name, resolved by the renderer. */
  icon: string;
  description: string;
  /** Extra path prefixes that should mark this item active. */
  matches?: string[];
  badge?: 'beta' | 'setup';
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      {
        href: '/dashboard',
        label: 'Dashboard',
        icon: 'LayoutDashboard',
        description: 'Scores, pipeline and what needs your attention',
      },
      {
        href: '/assistant',
        label: 'Assistant',
        icon: 'Bot',
        description: 'Ask about matches, gaps and drafts',
      },
    ],
  },
  {
    title: 'Resume',
    items: [
      {
        href: '/resume',
        label: 'Resume Center',
        icon: 'FileText',
        description: 'Upload, versions, ATS analysis and PDF export',
        matches: ['/resume/'],
      },
    ],
  },
  {
    title: 'Opportunities',
    items: [
      {
        href: '/jobs',
        label: 'Jobs',
        icon: 'Briefcase',
        description: 'Discover and import roles from compliant sources',
        matches: ['/jobs/'],
      },
      {
        href: '/matches',
        label: 'Matches',
        icon: 'Target',
        description: 'Scored fit against your resume and preferences',
      },
      {
        href: '/applications',
        label: 'Applications',
        icon: 'Send',
        description: 'Packets, review and submission tracking',
        matches: ['/applications/'],
      },
      {
        href: '/outreach',
        label: 'Outreach',
        icon: 'Mail',
        description: 'Recruiter drafts you confirm before sending',
        matches: ['/outreach/'],
      },
    ],
  },
  {
    title: 'Automation',
    items: [
      {
        href: '/schedule',
        label: 'Schedule',
        icon: 'CalendarClock',
        description: 'Background preparation and reminders',
      },
      {
        href: '/history',
        label: 'History',
        icon: 'History',
        description: 'Everything that has happened, in order',
      },
      {
        href: '/audit',
        label: 'Audit log',
        icon: 'ScrollText',
        description: 'Append-only record of every action',
      },
    ],
  },
  {
    title: 'Account',
    items: [
      {
        href: '/profile',
        label: 'Profile',
        icon: 'UserRound',
        description: 'Personal, professional and job preferences',
      },
      {
        href: '/settings',
        label: 'Settings',
        icon: 'Settings',
        description: 'AI providers, security and integrations',
        matches: ['/settings/'],
      },
    ],
  },
];

export const SETTINGS_TABS = [
  { href: '/settings', label: 'General', icon: 'Settings' },
  { href: '/settings/ai-providers', label: 'AI providers', icon: 'KeyRound' },
  { href: '/settings/security', label: 'Security & privacy', icon: 'ShieldCheck' },
  { href: '/settings/integrations', label: 'Integrations', icon: 'Plug' },
] as const;

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

/** Longest-prefix match, so /resume/abc highlights "Resume Center". */
export function isNavActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.href) return true;
  const prefixes = item.matches ?? [];
  return prefixes.some((p) => pathname.startsWith(p));
}

/** Human label for a path segment, used by breadcrumbs. */
export function segmentLabel(segment: string): string {
  const known: Record<string, string> = {
    dashboard: 'Dashboard',
    resume: 'Resume',
    jobs: 'Jobs',
    matches: 'Matches',
    applications: 'Applications',
    outreach: 'Outreach',
    schedule: 'Schedule',
    assistant: 'Assistant',
    history: 'History',
    audit: 'Audit log',
    profile: 'Profile',
    settings: 'Settings',
    onboarding: 'Onboarding',
    analysis: 'Analysis',
    suggestions: 'Suggestions',
    versions: 'Versions',
    review: 'Review',
    'ai-providers': 'AI providers',
    security: 'Security & privacy',
    integrations: 'Integrations',
  };
  if (known[segment]) return known[segment];
  // UUIDs and opaque ids get shortened rather than shown in full.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment)) return `${segment.slice(0, 8)}…`;
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
}
