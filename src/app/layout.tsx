import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { publicEnv } from '@/lib/env';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jakarta',
  weight: ['400', '500', '600', '700', '800'],
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono-code',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: {
    default: 'CareerPilot360 — AI job application assistant you stay in control of',
    template: '%s · CareerPilot360',
  },
  description:
    'Analyse your resume against ATS heuristics, discover roles from compliant sources, tailor an application packet, ' +
    'and apply on your own terms. CareerPilot360 never scrapes job portals and never sends anything without your confirmation.',
  applicationName: 'CareerPilot360',
  metadataBase: new URL(publicEnv.appUrl),
  openGraph: {
    title: 'CareerPilot360',
    description: 'The AI job application assistant that keeps a human in the loop.',
    type: 'website',
    siteName: 'CareerPilot360',
  },
  robots: { index: true, follow: true },
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf9f5' },
    { media: '(prefers-color-scheme: dark)', color: '#1f1e1d' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${jakarta.variable} ${mono.variable}`}>
      <body className="min-h-dvh antialiased">
        <ThemeProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[100] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
          >
            Skip to content
          </a>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
