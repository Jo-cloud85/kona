import type { DurationClass, PlannedSession, Profile, Range, Sport, WeeklyPlan } from '../domain/types';
import { analyzeWeek, profileDailyBaseline } from '../engine/index';

/**
 * Per-day fueling summary for the dashboard. Numbers come only from the engine
 * (`analyzeWeek` per-session calc) and the rules table (`profileDailyBaseline`).
 * Days the engine can't classify carry `null` targets rather than a guess.
 */

export interface DashboardDaySession {
  sport: Sport;
  duration_class: DurationClass | null;
  is_long: boolean;
  needs_detail: boolean;
}

export interface DashboardDay {
  date: string;
  weekday: string;
  is_rest: boolean;
  sessions: DashboardDaySession[];
  /** During-exercise targets — null when no session that day has a classifiable duration. */
  carb_g_per_hour: Range | null;
  fluid_ml_per_hour: Range | null;
  /** Reference sodium *concentration* for long/hot sessions (not a per-day total). */
  sodium_mg_per_litre: Range | null;
}

export interface Dashboard {
  has_plan: boolean;
  week_start: string | null;
  week_end: string | null;
  baseline: {
    protein_daily_g: Range;
    protein_daily_g_per_kg: Range;
    post_session_protein_g: Range;
  };
  days: DashboardDay[];
  methodology_version: string;
}

function widest(ranges: (Range | undefined | null)[]): Range | null {
  const present = ranges.filter((r): r is Range => r != null);
  if (present.length === 0) return null;
  return {
    min: Math.min(...present.map((r) => r.min)),
    max: Math.max(...present.map((r) => r.max)),
  };
}

function weekEndIso(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number) as [number, number, number];
  const end = new Date(y, m - 1, d + 6);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
}

export function buildDashboard(input: {
  profile: Profile;
  weeklyPlan?: WeeklyPlan;
  sessions: PlannedSession[];
}): Dashboard {
  const baseline = profileDailyBaseline({ body_weight_kg: input.profile.body_weight_kg });
  const base = {
    protein_daily_g: baseline.protein_daily_g,
    protein_daily_g_per_kg: baseline.protein_daily_g_per_kg,
    post_session_protein_g: baseline.post_session_protein_g,
  };

  if (!input.weeklyPlan) {
    return {
      has_plan: false,
      week_start: null,
      week_end: null,
      baseline: base,
      days: [],
      methodology_version: baseline.methodology_version,
    };
  }

  const analysis = analyzeWeek({
    week_start: input.weeklyPlan.week_start,
    rest_days: input.weeklyPlan.rest_days,
    sessions: input.sessions.map((s) => ({
      sport: s.sport,
      intensity: s.intensity,
      start_at: s.start_at,
      distance_km: s.distance_km,
      duration_minutes: s.duration_minutes,
      is_long: s.is_long ?? false,
      needs_detail: s.needs_detail ?? [],
    })),
    profile: {
      body_weight_kg: input.profile.body_weight_kg,
      usual_bottle_ml: input.profile.usual_bottle_ml,
      known_sweat_data: input.profile.known_sweat_data,
    },
  });

  const sessionDays: DashboardDay[] = analysis.days.map((d) => ({
    date: d.date,
    weekday: d.weekday_label,
    is_rest: false,
    sessions: d.sessions.map((s) => ({
      sport: s.sport,
      duration_class: s.duration_class ?? null,
      is_long: s.is_long,
      needs_detail: s.needs_detail.length > 0,
    })),
    carb_g_per_hour: widest(d.sessions.map((s) => s.calc?.estimates.carbohydrate_g_per_hour ?? null)),
    fluid_ml_per_hour: widest(d.sessions.map((s) => s.calc?.estimates.fluid_ml_per_hour ?? null)),
    sodium_mg_per_litre: widest(d.sessions.map((s) => s.calc?.estimates.sodium?.mg_per_litre ?? null)),
  }));

  const restDays: DashboardDay[] = analysis.rest_days.map((date) => {
    const [y, m, dd] = date.split('-').map(Number) as [number, number, number];
    const label = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(y, m - 1, dd).getDay()]!;
    return {
      date,
      weekday: label,
      is_rest: true,
      sessions: [],
      carb_g_per_hour: null,
      fluid_ml_per_hour: null,
      sodium_mg_per_litre: null,
    };
  });

  return {
    has_plan: true,
    week_start: input.weeklyPlan.week_start,
    week_end: weekEndIso(input.weeklyPlan.week_start),
    baseline: base,
    days: [...sessionDays, ...restDays].sort((a, b) => a.date.localeCompare(b.date)),
    methodology_version: analysis.methodology_version,
  };
}
