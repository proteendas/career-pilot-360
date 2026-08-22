'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/hooks/use-hydrated';
import { cn } from '@/lib/utils';

/**
 * Single-press light/dark switch.
 *
 * The first press resolves the current system preference into an explicit
 * choice, so what you see is always what the next press flips away from.
 * Icons cross-fade rather than swap, which reads as one control changing state
 * instead of two controls trading places.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useHydrated();

  const isDark = mounted && resolvedTheme === 'dark';
  const next = isDark ? 'light' : 'dark';

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('relative', className)}
      onClick={() => setTheme(next)}
      // Before mount we cannot know the resolved theme, so stay unlabelled
      // rather than announcing the wrong one.
      aria-label={mounted ? `Switch to ${next} mode` : 'Switch colour theme'}
      title={mounted ? `Switch to ${next} mode` : undefined}
    >
      <Sun
        aria-hidden
        className={cn(
          'absolute transition-all duration-300',
          isDark ? 'scale-50 rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100',
        )}
      />
      <Moon
        aria-hidden
        className={cn(
          'absolute transition-all duration-300',
          isDark ? 'scale-100 rotate-0 opacity-100' : 'scale-50 -rotate-90 opacity-0',
        )}
      />
    </Button>
  );
}
