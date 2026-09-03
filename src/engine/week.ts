import type { DurationClass, Intensity, Sport } from '../domain/types';
import { getRules } from '../rules/index';
import { calculateFuelingTargets, type CalculateProfile } from './calculate';
import { ClassificationInputError } from './classify';
import type { FuelingCalculation } from './types';

/**
 * Week-level analysis (PRODUCT_VISION.md "Weekly planning", CALCULATION_ENGINE_SPEC.md §9, §11).
 *
 * Identifies double-session days and longer/harder "key" sessions, then produces
 * day-before preparation recommendations. All numeric fueling values come from
 * `calculateFuelingTargets`; when a session can't be classified (e.g. a gym or
 * swim entry with no distance or duration) it is treated as a routine day rather
 * than guessing a duration.
 */

export interface WeekSessionInput {
  sport: Sport;
  intensity: Intensity;
  /** ISO-8601 local datetime. */
  start_at: string;
  distance_km?: number;
  duration_minutes?: number;
  /** The user described it as a "long" session without giving a distance. */
  is_long?: boolean;
}

export interface WeekAnalysisInput {
  week_start: string;
  sessions: WeekSessionInput[];
  profile: CalculateProfile;
  rest_days?: string[];
  methodology_version?: string;
}

export interface WeekDaySession {
  sport: Sport;
  intensity: Intensity;
  distance_km?: number;
  duration_class?: DurationClass;
  is_long: boolean;
  is_key: boolean;
  /** Present only when the session could be classified. */
  calc?: FuelingCalculation;
}

export interface WeekDay {
  date: string; // YYYY-MM-DD
  weekday_label: string;
  multi_session: boolean;
  is_key_day: boolean;
  sessions: WeekDaySession[];
}

export interface WeekRecommendation {
  date: string;
  weekday_label: string;
  priority: 'low' | 'medium' | 'high';
  timing: 'day_before';
  category: 'preparation';
  action: string;
  reason_codes: string[];
}

export interface WeekAnalysis {
  week_start: string;
  days: WeekDay[];
  rest_days: string[];
  key_days: string[];
  recommendation_inputs: WeekRecommendation[];
  methodology_version: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function weekdayLabel(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  return DAYS[new Date(y, m - 1, d).getDay()]!;
}

function tryCalc(
  session: WeekSessionInput,
  profile: CalculateProfile,
  multiSession: boolean,
  methodologyVersion: string | undefined,
): FuelingCalculation | undefined {
  try {
    return calculateFuelingTargets({
      session: {
        sport: session.sport,
        intensity: session.intensity,
        distance_km: session.distance_km,
        duration_minutes: session.duration_minutes,
        multi_session: multiSession,
        start_at: session.start_at,
      },
      profile,
      phase: 'planning',
      methodology_version: methodologyVersion,
    });
  } catch (err) {
    if (err instanceof ClassificationInputError) return undefined;
    throw err;
  }
}

function sessionIsKey(s: WeekSessionInput, calc: FuelingCalculation | undefined): boolean {
  if (s.is_long) return true;
  if (s.intensity === 'hard' || s.intensity === 'race') return true;
  const cls = calc?.session_classification.duration_class;
  return cls === 'LONG' || cls === 'VERY_LONG';
}

function describeSession(s: WeekDaySession): string {
  const dist = s.distance_km ? `${s.distance_km} km ` : '';
  return `${dist}${s.intensity} ${s.sport}`.trim();
}

function prepAction(day: WeekDay, profile: CalculateProfile): WeekRecommendation {
  const bottle = profile.usual_bottle_ml ? `your usual ${profile.usual_bottle_ml} ml bottle` : 'your bottle';
  const label = day.weekday_label;

  if (day.multi_session) {
    return {
      date: day.date,
      weekday_label: label,
      priority: 'high',
      timing: 'day_before',
      category: 'preparation',
      action: `${label} is a double-session day and your bigger fueling day. The night before, prepare ${bottle} and an easy carbohydrate option, and have a proper recovery meal available for after the second session.`,
      reason_codes: ['double_session'],
    };
  }

  // Single key session — prefer the engine's own prep line when we could classify it.
  const keySession = [...day.sessions].sort((a, b) => Number(b.is_key) - Number(a.is_key))[0];
  const engineRec = keySession?.calc?.recommendation_inputs.find(
    (r) => r.timing === 'day_before' || r.timing === 'pre_workout',
  );
  if (engineRec) {
    return {
      date: day.date,
      weekday_label: label,
      priority: engineRec.priority,
      timing: 'day_before',
      category: 'preparation',
      action: `${label}: ${engineRec.action}`,
      reason_codes: engineRec.reason_codes,
    };
  }

  return {
    date: day.date,
    weekday_label: label,
    priority: 'medium',
    timing: 'day_before',
    category: 'preparation',
    action: `${label}'s ${keySession ? describeSession(keySession) : 'session'} is a key one. The night before, prepare ${bottle} and an easy carbohydrate option, decide breakfast in advance, and have a recovery meal ready for afterwards.`,
    reason_codes: keySession?.is_long ? ['long_session'] : ['key_session'],
  };
}

export function analyzeWeek(input: WeekAnalysisInput): WeekAnalysis {
  const rules = getRules(input.methodology_version);
  const byDate = new Map<string, WeekSessionInput[]>();
  for (const s of input.sessions) {
    const date = s.start_at.slice(0, 10);
    const bucket = byDate.get(date);
    if (bucket) bucket.push(s);
    else byDate.set(date, [s]);
  }

  const days: WeekDay[] = [];
  for (const [date, sessions] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const multi = sessions.length > 1;
    const daySessions: WeekDaySession[] = sessions.map((s) => {
      const calc = tryCalc(s, input.profile, multi, input.methodology_version);
      return {
        sport: s.sport,
        intensity: s.intensity,
        distance_km: s.distance_km,
        duration_class: calc?.session_classification.duration_class,
        is_long: s.is_long ?? false,
        is_key: sessionIsKey(s, calc),
        calc,
      };
    });
    days.push({
      date,
      weekday_label: weekdayLabel(date),
      multi_session: multi,
      is_key_day: multi || daySessions.some((s) => s.is_key),
      sessions: daySessions,
    });
  }

  const keyDays = days.filter((d) => d.is_key_day);
  // Biggest first: double sessions, then a LONG/VERY_LONG session, then hard.
  const ranked = [...keyDays].sort((a, b) => rankDay(b) - rankDay(a));
  const recommendation_inputs = ranked.slice(0, 3).map((d) => prepAction(d, input.profile));

  return {
    week_start: input.week_start,
    days,
    rest_days: input.rest_days ?? [],
    key_days: keyDays.map((d) => d.date),
    recommendation_inputs,
    methodology_version: rules.methodology_version,
  };
}

function rankDay(d: WeekDay): number {
  let score = 0;
  if (d.multi_session) score += 4;
  if (d.sessions.some((s) => s.duration_class === 'VERY_LONG')) score += 3;
  if (d.sessions.some((s) => s.duration_class === 'LONG' || s.is_key)) score += 2;
  if (d.sessions.some((s) => s.intensity === 'hard' || s.intensity === 'race')) score += 1;
  return score;
}
