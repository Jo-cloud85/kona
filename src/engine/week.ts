import type { DurationClass, Intensity, MissingDetail, Sport, TimeOfDay } from '../domain/types';
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
  time_of_day?: TimeOfDay;
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
  time_of_day?: TimeOfDay;
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

export interface SessionPromptOption {
  label: string;
  value: string;
  minutes?: number;
}

/** One under-specified session, with option sets a UI can render as buttons. */
export interface SessionPrompt {
  date: string;
  weekday_label: string;
  sport: Sport;
  /** 0-based index within its day (for same-day double sessions). */
  session_index: number;
  label: string;
  ask_intensity: boolean;
  ask_size: boolean;
  ask_time: boolean;
  intensity_options: SessionPromptOption[];
  size_options: SessionPromptOption[];
  time_options: SessionPromptOption[];
  /** This session is on a key day (long / hard / double) — worth pinning down now. */
  is_key: boolean;
  /** One of the next 1–2 sessions that actually matter. The rest are deferred —
   *  surfaced per-day as they come up, not demanded when the week is saved. */
  in_focus: boolean;
}

/** How many under-specified sessions Kona pins down up front. The rest wait. */
const FOCUS_PROMPT_LIMIT = 2;

const INTENSITY_OPTIONS: SessionPromptOption[] = [
  { label: 'Easy', value: 'easy' },
  { label: 'Moderate', value: 'moderate' },
  { label: 'Hard', value: 'hard' },
];

const SIZE_OPTIONS: SessionPromptOption[] = [
  { label: '~30 min', value: '30 min', minutes: 30 },
  { label: '~45 min', value: '45 min', minutes: 45 },
  { label: '~1 hr', value: '60 min', minutes: 60 },
  { label: '~1.5 hr', value: '90 min', minutes: 90 },
  { label: '~2 hr', value: '120 min', minutes: 120 },
];

const TIME_OPTIONS: SessionPromptOption[] = [
  { label: 'Morning', value: 'morning' },
  { label: 'Afternoon', value: 'afternoon' },
  { label: 'Evening', value: 'evening' },
];

/** Easy-on-the-stomach carbohydrate for a session done before a proper meal. */
const MORNING_PREFUEL =
  'something light and easy to digest 20–30 min before — a banana, a few dates, or toast with jam/honey — rather than a full breakfast';

