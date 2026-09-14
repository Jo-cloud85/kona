import type {
  ActualSession,
  FuelLog,
  Intensity,
  PersistedMemory,
  PlannedSession,
  Profile,
  Range,
  RecoveryLog,
  SessionInputCore,
  Sport,
  TimeOfDay,
  WeeklyPlan,
} from '../domain/types';
import { goalContext } from '../domain/goal';
import type { KonaBriefing } from './briefing';
import { buildDashboard } from './dashboard';
import { deriveInsights, type Insight } from './insights';

/**
 * The "Home" tab payload. Home is a **daily briefing**, not a stats dashboard —
 * it answers: what am I doing today? does anything about today matter? what to
 * prepare for next? anything relevant from my history that Kona remembers?
 *
 * Numbers appear only when the session earns them. History lines ("this worked
 * last time") come from the deterministic insight layer — never fabricated when
 * the data isn't there.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const SPORT_LABEL: Record<Sport, string> = {
  running: 'run',
  cycling: 'ride',
  swimming: 'swim',
  gym: 'gym',
  climbing: 'climb',
  skating: 'skate',
  combat_sports: 'combat session',
  hyrox: 'HYROX session',
  triathlon: 'triathlon session',
  other: 'session',
};

export interface HomeSession {
  sport: Sport;
  /** Human title, e.g. "Long run", "18 km evening run", "Morning gym". */
  title: string;
  /** Stated effort, or null when the user hasn't set it yet. */
  intensity: Intensity | null;
  intensity_known: boolean;
  /** Stated time-of-day bucket, or null when not set yet. */
  time_of_day: TimeOfDay | null;
  time_known: boolean;
  /** "45 min" · "18 km" · "length not set" — never a guessed number. */
  duration_label: string;
  is_long: boolean;
}

export interface HomeWeekDay {
  date: string;
  weekday: string;
  day_of_month: number;
  is_today: boolean;
  is_selected: boolean;
  is_rest: boolean;
  has_session: boolean;
}

/** A short, forward-looking preview of the week for the Home tab — the same
 *  per-day title/duration "Your week" already computes, just the first few
 *  days (today first), for a card that links through to the full page. */
export interface HomeWeekPreviewDay {
  date: string;
  weekday: string;
  day_of_month: number;
  is_today: boolean;
  is_rest: boolean;
  is_double: boolean;
  title: string | null;
  duration_label: string | null;
}

export interface HomeBriefing {
  /** "What am I doing today?" + "does it matter?" */
  your_day: {
    headline: string;
    line: string;
    /** During-/around-session references — present ONLY when the session warrants them. */
    fuelling: {
      carb_g_per_hour: Range;
      fluid_ml_per_hour: Range;
      sodium_mg_per_litre: Range | null;
      post_session_protein_g: Range | null;
    } | null;
    /** Details still missing for the selected day's session(s): e.g. ["effort","time"]. */
    needs: string[];
  };
  /** "How should you approach the next session?" (M24) — ONE evidence-backed
   *  recommendation for the next genuinely meaningful session, today or ahead.
   *  Always has an `action`; `why` is null unless real evidence exists. */
  kona_briefing: KonaBriefing;
  /** "Anything relevant Kona remembers?" — 0–2 lines; empty hides the section. */
  remembers: string[];
}

