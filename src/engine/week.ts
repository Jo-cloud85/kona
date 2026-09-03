import type { DurationClass, Intensity, MissingDetail, Sport } from '../domain/types';
import { getRules, type RulesConfig } from '../rules/index';
import { calculateFuelingTargets, type CalculateProfile } from './calculate';
import { ClassificationInputError } from './classify';
import type { FuelingCalculation } from './types';

/**
 * Week-level analysis (PRODUCT_VISION.md "Weekly planning", CALCULATION_ENGINE_SPEC.md §9, §11).
 *
 * Identifies double-session days and longer/harder "key" sessions, produces
 * day-before preparation recommendations, and lists the questions Kona should
 * ask about under-specified sessions. All numeric fueling values come from
 * `calculateFuelingTargets` or the rules table; a session that can't be
 * classified (e.g. gym / swim with no distance or duration) is treated as a
 * routine day rather than guessing a duration — Kona asks instead.
 */

export interface WeekSessionInput {
  sport: Sport;
  intensity: Intensity;
  /** ISO-8601 local datetime. */
  start_at: string;
  distance_km?: number;
  duration_minutes?: number;
  /** The user described it as a "long" session (long run, long ride, ...). */
  is_long?: boolean;
  /** What the user left unspecified for this session. */
  needs_detail?: MissingDetail[];
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
  needs_detail: MissingDetail[];
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

export interface WeekQuestion {
  sport: Sport;
  dates: string[];
  weekday_labels: string[];
  missing: MissingDetail[];
  text: string;
}

export interface WeekAnalysis {
  week_start: string;
  days: WeekDay[];
  rest_days: string[];
  key_days: string[];
  recommendation_inputs: WeekRecommendation[];
  /** Questions Kona should ask about sessions the user didn't fully specify. */
  open_questions: WeekQuestion[];
  methodology_version: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CARB_EXAMPLES = 'an easy-to-digest carbohydrate source (a banana, toast, a sports drink, or a couple of gels)';

function weekdayLabel(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  return DAYS[new Date(y, m - 1, d).getDay()]!;
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function proteinRef(rules: RulesConfig): string {
  const p = rules.protein.post_workout_reference_g;
  return `~${p.min}–${p.max} g`;
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
      context: { resistance_training: session.sport === 'gym' },
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
  const effort = s.needs_detail.includes('intensity') ? '' : `${s.intensity} `;
  return `${dist}${effort}${s.sport}`.trim();
}

// --- preparation recommendations ---------------------------------------------

function doubleSessionPrep(day: WeekDay, bottle: string, rules: RulesConfig): WeekRecommendation {
  return {
    date: day.date,
    weekday_label: day.weekday_label,
    priority: 'high',
    timing: 'day_before',
    category: 'preparation',
    action: `${day.weekday_label} is a double-session day and your bigger fueling day. The night before, prepare ${bottle} and ${CARB_EXAMPLES}, and have a recovery meal with carbohydrate and protein (${proteinRef(
      rules,
    )}) ready for after the second session.`,
    reason_codes: ['double_session'],
  };
}

function longSessionPrep(day: WeekDay, bottle: string, rules: RulesConfig): WeekRecommendation {
  const long = day.sessions.find((s) => s.is_long) ?? day.sessions[0]!;
  return {
    date: day.date,
    weekday_label: day.weekday_label,
    priority: 'high',
    timing: 'day_before',
    category: 'preparation',
    action: `${day.weekday_label}'s long ${long.sport} is a big fueling day. Through the day before: eat normal meals with carbohydrate and hydrate steadily across the day — not by drinking a lot right before the start. Have ${bottle} and ${CARB_EXAMPLES} ready, plus a recovery meal with carbohydrate and protein (${proteinRef(
      rules,
    )}) for afterwards. If it's warm, a drink with some sodium and carbohydrate is worth trying for a session this long — cramps have several causes, so treat it as something to test rather than a fix.`,
    reason_codes: ['long_session'],
  };
}

function singleKeyPrep(day: WeekDay, bottle: string, rules: RulesConfig): WeekRecommendation {
  const keySession = [...day.sessions].sort((a, b) => Number(b.is_key) - Number(a.is_key))[0];
  const strength = day.sessions.some((s) => s.sport === 'gym');
  const proteinNote = strength
    ? ` Since it's strength work, make sure the meal afterwards has protein (${proteinRef(rules)}).`
    : '';

  const engineRec = keySession?.calc?.recommendation_inputs.find(
    (r) => r.timing === 'day_before' || r.timing === 'pre_workout',
  );
  if (engineRec) {
    return {
      date: day.date,
      weekday_label: day.weekday_label,
      priority: engineRec.priority,
      timing: 'day_before',
      category: 'preparation',
      action: `${day.weekday_label}: ${engineRec.action}${proteinNote}`,
      reason_codes: [...engineRec.reason_codes, ...(strength ? ['resistance_training'] : [])],
    };
  }
  return {
    date: day.date,
    weekday_label: day.weekday_label,
    priority: 'medium',
    timing: 'day_before',
    category: 'preparation',
    action: `${day.weekday_label}'s ${keySession ? describeSession(keySession) : 'session'} is a key one. The night before, prepare ${bottle} and ${CARB_EXAMPLES}, decide breakfast in advance, and have a recovery meal with carbohydrate and protein ready for afterwards.${proteinNote}`,
    reason_codes: keySession?.is_long ? ['long_session'] : ['key_session'],
  };
}

function prepAction(day: WeekDay, profile: CalculateProfile, rules: RulesConfig): WeekRecommendation {
  const bottle = profile.usual_bottle_ml ? `your usual ${profile.usual_bottle_ml} ml bottle` : 'your bottle';
  if (day.multi_session) return doubleSessionPrep(day, bottle, rules);
  if (day.sessions.some((s) => s.is_long)) return longSessionPrep(day, bottle, rules);
  return singleKeyPrep(day, bottle, rules);
}

// --- open questions --------------------------------------------------------

function questionText(sport: Sport, labels: string[], missing: MissingDetail[]): string {
  const days = joinLabels(labels);
  const plural = labels.length > 1;
  const wantsEffort = missing.includes('intensity');
  const wantsSize = missing.includes('duration_or_distance');

  const subject =
    sport === 'gym'
      ? `${days} gym session${plural ? 's' : ''}`
      : `${days} ${sport}${plural ? ' sessions' : ''}`;

  if (wantsEffort && wantsSize) {
    return `How hard ${plural ? 'do' : 'does'} the ${subject} feel — easy, moderate or hard — and roughly how long ${
      plural ? 'are they' : 'is it'
    } (or what distance)?`;
  }
  if (wantsEffort) {
    return `How hard ${plural ? 'do' : 'does'} the ${subject} feel — easy, moderate or hard?`;
  }
  return `For the ${subject}, what's your typical distance or time?`;
}

function buildOpenQuestions(days: WeekDay[]): WeekQuestion[] {
  const groups = new Map<string, { sport: Sport; dates: string[]; labels: string[]; missing: Set<MissingDetail> }>();
  for (const day of days) {
    for (const s of day.sessions) {
      if (s.needs_detail.length === 0) continue;
      const g = groups.get(s.sport) ?? { sport: s.sport, dates: [], labels: [], missing: new Set() };
      g.dates.push(day.date);
      g.labels.push(day.weekday_label);
      for (const m of s.needs_detail) g.missing.add(m);
      groups.set(s.sport, g);
    }
  }
  return [...groups.values()].map((g) => {
    const missing = [...g.missing];
    return {
      sport: g.sport,
      dates: g.dates,
      weekday_labels: g.labels,
      missing,
      text: questionText(g.sport, g.labels, missing),
    };
  });
}

// --- entry point ---------------------------------------------------------

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
        needs_detail: s.needs_detail ?? [],
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
  const ranked = [...keyDays].sort((a, b) => rankDay(b) - rankDay(a));
  // Top 3 by importance, but never drop a long-session day.
  const chosen = new Map<string, WeekDay>();
  for (const d of ranked.slice(0, 3)) chosen.set(d.date, d);
  for (const d of keyDays) if (d.sessions.some((s) => s.is_long)) chosen.set(d.date, d);
  const recommendation_inputs = [...chosen.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => prepAction(d, input.profile, rules));

  return {
    week_start: input.week_start,
    days,
    rest_days: input.rest_days ?? [],
    key_days: keyDays.map((d) => d.date),
    recommendation_inputs,
    open_questions: buildOpenQuestions(days),
    methodology_version: rules.methodology_version,
  };
}

function rankDay(d: WeekDay): number {
  let score = 0;
  if (d.multi_session) score += 4;
  if (d.sessions.some((s) => s.duration_class === 'VERY_LONG')) score += 3;
  if (d.sessions.some((s) => s.duration_class === 'LONG' || s.is_long || s.is_key)) score += 2;
  if (d.sessions.some((s) => s.intensity === 'hard' || s.intensity === 'race')) score += 1;
  return score;
}
