'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Workspace from './Workspace';
import TodayTab from './TodayTab';
import ProfileOverlay from './ProfileOverlay';
import type { ProfileValues } from './ProfileForm';
import WeekView from './WeekView';
import RhythmTab from './RhythmTab';

// M27 ("Kona accompanies me" redesign): four persistent tabs — Today (was
// Home; the state-driven judgment card, not a pre-workout-only reminder),
// Chat, Week, Rhythm (merges the old You + Memory tabs — progression AND
// "what Kona has learned" now read as one screen instead of two). Profile is
// still deliberately NOT a tab — reached from Today's avatar, as before.
type Tab = 'today' | 'chat' | 'week' | 'rhythm';
const TAB_KEY = 'kona.tab';

const NAV: { tab: Tab; label: string; icon: ReactNode }[] = [
  {
    tab: 'today',
    label: 'Today',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
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
    tab: 'rhythm',
    label: 'Rhythm',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M2.5 13h4l2.5-7 4 15 2.5-8h6" />
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
  const [tab, setTab] = useState<Tab>('today');
  // Every tab the athlete has switched to this session, so its component
  // mounts once (lazily, on first visit) and then stays mounted — see the
  // `.tab-pane` rendering below. Avoids the old key={tab} full unmount/
  // remount on every nav switch (a spinner + a refetch every time), while
  // still not eagerly fetching all four tabs' data on cold load.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>(['today']));
  const [chatPrefill, setChatPrefill] = useState<string | undefined>(undefined);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileCheckin, setProfileCheckin] = useState<{ label: string; onOpen: () => void } | null>(null);
  // Bumped on every profile save so Today/Rhythm reload (greeting name, goal
  // line, sports can all change) — see TodayTab/RhythmTab's `profileVersion` prop.
  const [profileVersion, setProfileVersion] = useState(0);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TAB_KEY);
      // Every bottom-nav tab name this app has ever used, pre-M27, redirected
      // to whichever current tab now owns that content — so an existing
      // alpha tester's localStorage never lands on a dead tab.
      const REMAP: Record<string, Tab> = {
        profile: 'today',
        daily: 'today',
        dashboard: 'today',
        home: 'today',
        memory: 'rhythm',
        knows: 'rhythm',
        you: 'rhythm',
      };
      const t = (raw && REMAP[raw]) || (raw as Tab | null);
      if (t && NAV.some((n) => n.tab === t)) {
        setTab(t);
        setVisited((v) => (v.has(t) ? v : new Set(v).add(t)));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const go = useCallback((t: Tab) => {
    setTab(t);
    setVisited((v) => (v.has(t) ? v : new Set(v).add(t)));
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
      <div className="tab-content">
        {visited.has('today') && (
          <div className="tab-pane" hidden={tab !== 'today'}>
            <TodayTab
              greetingName={greetingName}
              onOpenChat={openChat}
              onOpenProfile={openProfile}
              onOpenWeek={() => go('week')}
              profileVersion={profileVersion}
            />
          </div>
        )}
        {visited.has('chat') && (
          <div className="tab-pane" hidden={tab !== 'chat'}>
            <Workspace
              greetingName={greetingName}
              initialPrefill={chatPrefill}
              onPrefillConsumed={() => setChatPrefill(undefined)}
            />
          </div>
        )}
        {visited.has('week') && (
          <div className="tab-pane" hidden={tab !== 'week'}>
            <WeekView onOpenChat={openChat} onOpenMemory={() => go('rhythm')} />
          </div>
        )}
        {visited.has('rhythm') && (
          <div className="tab-pane" hidden={tab !== 'rhythm'}>
            <RhythmTab profileVersion={profileVersion} />
          </div>
        )}
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
