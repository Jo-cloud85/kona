'use client';

import { useState } from 'react';
import AppShell from './AppShell';
import Onboarding from './Onboarding';

/**
 * Client-side view switch between Onboarding and the main app. The decision
 * of *which* to show starts from server-resolved props (page.tsx fetches the
 * profile in a Server Component) instead of a client "Loading…" placeholder
 * that then fetches /api/profile on mount — that round trip is exactly the
 * kind of thing that makes a cold load feel slow on a phone.
 *
 * Finishing onboarding still needs to be a client-side transition (no full
 * reload), so this stays a small client component — it just no longer needs
 * to *fetch* anything to make that transition, since ProfileForm's onSaved
 * already hands back the freshly saved profile.
 */
export default function HomeGate({
  initialOnboarded,
  initialUsername,
}: {
  initialOnboarded: boolean;
  initialUsername?: string;
}) {
  const [onboarded, setOnboarded] = useState(initialOnboarded);
  const [name, setName] = useState<string | undefined>(initialUsername);

  if (!onboarded) {
    return (
      <Onboarding
        onDone={(profile) => {
          if (profile.username) setName(profile.username);
          setOnboarded(true);
        }}
      />
    );
  }

  return (
    <AppShell
      greetingName={name}
      onProfileChange={(p) => {
        if (p.username) setName(p.username);
      }}
    />
  );
}
