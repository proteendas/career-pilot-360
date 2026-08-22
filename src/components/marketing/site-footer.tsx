import Link from 'next/link';
import { Logo } from '@/components/brand/logo';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/features', label: 'Features' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/#how-it-works', label: 'How it works' },
      { href: '/#faq', label: 'FAQ' },
    ],
  },
  {
    title: 'Trust',
    links: [
      { href: '/security', label: 'Security' },
      { href: '/privacy', label: 'Privacy Policy' },
      { href: '/terms', label: 'Terms of Service' },
      { href: '/privacy#data-deletion', label: 'Data deletion' },
    ],
  },
  {
    title: 'Account',
    links: [
      { href: '/signup', label: 'Create account' },
      { href: '/login', label: 'Sign in' },
      { href: '/forgot-password', label: 'Reset password' },
      { href: '/settings/ai-providers', label: 'Bring your own AI key' },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-paper-2">
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="space-y-3">
            <Logo />
            <p className="max-w-xs text-sm leading-relaxed text-ink-3">
              An AI job application assistant that prepares the work and leaves every outward-facing decision to you.
            </p>
            <p className="max-w-xs text-xs leading-relaxed text-ink-4">
              CareerPilot360 does not scrape job portals, does not automate logged-in accounts, and never asks for your
              LinkedIn or Naukri password.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title} className="space-y-3">
              <h2 className="text-[11px] font-semibold tracking-wider text-ink-4 uppercase">{col.title}</h2>
              <ul className="space-y-2">
                {col.links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link
                      href={l.href}
                      className="rounded text-sm text-ink-3 transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)]"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-line pt-6 text-xs text-ink-4 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} CareerPilot360. All rights reserved.</p>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a href="mailto:support@careerpilot360.example" className="hover:text-accent">
              support@careerpilot360.example
            </a>
            <span aria-hidden className="hidden sm:inline">
              ·
            </span>
            <span>AI output must be reviewed by you before it is used or sent.</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
