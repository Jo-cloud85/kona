'use client';

import { useCallback, useEffect, useState } from 'react';
import CheckinDialog from './CheckinDialog';
import ProfileForm, { type ProfileValues } from './ProfileForm';

interface Range {
  min: number;
  max: number;
}
interface HomeSession {
  sport: string;
  title: string;
  intensity: string | null;
  intensity_known: boolean;
  time_of_day: string | null;
  time_known: boolean;
  duration_label: string;
  is_long: boolean;
}
interface HomeWeekDay {
  date: string;
  weekday: string;
  day_of_month: number;
  is_today: boolean;
  is_selected: boolean;
  is_rest: boolean;
  has_session: boolean;
}
interface HomeView {
  greeting_name: string | null;
  today: string;
  selected_date: string;
  week: HomeWeekDay[];
  has_plan: boolean;
  goal_line: string | null;
  checkin: { due: boolean; done: boolean };
  selected: {
    date: string;
    weekday: string;
    is_today: boolean;
    in_plan: boolean;
    is_rest: boolean;
    sessions: HomeSession[];
  };
  briefing: {
    your_day: {
      headline: string;
      line: string;
      fuelling: {
        carb_g_per_hour: Range;
        fluid_ml_per_hour: Range;
        sodium_mg_per_litre: Range | null;
        post_session_protein_g: Range | null;
      } | null;
      needs: string[];
    };
    next_key: { when: string; headline: string; line: string } | null;
    remembers: string[];
  };
}