export interface WeekAnalysis {
  week_start: string;
  days: WeekDay[];
  rest_days: string[];
  key_days: string[];
  /** A day-before / preparation line for EVERY day with a session. */
  recommendation_inputs: WeekRecommendation[];
  /** Free-text questions about under-specified sessions (CLI / text clients). */
  open_questions: WeekQuestion[];
  /** Structured per-session prompts a UI renders as option buttons. */
  session_prompts: SessionPrompt[];
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
  const when = s.time_of_day && !s.needs_detail.includes('time_of_day') ? `${s.time_of_day} ` : '';
  return `${dist}${effort}${when}${s.sport}`.trim();
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

function lightDayPrep(day: WeekDay): WeekRecommendation {
  const primary = day.sessions[0]!;
  return {
    date: day.date,
    weekday_label: day.weekday_label,
    priority: 'low',
    timing: 'day_before',
    category: 'preparation',
    action: `${day.weekday_label}: ${describeSession(primary)} — nothing special to prepare. Normal meals and fluids cover it; put some carbohydrate and protein in the meal afterwards.`,
    reason_codes: ['routine_day'],
  };
}

/** Pre-fuel note keyed off the day's (stated) time of day. Morning sessions are
 *  likely done before a full breakfast, so recommend lighter, quicker carbs. */
function timeOfDayNote(day: WeekDay): string {
  const stated = day.sessions
    .map((s) => (s.needs_detail.includes('time_of_day') ? undefined : s.time_of_day))
    .find((t): t is TimeOfDay => t != null);
  if (stated === 'morning') {
    return ` Morning session — if you train before a proper breakfast, have ${MORNING_PREFUEL}.`;
  }
  if (stated === 'evening') {
    return ` Evening session — you'll have eaten through the day; if it's been 3+ hours, a small carb snack ~1 hr before is enough.`;
  }
  return '';
}

function prepAction(day: WeekDay, profile: CalculateProfile, rules: RulesConfig): WeekRecommendation {
  const bottle = profile.usual_bottle_ml ? `your usual ${profile.usual_bottle_ml} ml bottle` : 'your bottle';
  const base = day.multi_session
    ? doubleSessionPrep(day, bottle, rules)
    : day.sessions.some((s) => s.is_long)
      ? longSessionPrep(day, bottle, rules)
      : day.is_key_day
        ? singleKeyPrep(day, bottle, rules)
        : lightDayPrep(day);
  const note = timeOfDayNote(day);
  return note ? { ...base, action: base.action + note } : base;
}

// --- structured per-session prompts --------------------------------------

const ORDINAL = ['1st', '2nd', '3rd', '4th'];

function buildSessionPrompts(days: WeekDay[]): SessionPrompt[] {
  const prompts: SessionPrompt[] = [];
  for (const day of days) {
    day.sessions.forEach((s, i) => {
      if (s.needs_detail.length === 0) return;
      const suffix = day.sessions.length > 1 ? ` (${ORDINAL[i] ?? `#${i + 1}`})` : '';
      prompts.push({
        date: day.date,
        weekday_label: day.weekday_label,
        sport: s.sport,
        session_index: i,
        label: `${day.weekday_label} ${s.sport}${suffix}`,
        ask_intensity: s.needs_detail.includes('intensity'),
        ask_size: s.needs_detail.includes('duration_or_distance'),
        ask_time: s.needs_detail.includes('time_of_day'),
        intensity_options: INTENSITY_OPTIONS,
        size_options: SIZE_OPTIONS,
        time_options: TIME_OPTIONS,
        is_key: day.is_key_day,
        in_focus: false,
      });
    });
  }
  // Only chase the next 1–2 sessions that matter now: key days first, then
  // soonest. `days` is already date-ordered, so a stable sort by key-ness keeps
  // the earliest key session ahead of a later one. Everything past the limit is
  // deferred — the daily briefing picks those up a day out.
  const ranked = prompts
    .map((p, idx) => ({ p, idx }))
    .sort((a, b) => Number(b.p.is_key) - Number(a.p.is_key) || a.idx - b.idx);
  for (const { p } of ranked.slice(0, FOCUS_PROMPT_LIMIT)) p.in_focus = true;
  return prompts;
}

// --- open questions --------------------------------------------------------

function questionText(sport: Sport, labels: string[], missing: MissingDetail[]): string {
  const days = joinLabels(labels);
  const plural = labels.length > 1;
  const wantsEffort = missing.includes('intensity');
  const wantsSize = missing.includes('duration_or_distance');
  const wantsTime = missing.includes('time_of_day');

  const subject =
    sport === 'gym'
      ? `${days} gym session${plural ? 's' : ''}`
      : `${days} ${sport}${plural ? ' sessions' : ''}`;

  const parts: string[] = [];
  if (wantsEffort) parts.push(`how hard ${plural ? 'they feel' : 'it feels'} (easy, moderate or hard)`);
  if (wantsSize) parts.push(`roughly how long ${plural ? 'they are' : 'it is'} (or what distance)`);
  if (wantsTime) parts.push(`what time of day (morning, afternoon or evening)`);

  if (parts.length === 0) return `For the ${subject}, what's your typical distance or time?`;
  const joined = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `For the ${subject}: ${joined}?`;
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
        time_of_day: s.time_of_day,
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

  // A preparation line for EVERY day that has a session (key days get the
  // detailed advice, the rest get a short "nothing special" line).
  const recommendation_inputs = days
    .filter((d) => d.sessions.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => prepAction(d, input.profile, rules));

  return {
    week_start: input.week_start,
    days,
    rest_days: input.rest_days ?? [],
    key_days: days.filter((d) => d.is_key_day).map((d) => d.date),
    recommendation_inputs,
    open_questions: buildOpenQuestions(days),
    session_prompts: buildSessionPrompts(days),
    methodology_version: rules.methodology_version,
  };
}
