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
          <p className="tagline">Your AI fueling companion for training.</p>
          <p className="blurb">
            Plan your fueling, tell Kona what actually happened, and get practical advice for next time.
            First, a few things so the advice fits you.
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
        <p className="blurb">Kona uses this as background — you can change anything later in the Profile tab.</p>
      </div>
      <ProfileForm submitLabel="Start with Kona" onSaved={() => onDone()} />
    </div>
  );
}
