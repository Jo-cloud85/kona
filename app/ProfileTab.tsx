'use client';

import { useEffect, useState } from 'react';
import ProfileForm, { type ProfileValues } from './ProfileForm';

export default function ProfileTab({ onSaved }: { onSaved: (p: ProfileValues) => void }) {
  const [initial, setInitial] = useState<ProfileValues | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/profile')
      .then((r) => r.json())
      .then((d: { profile: ProfileValues | null }) => setInitial(d.profile ?? {}))
      .catch(() => setInitial({}))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="app">
      <div className="landing">
        <h1>Profile</h1>
        <p className="blurb">Change your weight, activity level, dietary restrictions — anything. It updates the daily targets and the advice.</p>
      </div>
      {loaded && initial ? (
        <ProfileForm initial={initial} submitLabel="Save changes" onSaved={onSaved} />
      ) : (
        <p className="dash-msg" style={{ textAlign: 'center' }}>
          Loading…
        </p>
      )}
    </div>
  );
}
