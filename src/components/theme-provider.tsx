'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="careerpilot360-theme"
    >
      <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
    </NextThemesProvider>
  );
}
