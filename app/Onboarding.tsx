'use client';

import { useState } from 'react';
import ProfileForm from './ProfileForm';

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [started, setStarted] = useState(false);

  if (!started) {
    return (
      <div className="app">
        <div className="landing">
          <h1>Kona</h1>
          <p className="tagline">Your AI endurance companion.</p>
          <p className="blurb">
            Kona learns what you&apos;re training for, listens to what actually happens, and uses that history
            the next time. Three quick things and you&apos;re in.
          </p>
          <button className="cta" onClick={() => setStarted(true)}>
            Get started
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="landing">
        <h1>A bit about you</h1>
        <p className="blurb">
          That&apos;s all Kona needs to start. It&apos;ll pick up the rest — weight, bottle size, preferences —
          as you talk.
        </p>
      </div>
      <ProfileForm mode="onboard" submitLabel="Start with Kona" onSaved={() => onDone()} />
    </div>
  );
}
