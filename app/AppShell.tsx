'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Workspace from './Workspace';
import HomeTab from './HomeTab';
import KnowsView from './KnowsView';
import ProfileOverlay from './ProfileOverlay';
import type { ProfileValues } from './ProfileForm';
import WeekView from './WeekView';
import YouTab from './YouTab';

// M26 (Direction B): five persistent tabs, matching the mockup's own stated
// intent verbatim — "A fifth bottom-nav item, level with Home, Chat, Week
// and Memory. This is the athlete's identity, not a settings sub-screen
// buried behind an avatar tap — Home keeps its own small avatar button,
// which still opens account settings." So: Home, Chat, Week, Memory
// ("What Kona knows"), You (progression/identity) — and Profile is
// deliberately NOT a tab; it's an overlay opened from Home's avatar.
type Tab = 'home' | 'chat' | 'week' | 'knows' | 'you';
const TAB_KEY = 'kona.tab';

const NAV: { tab: Tab; label: string; icon: ReactNode }[] = [
  {
    tab: 'home',
    label: 'Home',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M4 11.5 12 4l8 7.5" />
        <path d="M6 10.5V20h12v-9.5" />
      </svg>
    ),
  },
  {
    tab: 'chat',
    label: 'Chat',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M20 12a8 8 0 0 1-11.5 7.2L4 20l.8-4.5A8 8 0 1 1 20 12Z" />
      </svg>
    ),
  },
  {
    tab: 'week',
    label: 'Week',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <rect x="4" y="4" width="7" height="7" rx="1.5" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    tab: 'knows',
    label: 'Memory',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <circle cx="11" cy="13" r="7" />
        <circle cx="17" cy="7" r="2.2" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    tab: 'you',
    label: 'You',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <circle cx="12" cy="8" r="3.4" />
        <path d="M5 20c1.2-4 4-6 7-6s5.8 2 7 6" />
      </svg>
    ),
  },
];

export default function AppShell({
  greetingName,
  onProfileChange,
}: {
  greetingName?: string;
  onProfileChange: (p: ProfileValues) => void;
}) {
  const [tab, setTab] = useState<Tab>('home');
  const [chatPrefill, setChatPrefill] = useState<string | undefined>(undefined);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileCheckin, setProfileCheckin] = useState<{ label: string; onOpen: () => void } | null>(null);
  // Bumped on every profile save so Home/You reload (greeting name, goal
  // line, sports can all change) — see HomeTab/YouTab's `profileVersion` prop.
  const [profileVersion, setProfileVersion] = useState(0);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TAB_KEY);
      // 'profile'/'daily'/'dashboard'/'memory' were bottom-nav tabs at one
      // point or another pre-M26; land those stale values on Home rather
      // than a tab that no longer means what it used to. ('memory' was
      // renamed to 'knows' in this pass — also redirected to Home so it
      // reloads onto the new tab fresh rather than silently mismatching.)
      const stale = raw === 'profile' || raw === 'daily' || raw === 'dashboard' || raw === 'memory';
      const t = stale ? 'home' : (raw as Tab | null);
      if (t && NAV.some((n) => n.tab === t)) setTab(t);
    } catch {
      /* ignore */
    }
  }, []);

  const go = useCallback((t: Tab) => {
    setTab(t);
    try {
      window.localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  }, []);

  const openChat = useCallback(
    (prefill: string) => {
      setChatPrefill(prefill);
      go('chat');
    },
    [go],
  );

  const openProfile = useCallback((checkin?: { label: string; onOpen: () => void }) => {
    setProfileCheckin(checkin ?? null);
    setProfileOpen(true);
  }, []);
  const closeProfile = useCallback(() => setProfileOpen(false), []);

  return (
    <div className="app-shell">
      <div className="tab-content" key={tab}>
        {tab === 'home' && (
          <HomeTab
            greetingName={greetingName}
            onOpenChat={openChat}
            onOpenProfile={openProfile}
            onOpenWeek={() => go('week')}
            profileVersion={profileVersion}
          />
        )}
        {tab === 'chat' && (
          <Workspace
            greetingName={greetingName}
            initialPrefill={chatPrefill}
            onPrefillConsumed={() => setChatPrefill(undefined)}
          />
        )}
        {tab === 'week' && <WeekView onOpenChat={openChat} onOpenMemory={() => go('knows')} />}
        {tab === 'knows' && <KnowsView />}
        {tab === 'you' && <YouTab profileVersion={profileVersion} />}
      </div>

      <ProfileOverlay
        open={profileOpen}
        name={greetingName ?? 'there'}
        onClose={closeProfile}
        onSaved={(p) => {
          onProfileChange(p);
          setProfileVersion((v) => v + 1);
        }}
        checkinNudgeLabel={profileCheckin?.label}
        onOpenCheckin={profileCheckin?.onOpen}
      />

      <nav className="bottom-nav">
        <div className="bottom-nav-items">
          {NAV.map((n) => (
            <button
              key={n.tab}
              className={`nav-item${tab === n.tab ? ' on' : ''}`}
              aria-current={tab === n.tab ? 'page' : undefined}
              aria-label={n.label}
              onClick={() => go(n.tab)}
            >
              {n.icon}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