export interface HomeView {
  greeting_name: string | null;
  today: string;
  selected_date: string;
  week: HomeWeekDay[];
  /** Today + the next few days, for the "Your week" preview card. */
  week_preview: HomeWeekPreviewDay[];
  has_plan: boolean;
  /** One-line goal context ("11 weeks to your first Olympic-distance triathlon"), or null. */
  goal_line: string | null;
  /** End-of-day check-in state (for the profile-avatar dot + evening popup).
   *  `missed_date` is the most recent PAST day (within the rolling window)
   *  that had a training session and never got checked in — it keeps the
   *  reminder alive past midnight instead of silently dropping it when
   *  "today" rolls over (real alpha feedback, 2026-09-14). */
  checkin: { due: boolean; done: boolean; today_due: boolean; missed_date: string | null };
  selected: {
    date: string;
    weekday: string;
    day_of_month: number;
    is_today: boolean;
    /** The selected date falls inside the stored plan's week. */
    in_plan: boolean;
    is_rest: boolean;
    sessions: HomeSession[];
  };
  briefing: HomeBriefing;
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  const x = atMidnight(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function mondayOf(d: Date): Date {
  const x = atMidnight(d);
  const dow = x.getDay(); // 0 Sun … 6 Sat
  return addDays(x, dow === 0 ? -6 : 1 - dow);
}

function parts(iso: string): [number, number, number] {
  return iso.split('-').map(Number) as [number, number, number];
}

export function weekdayLabel(iso: string): string {
  const [y, m, d] = parts(iso);
  return DAYS[new Date(y, m - 1, d).getDay()]!;
}

export function dayOfMonth(iso: string): number {
  return parts(iso)[2];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function sportLabel(sport: Sport): string {
  return SPORT_LABEL[sport] ?? 'session';
}

export function titleFor(s: SessionInputCore): string {
  const label = sportLabel(s.sport);
  const when = s.time_of_day ? `${s.time_of_day} ` : '';
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  if (s.is_long) return cap(`long ${when}${label}`);
  if (s.distance_label) return `${s.distance_label} ${when}${label}`;
  if (s.distance_km) return `${s.distance_km} km ${when}${label}`;
  return cap(`${when}${label}`);
}

export function durationLabel(s: SessionInputCore): string {
  if (s.duration_minutes && s.duration_minutes > 0) {
    return s.duration_minutes >= 90
      ? `${(s.duration_minutes / 60).toFixed(1).replace(/\.0$/, '')} hr`
      : `${s.duration_minutes} min`;
  }
  if (s.distance_label) return s.distance_label;
  if (s.distance_km && s.distance_km > 0) return `${s.distance_km} km`;
  return 'length not set';
}

/** A day's title for a week-shaped view (Home's preview, the full "Your week"
 *  page): joined sports for a double day, the single session's title, "Rest",
 *  or null for an open day — nothing told to Kona yet. */
export function dayTitle(sessions: PlannedSession[], isRest: boolean): string | null {
  if (sessions.length > 1) {
    return joinList(sessions.map((s) => sportLabel(s.sport))).replace(/^\w/, (c) => c.toUpperCase());
  }
  if (sessions.length === 1) return titleFor(sessions[0]!);
  if (isRest) return 'Rest';
  return null;
}

function sessionView(s: PlannedSession): HomeSession {
  const intensityKnown = !(s.needs_detail ?? []).includes('intensity');
  const timeKnown = !(s.needs_detail ?? []).includes('time_of_day') && s.time_of_day != null;
  return {
    sport: s.sport,
    title: titleFor(s),
    intensity: intensityKnown ? s.intensity : null,
    intensity_known: intensityKnown,
    time_of_day: timeKnown ? s.time_of_day! : null,
    time_known: timeKnown,
    duration_label: durationLabel(s),
    is_long: s.is_long ?? false,
  };
}

/** Pre-fuel nudge for the selected day, keyed off a session's stated time. */
function preFuelNote(sessions: HomeSession[]): string | null {
  const times = new Set(sessions.map((s) => s.time_of_day).filter((t): t is TimeOfDay => t != null));
  if (times.has('morning')) {
    return 'Since it starts before a full breakfast, have something light 20–30 min before — a banana, a few dates, toast with jam — rather than a big meal.';
  }
  if (times.has('evening')) {
    return "You'll have eaten through the day; if it's been 3+ hours, a small carb snack about an hour before is plenty.";
  }
  return null;
}

/** "Today" / "Tomorrow" / "Saturday" / "next Tuesday" relative to today. */
export function describeWhen(todayIso: string, dateIso: string): string {
  const t = new Date(`${todayIso}T00:00:00`);
  const d = new Date(`${dateIso}T00:00:00`);
  const days = Math.round((d.getTime() - t.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days >= 2 && days <= 6) return weekdayFull(dateIso);
  return `next ${weekdayFull(dateIso)}`;
}

const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function weekdayFull(iso: string): string {
  const [y, m, d] = parts(iso);
  return WEEKDAY_FULL[new Date(y, m - 1, d).getDay()]!;
}

function sessionNeeds(sessions: HomeSession[]): string[] {
  const needs = new Set<string>();
  for (const s of sessions) {
    if (!s.intensity_known) needs.add('effort');
    if (s.duration_label === 'length not set') needs.add('length');
    if (!s.time_known) needs.add('time');
  }
  return [...needs];
}

export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// --- briefing sections --------------------------------------------------

interface DashDayLite {
  carb_g_per_hour: Range | null;
  fluid_ml_per_hour: Range | null;
  sodium_mg_per_litre: Range | null;
  is_key_day: boolean;
  sessions: { sport: Sport; is_long: boolean }[];
}

function buildYourDay(opts: {
  sessions: HomeSession[];
  isRest: boolean;
  hasPlan: boolean;
  inPlan: boolean;
  dashDay: DashDayLite | null;
  postProtein: Range;
}): HomeBriefing['your_day'] {
  const { sessions, isRest, hasPlan, inPlan, dashDay } = opts;

  if (sessions.length === 0) {
    if (isRest) {
      return { headline: 'Rest day', line: 'Recovery and normal meals. Nothing to prepare.', fuelling: null, needs: [] };
    }
    if (!hasPlan) {
      return {
        headline: 'No plan yet',
        line: "Bring your training plan in chat — Kona doesn't sync Strava or Garmin, so tell it in your own words and the day's plan shows up here.",
        fuelling: null,
        needs: [],
      };
    }
    if (!inPlan) {
      return {
        headline: 'Not in your current plan',
        line: "This day is outside the week you've told Kona about.",
        fuelling: null,
        needs: [],
      };
    }
    return {
      headline: 'Nothing planned',
      line: "An open day. If you train, tell Kona and it'll help you prep.",
      fuelling: null,
      needs: [],
    };
  }

  const headline = joinList(sessions.map((s) => s.title));
  const needs = sessionNeeds(sessions);
  const during =
    dashDay && (dashDay.carb_g_per_hour || dashDay.fluid_ml_per_hour)
      ? {
          carb_g_per_hour: dashDay.carb_g_per_hour ?? { min: 0, max: 0 },
          fluid_ml_per_hour: dashDay.fluid_ml_per_hour ?? { min: 0, max: 0 },
          sodium_mg_per_litre: dashDay.sodium_mg_per_litre,
          post_session_protein_g: opts.postProtein,
        }
      : null;

  const pre = preFuelNote(sessions);
  const isLong = sessions.some((s) => s.is_long);
  const isHard = sessions.some((s) => s.intensity === 'hard' || s.intensity === 'race');

  let line: string;
  if (during) {
    line = 'A bigger one today — the references below are worth following.';
  } else if (isLong) {
    line = 'Keep it steady and eat normally. Nothing special to prepare.';
  } else if (isHard) {
    line = 'A harder session — warm up well; normal meals otherwise.';
  } else {
    line = 'Nothing unusual today. Keep it easy and eat normally.';
  }
  if (pre) line += ` ${pre}`;
  if (needs.length) line += ` (Kona still needs the ${joinList(needs)} for this — sort it in chat.)`;

  return { headline, line, fuelling: during, needs };
}

const PREF_KEY = /(^prefers?_|preference|^only_|^no_|^cant_|^cannot_|constraint|fuel|setup)/i;

function buildRemembers(opts: {
  insights: Insight[];
  memories: PersistedMemory[];
  usedTexts: Set<string>;
}): string[] {
  const out: string[] = [];
  const push = (text: string) => {
    if (out.length < 2 && !opts.usedTexts.has(text) && !out.includes(text)) {
      out.push(text);
      opts.usedTexts.add(text);
    }
  };

  // recurring symptom / hydration facts are always relevant context
  for (const i of opts.insights) if (i.kind === 'fact' && (i.topic === 'recovery' || i.topic === 'fuelling')) push(i.text);
  // then any pattern not already surfaced
  for (const i of opts.insights) if (i.kind === 'pattern') push(i.text);
  // then a stated preference / constraint the athlete gave
  for (const m of opts.memories) if (PREF_KEY.test(m.key)) push(m.value);

  return out;
}

export function buildHome(input: {
  profile: Profile;
  weeklyPlan?: WeeklyPlan;
  sessions: PlannedSession[];
  now?: Date;
  selectedDate?: string;
  /** Whether the user has already done an end-of-day check-in today. */
  checkinDoneToday?: boolean;
  /** Local calendar dates (YYYY-MM-DD, already resolved to the athlete's
   *  timezone by the caller — see lib/kona-server.ts) that have a recovery
   *  log. Used to find a past day whose check-in was never done. */
  recoveryDates?: Set<string>;
  actualSessions?: ActualSession[];
  recoveryLogs?: RecoveryLog[];
  fuelLogs?: FuelLog[];
  memories?: PersistedMemory[];
  /** Computed by the caller (`lib/kona-server.ts`, via `buildKonaBriefing`) —
   *  not built here, to keep this module free of a runtime dependency on
   *  `./briefing` (which itself imports plain helpers from this file).
   *  Optional only so tests that don't care about it can omit it. */
  konaBriefing?: KonaBriefing;
}): HomeView {
  const now = input.now ?? new Date();
  const today = isoDate(now);
  const selected_date = input.selectedDate && ISO_DATE.test(input.selectedDate) ? input.selectedDate : today;

  const restSet = new Set(input.weeklyPlan?.rest_days ?? []);
  const byDate = new Map<string, PlannedSession[]>();
  for (const s of input.sessions) {
    const key = s.start_at.slice(0, 10);
    const bucket = byDate.get(key);
    if (bucket) bucket.push(s);
    else byDate.set(key, [s]);
  }

  // Rolling, today-anchored window (today - 6 .. today + 7 = 14 days) rather
  // than a fixed Monday-Sunday week — today is always the default-visible day,
  // with 6 days of history a scroll-left away and a week+ of runway to the
  // right, so a session further out than "this calendar week" still lands
  // somewhere the athlete can see it.
  const windowStart = addDays(now, -6);
  const week: HomeWeekDay[] = Array.from({ length: 14 }, (_, i) => {
    const date = isoDate(addDays(windowStart, i));
    return {
      date,
      weekday: weekdayLabel(date),
      day_of_month: dayOfMonth(date),
      is_today: date === today,
      is_selected: date === selected_date,
      is_rest: restSet.has(date),
      has_session: (byDate.get(date)?.length ?? 0) > 0,
    };
  });

  // Today first, then the next few days — a short forward-looking preview
  // for the Home card (the full rolling window is "Your week").
  const week_preview: HomeWeekPreviewDay[] = Array.from({ length: 4 }, (_, i) => {
    const date = isoDate(addDays(now, i));
    const sessions = byDate.get(date) ?? [];
    const isRest = restSet.has(date);
    return {
      date,
      weekday: weekdayLabel(date),
      day_of_month: dayOfMonth(date),
      is_today: date === today,
      is_rest: isRest,
      is_double: sessions.length > 1,
      title: dayTitle(sessions, isRest),
      duration_label: sessions.length === 1 ? durationLabel(sessions[0]!) : null,
    };
  });

  const dashboard = buildDashboard({
    profile: input.profile,
    weeklyPlan: input.weeklyPlan,
    sessions: input.sessions,
  });
  const dashDays: (DashDayLite & { date: string })[] = dashboard.days.map((d) => ({
    date: d.date,
    carb_g_per_hour: d.carb_g_per_hour,
    fluid_ml_per_hour: d.fluid_ml_per_hour,
    sodium_mg_per_litre: d.sodium_mg_per_litre,
    is_key_day: d.is_key_day,
    sessions: d.sessions.map((s) => ({ sport: s.sport, is_long: s.is_long })),
  }));
  const dashDay = dashDays.find((d) => d.date === selected_date) ?? null;

  const weekStart = input.weeklyPlan?.week_start;
  const in_plan = weekStart
    ? selected_date >= weekStart && selected_date <= isoDate(addDays(new Date(`${weekStart}T00:00:00`), 6))
    : false;

  const selectedSessions = (byDate.get(selected_date) ?? []).map(sessionView);

  const insights = deriveInsights({
    actualSessions: input.actualSessions ?? [],
    recoveryLogs: input.recoveryLogs ?? [],
    fuelLogs: input.fuelLogs ?? [],
    memories: input.memories ?? [],
  });
  const konaBriefing: KonaBriefing = input.konaBriefing ?? {
    has_target: false,
    when: null,
    date: null,
    headline: null,
    action: 'Nothing special to prepare — normal meals and fluids are fine.',
    why: null,
    basis: null,
  };
  const usedTexts = new Set<string>();
  // The briefing's own evidence sentence shouldn't also repeat verbatim in
  // "Kona remembers" — same de-dup convention buildNextKey used to follow.
  if (konaBriefing.why) usedTexts.add(konaBriefing.why);

  const your_day = buildYourDay({
    sessions: selectedSessions,
    isRest: restSet.has(selected_date),
    hasPlan: input.weeklyPlan != null,
    inPlan: in_plan,
    dashDay,
    postProtein: dashboard.baseline.post_session_protein_g,
  });
  const remembers = buildRemembers({ insights, memories: input.memories ?? [], usedTexts });

  const todayDay = week.find((d) => d.is_today);
  const checkinDone = input.checkinDoneToday ?? false;
  const todayDue = !checkinDone && !!todayDay && !todayDay.is_rest && todayDay.has_session;

  // The most recent PAST day (within the rolling window) that had a training
  // session and no matching recovery log — carries the reminder past
  // midnight instead of losing it when "today" rolls over.
  const missedDays = week.filter(
    (d) => !d.is_today && d.date < today && !d.is_rest && d.has_session && !(input.recoveryDates?.has(d.date) ?? false),
  );
  const missedCheckinDate = missedDays.length ? missedDays[missedDays.length - 1]!.date : null;

  return {
    greeting_name: input.profile.username ?? null,
    today,
    selected_date,
    week,
    week_preview,
    has_plan: input.weeklyPlan != null,
    goal_line: goalContext(input.profile.goal, now).phrase,
    checkin: { due: todayDue || missedCheckinDate != null, done: checkinDone, today_due: todayDue, missed_date: missedCheckinDate },
    selected: {
      date: selected_date,
      weekday: weekdayLabel(selected_date),
      day_of_month: dayOfMonth(selected_date),
      is_today: selected_date === today,
      in_plan,
      is_rest: restSet.has(selected_date),
      sessions: selectedSessions,
    },
    briefing: { your_day, kona_briefing: konaBriefing, remembers },
  };
}
