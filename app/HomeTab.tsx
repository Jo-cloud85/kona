'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import CheckinDialog from './CheckinDialog';
import { tzHeaders } from './client-tz';
import { readCache, writeCache } from './data-cache';

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
interface HomeWeekPreviewDay {
  date: string;
  weekday: string;
  day_of_month: number;
  is_today: boolean;
  is_rest: boolean;
  is_double: boolean;
  is_key_day: boolean;
  title: string | null;
  duration_label: string | null;
}
export interface KonaBriefing {
  when: string | null;
  date: string | null;
  session_label: string | null;
  headline: string;
  action: string;
  why: string | null;
  deviation: { planned: string; actual: string; reason: string | null } | null;
  basis: 'reported' | 'repeated' | 'outcome' | 'adaptation' | null;
}
interface HomeView {
  greeting_name: string | null;
  today: string;
  selected_date: string;
  week: HomeWeekDay[];
  week_preview: HomeWeekPreviewDay[];
  has_plan: boolean;
  goal_line: string | null;
  checkin: { due: boolean; done: boolean; today_due: boolean; missed_date: string | null };
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
    kona_briefing: KonaBriefing;
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

/** Marks a missed check-in day as handled so its reminder stops reappearing —
 *  see where HomeTab computes `missedDate` for why this can't just be "a
 *  recovery log now exists for that date" (a late check-in always logs
 *  against today, not the day it's catching up on). */
function markMissedResolved(date: string) {
  try {
    window.localStorage.setItem(`kona.checkin.missed_resolved.${date}`, '1');
  } catch {
    /* ignore */
  }
}

export default function HomeTab({
  greetingName,
  onOpenChat,
  onOpenProfile,
  onOpenWeek,
  profileVersion,
}: {
  greetingName?: string;
  onOpenChat: (prefill: string) => void;
  /** Opens the shared Profile overlay (Home's own avatar button per the
   *  mockup's own stated intent — Profile is deliberately not a tab). Pass
   *  a check-in nudge when one is due so Profile can surface it too. */
  onOpenProfile: (checkin?: { label: string; onOpen: () => void }) => void;
  /** Navigates to the Week tab. */
  onOpenWeek: () => void;
  /** Bumped by AppShell whenever Profile is saved, so Home reloads (the
   *  greeting name / goal line may have changed). */
  profileVersion: number;
}) {
  // Keyed by profileVersion (not by selected date — a remount always lands
  // back on today's default view, so only that default is worth caching for
  // an instant repaint; a day-pill tap already updates in place without a
  // spinner, see `load` below).
  const cacheKey = `home:${profileVersion}`;
  const cached = readCache<HomeView | null>(cacheKey);
  const [data, setData] = useState<HomeView | null>(cached ? cached.value : null);
  const [loaded, setLoaded] = useState(cached !== null);
  const [checkinOpen, setCheckinOpen] = useState(false);
  // Which date the open CheckinDialog is about — today, or a missed past day
  // caught up on late. Drives the dialog's copy and which local dismiss/
  // resolved key gets touched.
  const [checkinFor, setCheckinFor] = useState<string | null>(null);
  const dayStripRef = useRef<HTMLDivElement>(null);
  const scrolledToTodayRef = useRef(false);

  const load = useCallback(
    (date?: string) => {
      const qs = date ? `?date=${encodeURIComponent(date)}` : '';
      return fetch(`/api/home${qs}`, { headers: tzHeaders() })
        .then((r) => r.json())
        .then((d: { home: HomeView | null }) => {
          setData(d.home);
          if (!date) writeCache(cacheKey, d.home);
        })
        .catch(() => undefined)
        .finally(() => setLoaded(true));
    },
    [cacheKey],
  );

  useEffect(() => {
    void load();
  }, [load, profileVersion]);

  // Opening Home should always land with today as the first visible day —
  // scroll it into view once per mount, not on every subsequent day-pill tap.
  useEffect(() => {
    if (!data || scrolledToTodayRef.current) return;
    const todayPill = dayStripRef.current?.querySelector<HTMLButtonElement>('.day-pill.today');
    if (todayPill) {
      todayPill.scrollIntoView({ inline: 'start', block: 'nearest' });
      scrolledToTodayRef.current = true;
    }
  }, [data]);

  // A missed day resolves once the athlete acts on it (below), tracked
  // client-side since the check-in log itself always saves against today,
  // not the day it's catching up on. Computed straight from render (not an
  // effect + its own state) so it can never lag a render behind `data` —
  // that lag let a just-resolved day's auto-popup fire once more before the
  // resolution "caught up".
  let missedDate = data?.checkin.missed_date ?? null;
  if (missedDate) {
    try {
      if (window.localStorage.getItem(`kona.checkin.missed_resolved.${missedDate}`) === '1') missedDate = null;
    } catch {
      /* ignore */
    }
  }

  const effectiveDue = (data?.checkin.today_due ?? false) || missedDate != null;

  const openCheckin = useCallback(
    (forDate?: string | null) => {
      setCheckinFor(forDate ?? data?.today ?? null);
      setCheckinOpen(true);
    },
    [data],
  );

  // A missed day's own nudge is worth surfacing any time of day (it's not
  // "wait until evening", the day already happened); today's own check-in
  // still waits until evening so it doesn't nag mid-afternoon.
  useEffect(() => {
    if (!data || !effectiveDue) return;
    if (!missedDate && new Date().getHours() < 22) return;
    const key = `kona.checkin.dismissed.${missedDate ?? data.today}`;
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(key) === '1';
    } catch {
      /* ignore */
    }
    if (!dismissed) openCheckin(missedDate);
  }, [data, missedDate, effectiveDue, openCheckin]);

