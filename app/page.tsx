'use client';

import { useCallback, useEffect, useState } from 'react';
import Chat from './Chat';
import Onboarding from './Onboarding';

type View = 'loading' | 'onboarding' | 'chat';

export default function Page() {
  const [view, setView] = useState<View>('loading');
  const [name, setName] = useState<string | undefined>(undefined);

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/profile');
      const data = (await res.json()) as { profile: { username?: string; onboarded_at?: string } | null };
      if (data.profile?.onboarded_at) {
        setName(data.profile.username);
        setView('chat');
      } else {
        setView('onboarding');
      }
    } catch {
      setView('onboarding');
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  if (view === 'loading') {
    return (
      <div className="app">
        <div className="landing">
          <p className="blurb">Loading…</p>
        </div>
      </div>
    );
  }

  if (view === 'onboarding') {
    return <Onboarding onDone={() => void loadProfile()} />;
  }

  return <Chat greetingName={name} />;
}
