import type { ActualSession, FuelLog, PersistedMemory, Profile, Range, RecoveryLog, PlannedSession, WeeklyPlan } from '../domain/types';
import { buildDashboard } from './dashboard';
import { deriveInsights } from './insights';
import { titleFor, weekdayFull } from './home';
import { DEFAULT_TZ, localDateOf, localTimeOf } from '../domain/time';

/**
 * A single session's post-session recap ("1i" in the reference set) — what
 * actually happened that day, read back from what's already stored. Only
 * meaningful for a day with a logged actual session; there is nothing to
 * recap for a day that's only planned or has nothing on record.
 *
 * Two deliberate departures from the reference screens (documented so they
 * don't read as bugs):
 *  - "Carbs/hr" shows the planned TARGET, not a computed actual-consumption
 *    figure — Kona doesn't compute real grams-per-hour from logged fuel items
 *    (a "2 gels" entry has no reliable gram value unless it matched a known
 *    product), so showing one would be inventing a number.
 *  - The Kona commentary never claims something as specific as "your last 4km
 *    were your slowest" — there is no per-km split data anywhere in this app.
 *    It's grounded instead in the linked insight (if any) or the check-in
 *    itself, both real, stored text.
 */

export interface SessionRecap {
  date: string;
  weekday_full: string;
  title: string;
  /** The check-in "feel" pill (e.g. "Solid grind"), when a check-in exists for this day. */
  feel_label: string | null;
  /** HH:MM the session or check-in was logged, local. */
  logged_at_time: string | null;
  distance_km: number | null;
  distance_label: string | null;
  /** "1:44" style, when duration is known. */
  duration_label: string | null;
  /** The planned reference range for this day, relabeled — not an actual-consumption figure. */
  carb_target_g_per_hour: Range | null;
  kona_note: string;
  logged: {
    fuel_carried: string | null;
    pains: string | null;
    went_as_planned: boolean | null;
  };
  /** The insight this session most recently contributed evidence to, if any. */
  memory: { text: string; evidence: string[] } | null;
}

interface ParsedCheckin {
  feel: string;
  went_as_planned: boolean;
  pains: boolean;
  notes: string | null;
}

/** Reads back the structured fields buildCheckinLog() wrote into free_text.
 *  Returns null for a recovery log that isn't from the check-in flow (plain
 *  chat free text) — nothing to parse out of that reliably. */
function parseCheckin(free_text: string): ParsedCheckin | null {
  if (!free_text.startsWith('End-of-day check-in')) return null;
  const feel = /legs felt (\w+)/.exec(free_text)?.[1];
  const plannedMatch = /Went as planned: (yes|no)/.exec(free_text)?.[1];
  const painsMatch = /Injuries \/ cramps \/ pains: (yes|no)/.exec(free_text)?.[1];
  if (!feel || !plannedMatch || !painsMatch) return null;
  const notes = /Notes: (.+)$/.exec(free_text)?.[1] ?? null;
  return { feel, went_as_planned: plannedMatch === 'yes', pains: painsMatch === 'yes', notes };
}

function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function buildSessionRecap(input: {
  profile: Profile;
  date: string;
  /** The athlete's IANA timezone — recovery/fuel logs are stored as true UTC
   *  instants, so bucketing them onto `date` (an athlete-local calendar day)
   *  needs it. Defaults to UTC (the old behaviour) if not given. */
  tz?: string;
  weeklyPlan?: WeeklyPlan;
  plannedSessions: PlannedSession[];
  actualSessions: ActualSession[];
  recoveryLogs: RecoveryLog[];
  fuelLogs: FuelLog[];
  memories: PersistedMemory[];
}): SessionRecap | null {
  const tz = input.tz ?? DEFAULT_TZ;
  // start_at is already a naive athlete-local datetime (resolved by the chat
  // LLM against its own local "now" — see src/domain/time.ts), so this
  // comparison needs no tz conversion; only the UTC-instant fields below do.
  const actual = input.actualSessions.find((a) => a.start_at.slice(0, 10) === input.date);
  if (!actual) return null;

  const dayRecovery = input.recoveryLogs
    .filter((r) => localDateOf(r.logged_at, tz) === input.date)
    .sort((a, b) => b.logged_at.localeCompare(a.logged_at));
  const checkinLog = dayRecovery.map((r) => ({ r, parsed: parseCheckin(r.free_text) })).find((x) => x.parsed);
  const checkin = checkinLog?.parsed ?? null;

  const dayFuel = input.fuelLogs.filter((f) => localDateOf(f.logged_at, tz) === input.date);
  const fuel_carried = dayFuel.length
    ? dayFuel
        .flatMap((f) => f.items)
        .map((i) => `${i.quantity ?? 1} ${i.description}`)
        .join(' · ')
    : null;

  const dashboard = buildDashboard({ profile: input.profile, weeklyPlan: input.weeklyPlan, sessions: input.plannedSessions });
  const dashDay = dashboard.days.find((d) => d.date === input.date);

  const insights = deriveInsights({
    actualSessions: input.actualSessions,
    recoveryLogs: input.recoveryLogs,
    fuelLogs: input.fuelLogs,
    memories: input.memories,
  });
  const linked = insights.find((i) => i.as_of === input.date) ?? null;

  const kona_note =
    linked?.text ??
    (checkin?.pains
      ? "You flagged some pain afterwards — keep an eye on it, and get it looked at if it lingers. Kona doesn't diagnose."
      : checkin?.went_as_planned === false
        ? "This one didn't go quite as planned — it's on record for what it's worth."
        : 'Logged — nothing here changes what comes next.');

  return {
    date: input.date,
    weekday_full: weekdayFull(input.date),
    title: titleFor(actual),
    feel_label: checkin ? checkin.feel.charAt(0).toUpperCase() + checkin.feel.slice(1) : null,
    logged_at_time: actual.created_at
      ? localTimeOf(actual.created_at, tz)
      : checkinLog
        ? localTimeOf(checkinLog.r.logged_at, tz)
        : null,
    distance_km: actual.distance_km ?? null,
    distance_label: actual.distance_label ?? null,
    duration_label: actual.duration_minutes ? hm(actual.duration_minutes) : null,
    carb_target_g_per_hour: dashDay?.carb_g_per_hour ?? null,
    kona_note,
    logged: {
      fuel_carried,
      pains: checkin ? (checkin.pains ? (checkin.notes ?? 'Yes') : null) : null,
      went_as_planned: checkin?.went_as_planned ?? null,
    },
    memory: linked ? { text: linked.text, evidence: linked.evidence } : null,
  };
}
