import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme-toggle';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="cp-glow pointer-events-none absolute inset-x-0 top-0 h-72" aria-hidden />
      <div className="cp-grid-bg pointer-events-none absolute inset-x-0 top-0 h-96 opacity-50" aria-hidden />

      <header className="relative flex h-16 items-center justify-between px-4 sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>

      <main id="main" className="relative flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-[26rem]">{children}</div>
      </main>

      <footer className="relative border-t border-line px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-[26rem] flex-col items-center gap-2 text-center">
          <p className="flex items-center gap-1.5 text-xs text-ink-4">
            <ShieldCheck className="size-3.5 text-success" aria-hidden />
            We never ask for your LinkedIn, Naukri or job-portal password.
          </p>
          <p className="text-xs text-ink-4">
            <Link href="/privacy" className="hover:text-accent">
              Privacy
            </Link>
            <span aria-hidden className="mx-2">
              ·
            </span>
            <Link href="/terms" className="hover:text-accent">
              Terms
            </Link>
            <span aria-hidden className="mx-2">
              ·
            </span>
            <Link href="/security" className="hover:text-accent">
              Security
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
