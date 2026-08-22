'use client';

import { Toaster as SonnerToaster } from 'sonner';
import { useTheme } from 'next-themes';

export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <SonnerToaster
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="bottom-right"
      closeButton
      richColors={false}
      toastOptions={{
        classNames: {
          toast:
            'group rounded-lg border border-line bg-surface text-ink shadow-pop font-sans text-[13px] leading-relaxed',
          description: 'text-ink-3',
          actionButton: 'bg-accent text-white rounded-md',
          cancelButton: 'bg-surface-2 text-ink-2 rounded-md',
          error: 'border-danger/40',
          success: 'border-success/40',
          warning: 'border-warning/40',
        },
      }}
    />
  );
}
