import Link from 'next/link';
import { cn } from '@/lib/utils';

/** The mark: a compass needle inside a rounded square - "pilot", not an airplane cliché. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'relative inline-flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-accent text-white shadow-soft',
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-[18px]">
        <path d="M12 3.5 14.9 12 12 20.5 9.1 12 12 3.5Z" fill="currentColor" opacity="0.95" />
        <path d="M3.5 12 12 9.1 20.5 12 12 14.9 3.5 12Z" fill="currentColor" opacity="0.55" />
      </svg>
    </span>
  );
}

export function Logo({
  className,
  href = '/',
  showWordmark = true,
  subtitle,
}: {
  className?: string;
  href?: string | null;
  showWordmark?: boolean;
  subtitle?: string;
}) {
  const content = (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      {showWordmark ? (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            CareerPilot<span className="text-accent">360</span>
          </span>
          {subtitle ? <span className="mt-0.5 text-[10px] font-medium text-ink-4">{subtitle}</span> : null}
        </span>
      ) : (
        <span className="sr-only">CareerPilot360</span>
      )}
    </span>
  );

  if (!href) return content;
  return (
    <Link href={href} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-accent-ring)]">
      {content}
    </Link>
  );
}
