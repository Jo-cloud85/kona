'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Workspace from './Workspace';
import DashboardView from './DashboardView';
import DailyTab from './DailyTab';
import ProfileTab from './ProfileTab';
import type { ProfileValues } from './ProfileForm';

type Tab = 'profile' | 'daily' | 'dashboard' | 'chat';
const TAB_KEY = 'kona.tab';

const NAV: { tab: Tab; label: string; icon: ReactNode }[] = [
  {
    tab: 'profile',
    label: 'Profile',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
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
  const [tab, setTab] = useState<Tab>('chat');

  useEffect(() => {
    try {
      const t = window.localStorage.getItem(TAB_KEY) as Tab | null;
      if (t && NAV.some((n) => n.tab === t)) setTab(t);
    } catch {
      /* ignore */
    }
  }, []);

  const go = (t: Tab) => {
    setTab(t);
    try {
      window.localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="app-shell">
      <div className="tab-content" key={tab}>
        {tab === 'profile' && (
          <ProfileTab
            onSaved={(p) => {
              onProfileChange(p);
              go('daily');
            }}
          />
        )}
        {tab === 'daily' && <DailyTab />}
        {tab === 'dashboard' && <DashboardView />}
        {tab === 'chat' && <Workspace greetingName={greetingName} />}
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
