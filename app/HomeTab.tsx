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
  checkin: { due: boolean; done: boolean };
  selected: {
    date: string;
    weekday: string;
    day_of_month: number;
    is_today: boolean;
    in_plan: boolean;
    is_rest: boolean;
    sessions: HomeSession[];
    fuel: {
      during_session: {
        carb_g_per_hour: Range;
        fluid_ml_per_hour: Range;
        sodium_mg_per_litre: Range | null;
      } | null;
      post_session_protein_g: Range | null;
      is_normal_day: boolean;
      pre_fuel_note: string | null;
    };
  };
  methodology: { session: string | null };
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

  // Auto-open the end-of-day check-in once, late evening, on a training day it
  // hasn't been done. Dismissed-for-today is remembered per browser session.
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
  const fuel = sel.fuel;
  const planTitle = sel.is_today ? "What's planned today" : `What's planned · ${longDate(sel.date)}`;
  const fuelTitle = sel.is_today ? 'Recommended fuelling today' : `Recommended fuelling · ${longDate(sel.date)}`;
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

      <section className="home-card">
        <h2>{planTitle}</h2>
        {sel.sessions.length > 0 ? (
          <>
            {sel.sessions.map((s, i) => (
              <div key={`${s.sport}-${i}`} className="plan-item">
                <span className="plan-title">{s.title}</span>
                <div className="plan-chips">
                  <span className={`plan-chip${s.intensity_known ? ' accent' : ''}`}>
                    {s.intensity_known ? s.intensity : 'effort not set'}
                  </span>
                  <span className="plan-chip">{s.duration_label}</span>
                  {!s.time_known && <span className="plan-chip">time not set</span>}
                  {s.is_long && <span className="plan-chip">long session</span>}
                </div>
              </div>
            ))}
          </>
        ) : sel.is_rest ? (
          <p className="plan-empty">Rest day — recovery and normal meals. Nothing to prepare.</p>
        ) : !data.has_plan ? (
          <p className="plan-empty">No weekly plan yet. Tell Kona your week in chat and it shows up here.</p>
        ) : sel.in_plan ? (
          <p className="plan-empty">Nothing planned for this day.</p>
        ) : (
          <p className="plan-empty">This day isn&apos;t part of your current plan.</p>
        )}
        <button className="home-cta" onClick={() => onOpenChat(chatPrefill)}>
          {sel.sessions.length ? 'Change or add a workout in chat' : 'Add a workout in chat'} →
        </button>
      </section>

      <section className="home-card">
        <h2>{fuelTitle}</h2>

        {fuel.during_session ? (
          <>
            <p className="home-card-sub">During-session references · methodology v{data.methodology.session}</p>
            <div className="fuel-grid">
              <div className="fuel-stat">
                <span className="fuel-stat-label">Carbs</span>
                <span className="fuel-stat-value">
                  {rangeText(fuel.during_session.carb_g_per_hour)} <small>g / hour</small>
                </span>
              </div>
              <div className="fuel-stat">
                <span className="fuel-stat-label">Fluid</span>
                <span className="fuel-stat-value">
                  {rangeText(fuel.during_session.fluid_ml_per_hour)} <small>ml / hour</small>
                </span>
              </div>
              <div className="fuel-stat">
                <span className="fuel-stat-label">Sodium</span>
                <span className="fuel-stat-value">
                  {fuel.during_session.sodium_mg_per_litre
                    ? `${rangeText(fuel.during_session.sodium_mg_per_litre)} `
                    : 'to taste '}
                  {fuel.during_session.sodium_mg_per_litre && <small>mg / litre</small>}
                </span>
              </div>
            </div>
          </>
        ) : (
          <p className="fuel-normal">
            {sel.sessions.length > 0
              ? 'Nothing special for this one — your usual meals and fluids cover it.'
              : 'Nothing to prepare — normal meals and fluids.'}
          </p>
        )}

        {fuel.pre_fuel_note && <p className="fuel-note">{fuel.pre_fuel_note}</p>}

        {fuel.post_session_protein_g && (
          <p className="fuel-note">
            After: put some carbohydrate and about {rangeText(fuel.post_session_protein_g)} g protein in the meal
            afterwards.
          </p>
        )}
      </section>

      <p className="home-foot">
        Session references come from general sports-nutrition guidance, not exact targets. Kona is a wellness
        tool, not a dietitian.
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
                Change your weight, activity level, dietary restrictions — anything. It updates the daily targets
                and the advice.
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