  const dismissCheckin = () => {
    try {
      if (checkinFor) sessionStorage.setItem(`kona.checkin.dismissed.${checkinFor}`, '1');
    } catch {
      /* ignore */
    }
    setCheckinOpen(false);
  };

  const weekdayFullFor = (date: string): string => {
    const wd = data?.week.find((d) => d.date === date)?.weekday;
    return (wd && WEEKDAY_FULL[wd]) || 'that day';
  };

  const checkinNudgeLabel = (): string =>
    missedDate
      ? `You missed checking in on ${weekdayFullFor(missedDate)} — tap to update →`
      : 'Evening check-in — log how today went →';

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
  const kb = b.kona_briefing;
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
        <button
          className="home-avatar"
          onClick={() =>
            onOpenProfile(effectiveDue ? { label: checkinNudgeLabel(), onOpen: () => openCheckin(missedDate) } : undefined)
          }
          aria-label="Profile"
        >
          {initial}
          {effectiveDue && <span className="avatar-dot" aria-hidden />}
        </button>
      </div>

      <div className="day-strip" role="tablist" aria-label="Week" ref={dayStripRef}>
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

      {effectiveDue && !checkinOpen && (
        <button className="checkin-nudge" onClick={() => openCheckin(missedDate)}>
          {checkinNudgeLabel()}
        </button>
      )}

      {/* KONA'S CALL (M24 + M25.1) — "given everything Kona knows, what
          matters today?" The one dominant judgment block: WHAT (headline) →
          WHY (evidence, when real) → WHAT TO DO (the recommendation). This is
          the top card; "Your day" below is the plain factual/fueling-numbers
          display for whichever day is selected. */}
      <section className="home-card kona-card brief-card kona-call">
        <p className="kona-eyebrow">
          <span className="dot" aria-hidden />
          {kb.session_label ? `${kb.when} · ${kb.session_label}` : "Kona's call"}
        </p>
        <p className="kona-call-headline">{kb.headline}</p>
        {kb.why && <p className="brief-line brief-why">{kb.why}</p>}
        {kb.deviation && (
          <p className="kona-deviation">
            Planned {kb.deviation.planned} · Actual {kb.deviation.actual}
            {kb.deviation.reason ? ` · ${kb.deviation.reason}` : ''}
          </p>
        )}
        <p className="kona-call-label">Recommendation</p>
        <p className="brief-line">{kb.action}</p>
        <button className="home-link" onClick={() => onOpenChat("Tell me more about today's call — ")}>
          Ask Kona about this →
        </button>
      </section>

      {/* YOUR DAY */}
      <section className="home-card brief-card">
        <p className="brief-label">{dayLabel}</p>
        <p className="brief-headline">{yd.headline}</p>
        <p className="brief-line">{yd.line}</p>

        {yd.fuelling && (
          <div className="fuel-grid brief-fuel">
            <p className="fuel-refs-label" style={{ gridColumn: '1 / -1' }}>
              references, not targets
            </p>
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

      {/* YOUR WEEK preview — today first, tap through for the full page.
          Always shown: "Your week" has its own empty state, and gating this
          on a formal weekly plan would hide it when there are only
          standalone sessions or logged history to show. */}
      <section className="home-card brief-card">
        <p className="brief-label">Your week</p>
        <div className="week-days">
          {data.week_preview.map((d) => (
            <div
              key={d.date}
              className={`week-day${d.is_today ? ' is-today' : ''}${!d.is_today && (d.is_key_day || d.is_double) ? ' is-key' : ''}${d.is_rest ? ' is-rest' : ''}${!d.title ? ' is-open' : ''}`}
            >
              <span className="week-day-dow">{d.weekday}</span>
              <div className="week-day-main">
                <span className="week-day-title">{d.title ?? <span className="week-day-open">Nothing planned</span>}</span>
              </div>
              {d.is_today && <span className="week-day-badge">Today</span>}
              {!d.is_today && (d.is_key_day || d.is_double) && (
                <span className="week-day-badge key">{d.is_key_day ? 'Key' : 'Double'}</span>
              )}
              {!d.is_today && !d.is_key_day && !d.is_double && d.duration_label && d.duration_label !== 'length not set' && (
                <span className="week-day-meta">{d.duration_label}</span>
              )}
            </div>
          ))}
        </div>
        <button className="home-link" onClick={onOpenWeek}>
          See your full week →
        </button>
      </section>

      {/* KONA REMEMBERS — always shown, per the mockup, with an honest
          empty state rather than hidden when there's nothing yet. */}
      <section className="home-card brief-card">
        <p className="brief-label">Kona remembers</p>
        {b.remembers.length > 0 ? (
          <ul className="remembers-list">
            {b.remembers.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        ) : (
          <p className="brief-line">Still getting to know you — this fills in as you log sessions and check in.</p>
        )}
      </section>

      <p className="home-foot">
        Kona doesn&apos;t diagnose. Session references are general starting points, not exact targets.
      </p>

      {checkinOpen && (
        <CheckinDialog
          contextLabel={checkinFor && checkinFor !== data.today ? weekdayFullFor(checkinFor) : undefined}
          // Only today's own check-in closes the loop (M24.5) — a missed-day
          // catch-up isn't about today's briefing.
          konaBriefing={checkinFor === data.today ? kb : undefined}
          onClose={dismissCheckin}
          onDone={() => {
            if (checkinFor && checkinFor !== data.today) markMissedResolved(checkinFor);
            setCheckinOpen(false);
            setCheckinFor(null);
            void load(data.selected_date === data.today ? undefined : data.selected_date);
          }}
        />
      )}

    </div>
  );
}