const WEEKDAY_FULL: Record<string, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function rangeText(r: Range): string {
  return r.min === r.max ? r.min.toLocaleString() : `${r.min.toLocaleString()}–${r.max.toLocaleString()}`;
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function HomeTab({
  greetingName,
  onProfileChange,
  onOpenChat,
}: {
  greetingName?: string;
  onProfileChange: (p: ProfileValues) => void;
  onOpenChat: (prefill: string) => void;
}) {
  const [data, setData] = useState<HomeView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileInitial, setProfileInitial] = useState<ProfileValues | null>(null);
  const [checkinOpen, setCheckinOpen] = useState(false);

  const load = useCallback((date?: string) => {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    return fetch(`/api/home${qs}`)
      .then((r) => r.json())
      .then((d: { home: HomeView | null }) => setData(d.home))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!data?.checkin.due || new Date().getHours() < 22) return;
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(`kona.checkin.dismissed.${data.today}`) === '1';
    } catch {
      /* ignore */
    }
    if (!dismissed) setCheckinOpen(true);
  }, [data]);

  const dismissCheckin = () => {
    try {
      if (data) sessionStorage.setItem(`kona.checkin.dismissed.${data.today}`, '1');
    } catch {
      /* ignore */
    }
    setCheckinOpen(false);
  };

  const openProfile = () => {
    setProfileOpen(true);
    if (!profileInitial) {
      fetch('/api/profile')
        .then((r) => r.json())
        .then((d: { profile: ProfileValues | null }) => setProfileInitial(d.profile ?? {}))
        .catch(() => setProfileInitial({}));
    }
  };

  if (!loaded) {
    return (
      <div className="home">
        <p className="dash-msg">Loading…</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="home">
        <p className="dash-msg">Finish onboarding first — Home is built from your profile.</p>
      </div>
    );
  }

  const name = data.greeting_name ?? greetingName ?? 'there';
  const initial = (name.trim()[0] ?? 'K').toUpperCase();
  const sel = data.selected;
  const b = data.briefing;
  const yd = b.your_day;
  const dayLabel = sel.is_today ? 'Your day' : `${WEEKDAY_FULL[sel.weekday] ?? sel.weekday} · ${longDate(sel.date)}`;
  const chatPrefill = sel.sessions.length
    ? `Change my ${WEEKDAY_FULL[sel.weekday] ?? sel.weekday} session to `
    : `On ${WEEKDAY_FULL[sel.weekday] ?? sel.weekday} I'm doing `;

  return (
    <div className="home">
      <div className="home-top">
        <div>
          <p className="home-greeting">
            {greetingFor(new Date().getHours())}, {name}
          </p>
          <p className="home-date">{longDate(data.today)}</p>
          {data.goal_line && <p className="home-goal">{data.goal_line}</p>}
        </div>
        <button className="home-avatar" onClick={openProfile} aria-label="Profile">
          {initial}
          {data.checkin.due && <span className="avatar-dot" aria-hidden />}
        </button>
      </div>

      <div className="day-strip" role="tablist" aria-label="Week">
        {data.week.map((d) => (
          <button
            key={d.date}
            role="tab"
            aria-selected={d.is_selected}
            className={`day-pill${d.is_selected ? ' on' : ''}${d.is_today ? ' today' : ''}`}
            onClick={() => void load(d.date)}
          >
            <span className="day-pill-wd">{d.weekday}</span>
            <span className="day-pill-dm">{String(d.day_of_month).padStart(2, '0')}</span>
            <span className="day-pill-dot" style={{ visibility: d.has_session ? 'visible' : 'hidden' }} />
          </button>
        ))}
      </div>

      {data.checkin.due && !checkinOpen && (
        <button className="checkin-nudge" onClick={() => setCheckinOpen(true)}>
          Evening check-in — log how today went →
        </button>
      )}

      {/* YOUR DAY */}
      <section className="home-card brief-card">
        <p className="brief-label">{dayLabel}</p>
        <p className="brief-headline">{yd.headline}</p>
        <p className="brief-line">{yd.line}</p>

        {yd.fuelling && (
          <div className="fuel-grid brief-fuel">
            <div className="fuel-stat">
              <span className="fuel-stat-label">Carbs</span>
              <span className="fuel-stat-value">
                {rangeText(yd.fuelling.carb_g_per_hour)} <small>g / hr</small>
              </span>
            </div>
            <div className="fuel-stat">
              <span className="fuel-stat-label">Fluid</span>
              <span className="fuel-stat-value">
                {rangeText(yd.fuelling.fluid_ml_per_hour)} <small>ml / hr</small>
              </span>
            </div>
            <div className="fuel-stat">
              <span className="fuel-stat-label">Sodium</span>
              <span className="fuel-stat-value">
                {yd.fuelling.sodium_mg_per_litre ? `${rangeText(yd.fuelling.sodium_mg_per_litre)} ` : 'to taste '}
                {yd.fuelling.sodium_mg_per_litre && <small>mg / L</small>}
              </span>
            </div>
            {yd.fuelling.post_session_protein_g && (
              <div className="fuel-stat">
                <span className="fuel-stat-label">After</span>
                <span className="fuel-stat-value">
                  {rangeText(yd.fuelling.post_session_protein_g)} <small>g protein</small>
                </span>
              </div>
            )}
          </div>
        )}

        <button className="home-link" onClick={() => onOpenChat(chatPrefill)}>
          {sel.sessions.length ? 'Change or add a workout in chat' : 'Add a workout in chat'} →
        </button>
      </section>

      {/* ONE THING TO THINK ABOUT */}
      {b.next_key && (
        <section className="home-card brief-card">
          <p className="brief-label">One thing to think about</p>
          <p className="brief-headline">
            {b.next_key.when} — {b.next_key.headline}
          </p>
          <p className="brief-line">{b.next_key.line}</p>
        </section>
      )}

      {/* KONA REMEMBERS */}
      {b.remembers.length > 0 && (
        <section className="home-card brief-card">
          <p className="brief-label">Kona remembers</p>
          <ul className="remembers-list">
            {b.remembers.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="home-foot">
        Kona doesn&apos;t diagnose. Session references are general starting points, not exact targets.
      </p>

      {checkinOpen && (
        <CheckinDialog
          onClose={dismissCheckin}
          onDone={() => {
            setCheckinOpen(false);
            void load(data.selected_date === data.today ? undefined : data.selected_date);
          }}
        />
      )}

      {profileOpen && (
        <div className="profile-overlay" role="dialog" aria-modal="true" aria-label="Profile">
          <div className="profile-overlay-bar">
            <h1>Profile</h1>
            <button className="profile-close" onClick={() => setProfileOpen(false)} aria-label="Close">
              ✕
            </button>
          </div>
          <div className="app">
            <div className="landing">
              <p className="blurb">
                Update your weight, usual bottle, sports or goal — anything. It sharpens Kona&apos;s advice.
              </p>
            </div>
            {profileInitial ? (
              <ProfileForm
                initial={profileInitial}
                submitLabel="Save changes"
                onSaved={(p) => {
                  onProfileChange(p);
                  setProfileInitial(p);
                  setProfileOpen(false);
                  void load(data.selected_date === data.today ? undefined : data.selected_date);
                }}
              />
            ) : (
              <p className="dash-msg" style={{ textAlign: 'center' }}>
                Loading…
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
