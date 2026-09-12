import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Manrope } from 'next/font/google';
import './globals.css';

const manrope = Manrope({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'Kona',
  description: 'Your AI endurance companion.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // suppressHydrationWarning: some browser extensions inject attributes onto
  // <html>/<body> before React hydrates (e.g. data-scribe-recorder-ready).
  // This suppresses only those root-element attribute mismatches, not the tree.
  return (
    <html lang="en" className={manrope.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
