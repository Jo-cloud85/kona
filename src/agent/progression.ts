import type { ActivityEvent, ActualSession, Sport } from '../domain/types';
import { addDays, isoDate, mondayOf } from './home';

/**
 * "You" screen progression — the Arc/milestone system approved in M26.
 * Deterministic, no LLM involvement, same pattern as insights.ts/briefing.ts:
 * pure functions over already-fetched history. Every number here comes from
 * real stored records — never invented — and Arc-stage advancement is driven
 * only by behaviour/engagement counts (sessions completed, check-ins logged,
 * recommendations adapted), never by pace/PR/outcome quality, per
 * PRODUCT_VISION.md's reward-behaviours-only guardrail.
 */

function dateOf(iso: string): string {
  return iso.slice(0, 10);
}

/** ISO-8601 week key ("2026-W37"), Monday-start, week 1 contains the year's
 *  first Thursday — the standard definition, used only to count distinct
 *  weeks with a completed session, not shown to the athlete directly. */
function isoWeekKey(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thursday of this ISO week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export interface Milestone {
  id: string;
  title: string;
  sport: Sport | null;
  achieved: boolean;
  /** ISO date (YYYY-MM-DD) of the earliest qualifying session, or null when
   *  never achieved — never guessed. */
  date: string | null;
}

interface MilestoneDef {
  id: string;
  title: string;
  sport: Sport | null;
  matches(s: ActualSession): boolean;
}

const RUN_MILESTONES: MilestoneDef[] = [
  {
    id: 'first_5k_run',
    title: 'First 5K',
    sport: 'running',
    matches: (s) => s.sport === 'running' && (s.distance_km ?? 0) >= 5,
  },
  {
    id: 'first_10k_run',
    title: 'First 10K',
    sport: 'running',
    matches: (s) => s.sport === 'running' && (s.distance_km ?? 0) >= 10,
  },
  {
    id: 'first_half_marathon',
    title: 'First half marathon',
    sport: 'running',
    matches: (s) => s.sport === 'running' && (s.distance_km ?? 0) >= 21.1,
  },
];

/** A "brick"/multi-sport day: ≥2 distinct sports sharing a session_group_id. */
function isMultiSportGroup(completed: ActualSession[], groupId: string): boolean {
  const sports = new Set(completed.filter((s) => s.session_group_id === groupId).map((s) => s.sport));
  return sports.size >= 2;
}

function earliestTriathlonDate(completed: ActualSession[]): string | null {
  const dates = completed
    .filter((s) => s.sport === 'triathlon' || (s.session_group_id && isMultiSportGroup(completed, s.session_group_id)))
    .map((s) => dateOf(s.start_at))
    .sort();
  return dates[0] ?? null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The calendar month a Monday-start week "belongs to" — the month
 *  containing that week's Thursday, same ownership convention isoWeekKey
 *  uses for ISO-year assignment, so a week straddling a month boundary is
 *  never split or double-counted between two months. */
function weekOwningMonth(mondayIso: string): string {
  const [y, m, d] = mondayIso.split('-').map(Number) as [number, number, number];
  const thursday = addDays(new Date(y, m - 1, d), 3);
  return `${thursday.getFullYear()}-${String(thursday.getMonth() + 1).padStart(2, '0')}`;
}

function firstCompletedDateInWeek(completed: ActualSession[], monday: string): string | null {
  const sunday = isoDate(addDays(new Date(`${monday}T00:00:00`), 6));
  const dates = completed.map((s) => dateOf(s.start_at)).filter((d) => d >= monday && d <= sunday).sort();
  return dates[0] ?? null;
}

/** "Missing" one week out of a month's is still a consistent month — the
 *  odd sick day or travel week shouldn't reset the whole thing. */
const CONSISTENT_MONTH_MISS_ALLOWANCE = 1;

/** One "Consistent: <Month> <Year>" milestone per calendar month the
 *  athlete has any training history in — not a one-time "first", a
 *  recurring one (founder direction, M27.6), so there's always something
 *  new to earn once the one-time firsts are all done. Qualifies when all
 *  but at most one Monday-start week owned by that month had a completed
 *  session. Flips to achieved live, mid-month, the moment the bar is
 *  cleared — same as every other milestone here, never held back until
 *  the month closes. */
function computeConsistentMonths(actualSessions: ActualSession[], now: Date): Milestone[] {
  const completed = actualSessions.filter((s) => s.status === 'completed');
  if (completed.length === 0) return [];

  const trainedMondays = new Set(completed.map((s) => isoDate(mondayOf(new Date(`${dateOf(s.start_at)}T00:00:00`)))));
  const earliestMonday = [...trainedMondays].sort()[0]!;
  const currentMonday = isoDate(mondayOf(now));

  const mondaysByMonth = new Map<string, string[]>();
  for (let d = earliestMonday; d <= currentMonday; d = isoDate(addDays(new Date(`${d}T00:00:00`), 7))) {
    const monthKey = weekOwningMonth(d);
    const list = mondaysByMonth.get(monthKey);
    if (list) list.push(d);
    else mondaysByMonth.set(monthKey, [d]);
  }

  const results: Milestone[] = [];
  for (const [monthKey, mondays] of [...mondaysByMonth.entries()].sort()) {
    const required = mondays.length - CONSISTENT_MONTH_MISS_ALLOWANCE;
    if (required < 1) continue; // too small a sliver of a month (grid's earliest edge) to fairly judge

    let trainedCount = 0;
    let clinchedMonday: string | null = null;
    for (const monday of mondays) {
      if (trainedMondays.has(monday)) {
        trainedCount++;
        if (trainedCount >= required) {
          clinchedMonday = monday;
          break;
        }
      }
    }

    const [y, m] = monthKey.split('-').map(Number) as [number, number];
    const date = clinchedMonday ? firstCompletedDateInWeek(completed, clinchedMonday) : null;
    results.push({
      id: `consistent_month_${monthKey}`,
      title: `Consistent: ${MONTH_NAMES[m - 1]} ${y}`,
      sport: null,
      achieved: date != null,
      date,
    });
  }
  return results;
}

/** Earliest qualifying ActualSession per milestone shape, over the athlete's
 *  full history. Extensible, not exhaustive — this is a first, small set. */
export function computeMilestones(actualSessions: ActualSession[], now: Date = new Date()): Milestone[] {
  const completed = actualSessions.filter((s) => s.status === 'completed');

  const runMilestones = RUN_MILESTONES.map((def) => {
    const first = completed.filter(def.matches).sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
    return { id: def.id, title: def.title, sport: def.sport, achieved: Boolean(first), date: first ? dateOf(first.start_at) : null };
  });

  const triDate = earliestTriathlonDate(completed);
  return [
    ...runMilestones,
    { id: 'first_triathlon', title: 'First triathlon', sport: 'triathlon' as Sport, achieved: triDate != null, date: triDate },
    ...computeConsistentMonths(actualSessions, now),
  ];
}

// ---------------------------------------------------------------------------
// Arc progression
// ---------------------------------------------------------------------------

export type ArcStageName = 'Foundation' | 'Rhythm' | 'Judgment' | 'Composure' | 'Command';

export interface ArcStage {
  name: ArcStageName;
  complete: boolean;
  current: boolean;
  /** 0-1 progress within this stage, only meaningful when `current`. */
  progress: number;
}

export interface ArcProgress {
  stage: ArcStageName;
  stage_index: number; // 0-4
  stages: ArcStage[];
  /** The raw behavioural counts behind stage placement, surfaced so the UI
   *  can show honest "why you're here" copy instead of a bare bar. */
  metrics: { consistent_weeks: number; checkins_logged: number; adaptations_applied: number };
}

const STAGE_NAMES: ArcStageName[] = ['Foundation', 'Rhythm', 'Judgment', 'Composure', 'Command'];

/** Week threshold per stage — also doubles as the "how far into this stage"
 *  denominator for `progress`. First defensible pass (reuses this codebase's
 *  existing evidence constants — a 3-session minimum, a 5-session window —
 *  for internal consistency); explicitly tunable after alpha feedback. */
const WEEK_THRESHOLD: Record<ArcStageName, number> = {
  Foundation: 0,
  Rhythm: 2,
  Judgment: 6,
  Composure: 12,
  Command: 24, // ~6 months
};

/** Checked from Command down to Rhythm; the first fully-met requirement wins.
 *  Falls through to Foundation when none match — never a gap, and adding
 *  weeks/check-ins/adaptations can only ever move a stage up, never down. */
const REQUIREMENTS: { name: Exclude<ArcStageName, 'Foundation'>; weeks: number; checkins: number; adaptations: number }[] = [
  { name: 'Command', weeks: 24, checkins: 0, adaptations: 3 },
  { name: 'Composure', weeks: 12, checkins: 0, adaptations: 1 },
  { name: 'Judgment', weeks: 6, checkins: 5, adaptations: 0 },
  { name: 'Rhythm', weeks: 2, checkins: 1, adaptations: 0 },
];

function determineStage(weeks: number, checkins: number, adaptations: number): ArcStageName {
  for (const req of REQUIREMENTS) {
    if (weeks >= req.weeks && checkins >= req.checkins && adaptations >= req.adaptations) return req.name;
  }
  return 'Foundation';
}

function countConsistentWeeks(actualSessions: ActualSession[]): number {
  const weeks = new Set<string>();
  for (const s of actualSessions) {
    if (s.status !== 'completed') continue;
    weeks.add(isoWeekKey(dateOf(s.start_at)));
  }
  return weeks.size;
}

function countCheckinDates(events: ActivityEvent[]): number {
  const dates = new Set<string>();
  for (const e of events) {
    if (e.type === 'recovery_logged' || e.type === 'checkin_done') dates.add(dateOf(e.at));
  }
  return dates.size;
}

export function computeArcProgress(input: {
  actualSessions: ActualSession[];
  activityEvents: ActivityEvent[];
  now?: Date;
}): ArcProgress {
  const consistent_weeks = countConsistentWeeks(input.actualSessions);
  const checkins_logged = countCheckinDates(input.activityEvents);
  const adaptations_applied = input.activityEvents.filter((e) => e.type === 'recommendation_adapted').length;

  const stage = determineStage(consistent_weeks, checkins_logged, adaptations_applied);
  const stage_index = STAGE_NAMES.indexOf(stage);

  const stages: ArcStage[] = STAGE_NAMES.map((name, i) => {
    const complete = i < stage_index;
    const current = i === stage_index;
    let progress = 0;
    if (complete) progress = 1;
    else if (current) {
      const isLast = i === STAGE_NAMES.length - 1;
      if (isLast) progress = 1;
      else {
        const from = WEEK_THRESHOLD[name];
        const to = WEEK_THRESHOLD[STAGE_NAMES[i + 1]!];
        progress = to > from ? Math.min(1, Math.max(0, (consistent_weeks - from) / (to - from))) : 0;
      }
    }
    return { name, complete, current, progress };
  });

  return { stage, stage_index, stages, metrics: { consistent_weeks, checkins_logged, adaptations_applied } };
}
