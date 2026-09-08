import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kona',
  description: 'Your AI endurance companion.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // suppressHydrationWarning: some browser extensions inject attributes onto
  // <html>/<body> before React hydrates (e.g. data-scribe-recorder-ready).
  // This suppresses only those root-element attribute mismatches, not the tree.
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
