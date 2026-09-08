import type { Intensity, PlannedSession, Profile, Range, Sport, TimeOfDay, WeeklyPlan } from '../domain/types';
import { preFuelSnacks } from '../data/foods';
import { buildDaily } from './daily';
import { buildDashboard } from './dashboard';

/**
 * The "Home" tab payload: the current week laid out Mon–Sun, what's planned for
 * the selected day (straight from the stored plan — estimated length + stated
 * effort, nothing invented), and the fuelling to aim for. Fuelling is the
 * profile's daily average (from the engine), plus the during-session targets
 * for that day when the day has a session the engine can classify. A rest day
 * or an unclassifiable day is a "normal day" — the daily average is all of it.
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

export interface HomeFuel {
  daily: {
    energy_kcal: Range;
    protein_g: Range;
    carbohydrate_g: Range;
    fluid_l: Range;
  };
  during_session: {
    carb_g_per_hour: Range;
    fluid_ml_per_hour: Range;
    sodium_mg_per_litre: Range | null;
  } | null;
  /** True when there's nothing extra to do — the daily average covers the day. */
  is_normal_day: boolean;
  /** Time-of-day pre-fuel nudge for the selected day (morning / evening), or null. */
  pre_fuel_note: string | null;
  confidence: string;
}

export interface HomeView {
  greeting_name: string | null;
  today: string;
  selected_date: string;
  week: HomeWeekDay[];
  has_plan: boolean;
  /** End-of-day check-in state (for the profile-avatar dot + evening popup). */
  checkin: { due: boolean; done: boolean };
  selected: {
    date: string;
    weekday: string;
    day_of_month: number;
    is_today: boolean;
    /** The selected date falls inside the stored plan's week. */
    in_plan: boolean;
    is_rest: boolean;
    sessions: HomeSession[];
    fuel: HomeFuel;
  };
  methodology: { daily: string; session: string | null };
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const x = atMidnight(d);
  x.setDate(x.getDate() + n);
  return x;
}

function mondayOf(d: Date): Date {
  const x = atMidnight(d);
  const dow = x.getDay(); // 0 Sun … 6 Sat
  return addDays(x, dow === 0 ? -6 : 1 - dow);
}

function parts(iso: string): [number, number, number] {
  return iso.split('-').map(Number) as [number, number, number];
}

function weekdayLabel(iso: string): string {
  const [y, m, d] = parts(iso);
  return DAYS[new Date(y, m - 1, d).getDay()]!;
}

function dayOfMonth(iso: string): number {
  return parts(iso)[2];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function sportLabel(sport: Sport): string {
  return SPORT_LABEL[sport] ?? 'session';
}

function titleFor(s: PlannedSession): string {
  const label = sportLabel(s.sport);
  const when = s.time_of_day ? `${s.time_of_day} ` : '';
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  if (s.is_long) return cap(`long ${when}${label}`);
  if (s.distance_km) return `${s.distance_km} km ${when}${label}`;
  return cap(`${when}${label}`);
}

function durationLabel(s: PlannedSession): string {
  if (s.duration_minutes && s.duration_minutes > 0) {
    return s.duration_minutes >= 90
      ? `${(s.duration_minutes / 60).toFixed(1).replace(/\.0$/, '')} hr`
      : `${s.duration_minutes} min`;
  }
  if (s.distance_km && s.distance_km > 0) return `${s.distance_km} km`;
  return 'length not set';
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
function preFuelNote(sessions: HomeSession[], restrictions: Profile['dietary_restrictions'] = []): string | null {
  const times = new Set(sessions.map((s) => s.time_of_day).filter((t): t is TimeOfDay => t != null));
  if (times.has('morning')) {
    const snacks = preFuelSnacks(restrictions ?? []).join(', ');
    return `Morning session — if you train before a full breakfast, have ${snacks} 20–30 min before rather than a big meal.`;
  }
  if (times.has('evening')) {
    return "Evening session — you'll have eaten through the day; if it's been 3+ hours, a small carb snack about an hour before is plenty.";
  }
  return null;
}

export function buildHome(input: {
  profile: Profile;
  weeklyPlan?: WeeklyPlan;
  sessions: PlannedSession[];
  now?: Date;
  selectedDate?: string;
  /** Whether the user has already done an end-of-day check-in today. */
  checkinDoneToday?: boolean;
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

  const monday = mondayOf(now);
  const week: HomeWeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = isoDate(addDays(monday, i));
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

  const daily = buildDaily(input.profile, now).nutrition;
  const dashboard = buildDashboard({
    profile: input.profile,
    weeklyPlan: input.weeklyPlan,
    sessions: input.sessions,
  });
  const dashDay = dashboard.days.find((d) => d.date === selected_date) ?? null;

  const during =
    dashDay && (dashDay.carb_g_per_hour || dashDay.fluid_ml_per_hour)
      ? {
          carb_g_per_hour: dashDay.carb_g_per_hour ?? { min: 0, max: 0 },
          fluid_ml_per_hour: dashDay.fluid_ml_per_hour ?? { min: 0, max: 0 },
          sodium_mg_per_litre: dashDay.sodium_mg_per_litre,
        }
      : null;

  const weekStart = input.weeklyPlan?.week_start;
  const in_plan = weekStart
    ? selected_date >= weekStart && selected_date <= isoDate(addDays(new Date(`${weekStart}T00:00:00`), 6))
    : false;

  const selectedSessions = (byDate.get(selected_date) ?? []).map(sessionView);
  const pre_fuel_note = preFuelNote(selectedSessions, input.profile.dietary_restrictions ?? []);

  const todayDay = week.find((d) => d.is_today);
  const checkinDone = input.checkinDoneToday ?? false;
  const checkinDue = !checkinDone && !!todayDay && !todayDay.is_rest && todayDay.has_session;

  return {
    greeting_name: input.profile.username ?? null,
    today,
    selected_date,
    week,
    has_plan: input.weeklyPlan != null,
    checkin: { due: checkinDue, done: checkinDone },
    selected: {
      date: selected_date,
      weekday: weekdayLabel(selected_date),
      day_of_month: dayOfMonth(selected_date),
      is_today: selected_date === today,
      in_plan,
      is_rest: restSet.has(selected_date),
      sessions: selectedSessions,
      fuel: {
        daily: {
          energy_kcal: daily.energy_kcal,
          protein_g: daily.protein_g,
          carbohydrate_g: daily.carbohydrate_g,
          fluid_l: daily.fluid_l,
        },
        during_session: during,
        is_normal_day: during == null,
        pre_fuel_note,
        confidence: daily.confidence,
      },
    },
    methodology: { daily: daily.methodology_version, session: dashboard.methodology_version ?? null },
  };
}
