import type { PlannedSession, Profile, Range, WeeklyPlan } from '../domain/types';
import { buildDashboard } from './dashboard';
import { addDays, dayOfMonth, durationLabel, isoDate, joinList, mondayOf, sportLabel, titleFor, weekdayFull, weekdayLabel } from './home';

/**
 * "Your week" — the week plan as a page, not a dashboard (product UI pass,
 * 2026-09). Training sessions and key days stay visually dominant; nutrition
 * numbers are per-session references, not daily totals. Every field here is
 * read straight from {@link buildDashboard} and the stored plan — no new
 * persistence, no new calculation, just a week-shaped view of what Home
 * already knows.
 */

export interface WeekDayView {
  date: string;
  weekday: string;
  day_of_month: number;
  is_today: boolean;
  is_rest: boolean;
  is_key_day: boolean;
  is_double: boolean;
  /** null when nothing is known about this day yet (outside the stored plan). */
  title: string | null;
  duration_label: string | null;
  fuelling: { carb_g_per_hour: Range; fluid_ml_per_hour: Range } | null;
}

export interface WeekView {
  has_plan: boolean;
  range_label: string | null;
  session_count: number;
  rest_count: number;
  protein_daily_g: Range | null;
  key_days_label: string | null;
  days: WeekDayView[];
  footnote: string;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortMonth(iso: string): string {
  return MONTH_SHORT[Number(iso.slice(5, 7)) - 1]!;
}

function rangeLabel(startIso: string, endIso: string): string {
  const sd = dayOfMonth(startIso);
  const ed = dayOfMonth(endIso);
  const sm = shortMonth(startIso);
  const em = shortMonth(endIso);
  return sm === em ? `${sd} – ${ed} ${em}` : `${sd} ${sm} – ${ed} ${em}`;
}

export function buildWeek(input: { profile: Profile; weeklyPlan?: WeeklyPlan; sessions: PlannedSession[]; now?: Date }): WeekView {
  const now = input.now ?? new Date();
  const monday = mondayOf(now);

  const byDate = new Map<string, PlannedSession[]>();
  for (const s of input.sessions) {
    const key = s.start_at.slice(0, 10);
    const bucket = byDate.get(key);
    if (bucket) bucket.push(s);
    else byDate.set(key, [s]);
  }

  const dashboard = buildDashboard({ profile: input.profile, weeklyPlan: input.weeklyPlan, sessions: input.sessions });
  const dashByDate = new Map(dashboard.days.map((d) => [d.date, d]));

  const restSet = new Set(input.weeklyPlan?.rest_days ?? []);
  const hasPlan = input.weeklyPlan != null;

  const days: WeekDayView[] = Array.from({ length: 7 }, (_, i) => {
    const date = isoDate(addDays(monday, i));
    const sessions = byDate.get(date) ?? [];
    const isRest = restSet.has(date);
    const dashDay = dashByDate.get(date);

    let title: string | null = null;
    if (sessions.length > 1) {
      title = joinList(sessions.map((s) => sportLabel(s.sport))).replace(/^\w/, (c) => c.toUpperCase());
    } else if (sessions.length === 1) {
      title = titleFor(sessions[0]!);
    } else if (isRest) {
      title = 'Rest';
    } else if (hasPlan) {
      title = null; // open day — nothing told to Kona yet
    }

    const fuelling =
      dashDay && (dashDay.carb_g_per_hour || dashDay.fluid_ml_per_hour)
        ? {
            carb_g_per_hour: dashDay.carb_g_per_hour ?? { min: 0, max: 0 },
            fluid_ml_per_hour: dashDay.fluid_ml_per_hour ?? { min: 0, max: 0 },
          }
        : null;

    return {
      date,
      weekday: weekdayLabel(date),
      day_of_month: dayOfMonth(date),
      is_today: date === isoDate(now),
      is_rest: isRest,
      is_key_day: dashDay?.is_key_day ?? false,
      is_double: sessions.length > 1,
      title,
      duration_label: sessions.length === 1 ? durationLabel(sessions[0]!) : null,
      fuelling,
    };
  });

  const weekEnd = isoDate(addDays(monday, 6));
  const keyDays = days.filter((d) => d.is_key_day).map((d) => weekdayFull(d.date));

  return {
    has_plan: hasPlan,
    range_label: hasPlan ? rangeLabel(isoDate(monday), weekEnd) : null,
    session_count: input.sessions.length,
    rest_count: days.filter((d) => d.is_rest).length,
    protein_daily_g: dashboard.baseline.protein_daily_g,
    key_days_label: keyDays.length ? joinList(keyDays) : null,
    days,
    footnote: 'Ranges are references for the session, not daily totals. Tell Kona in chat if the week changes.',
  };
}
