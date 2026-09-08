'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Workspace from './Workspace';
import DashboardView from './DashboardView';
import DailyTab from './DailyTab';
import HomeTab from './HomeTab';
import type { ProfileValues } from './ProfileForm';

type Tab = 'home' | 'daily' | 'dashboard' | 'chat';
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
    tab: 'daily',
    label: 'Daily',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4V3h6v1M8.5 9h7M8.5 13h7M8.5 17h4" />
      </svg>
    ),
  },
  {
    tab: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M4 20h16" />
        <rect x="5" y="11" width="3.5" height="7" rx="1" />
        <rect x="10.25" y="7" width="3.5" height="11" rx="1" />
        <rect x="15.5" y="13" width="3.5" height="5" rx="1" />
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

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TAB_KEY);
      const t = raw === 'profile' ? 'home' : (raw as Tab | null);
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

  return (
    <div className="app-shell">
      <div className="tab-content" key={tab}>
        {tab === 'home' && (
          <HomeTab
            greetingName={greetingName}
            onProfileChange={onProfileChange}
            onOpenChat={openChat}
            onOpenDaily={() => go('daily')}
          />
        )}
        {tab === 'daily' && <DailyTab />}
        {tab === 'dashboard' && <DashboardView />}
        {tab === 'chat' && (
          <Workspace
            greetingName={greetingName}
            initialPrefill={chatPrefill}
            onPrefillConsumed={() => setChatPrefill(undefined)}
          />
        )}
      </div>

      <nav className="bottom-nav">
        {NAV.map((n) => (
          <button
            key={n.tab}
            className={`nav-item${tab === n.tab ? ' on' : ''}`}
            aria-current={tab === n.tab ? 'page' : undefined}
            onClick={() => go(n.tab)}
          >
            {n.icon}
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
