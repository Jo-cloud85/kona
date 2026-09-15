import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Urbanist } from 'next/font/google';
import './globals.css';

const urbanist = Urbanist({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'Kona',
  description: 'Your AI endurance companion.',
  appleWebApp: {
    title: 'Kona',
    statusBarStyle: 'black-translucent',
  },
};

// viewportFit: 'cover' is what makes env(safe-area-inset-*) resolve to real
// values on iPhone (notch/home-indicator) instead of silently 0 — without it
// every safe-area padding in globals.css (bottom nav, composer, dialogs) is
// inert and fixed elements sit flush against the edge, inside the home-
// indicator's own gesture area (M25.0 — root cause of "bottom nav feels
// insensitive").
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // suppressHydrationWarning: some browser extensions inject attributes onto
  // <html>/<body> before React hydrates (e.g. data-scribe-recorder-ready).
  // This suppresses only those root-element attribute mismatches, not the tree.
  return (
    <html lang="en" className={urbanist.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
