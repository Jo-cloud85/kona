import type { Confidence, Environment, Intensity, Range, Sport } from '../domain/types';
import { getRules, type RulesConfig } from '../rules/index';
import { classifySession, type ClassificationResult } from './classify';
import { atLeast, clampScore, toLevel, type PriorityScore } from './priority';
import type {
  CarbohydrateEstimate,
  FluidEstimate,
  FuelingCalculation,
  RecommendationInput,
  SodiumEstimate,
} from './types';

export interface CalculateProfile {
  /** Optional — protein/recovery numbers are omitted until it's on file. */
  body_weight_kg?: number;
  usual_bottle_ml?: number;
  known_sweat_data?: {
    environment_class: ClassificationResult['environment_class'];
    sweat_rate_l_per_h: number;
    sweat_sodium_mg_per_l?: number;
  }[];
}

export interface CalculateInput {
  session: {
    sport: Sport;
    intensity: Intensity;
    duration_minutes?: number;
    distance_km?: number;
    environment?: Environment;
    multi_session?: boolean;
    /** ISO-8601 local start; used only to detect an early start. */
    start_at?: string;
  };
  profile: CalculateProfile;
  /** Whether we are preparing for a session or reviewing a completed one. */
  phase?: 'planning' | 'post_workout';
  /** Measured intake / body-mass change for a post-workout review. */
  actual?: {
    fluid_ml?: number;
    pre_weight_kg?: number;
    post_weight_kg?: number;
  };
  context?: {
    reason_for_modification?: string;
    injury_or_pain?: boolean;
    resistance_training?: boolean;
    poor_sleep?: boolean;
  };
  methodology_version?: string;
}

const EARLY_START_HOUR = 8;

function roundRange(r: Range, digits = 0): Range {
  const f = 10 ** digits;
  return { min: Math.round(r.min * f) / f, max: Math.round(r.max * f) / f };
}

function isEarlyStart(startAt: string | undefined): boolean {
  if (!startAt) return false;
  const match = /T(\d{2}):/.exec(startAt);
  if (!match) return false;
  return Number(match[1]) < EARLY_START_HOUR;
}

function pickSweatData(profile: CalculateProfile, envClass: ClassificationResult['environment_class']) {
  const all = profile.known_sweat_data ?? [];
  return all.find((d) => d.environment_class === envClass) ?? all[0];
}

// ---------------------------------------------------------------------------
// Priority model (§4.4). Numeric 0..3 internally.
// ---------------------------------------------------------------------------

function durationBase(cls: ClassificationResult['duration_class']): PriorityScore {
  switch (cls) {
    case 'SHORT':
      return 1;
    case 'MODERATE':
      return 2;
    case 'LONG':
      return 2;
    case 'VERY_LONG':
      return 3;
  }
}

function computePriorities(
  c: ClassificationResult,
  input: CalculateInput,
): { hydration: PriorityScore; carbohydrate: PriorityScore; sodium: PriorityScore; recovery: PriorityScore; preparation: PriorityScore } {
  const hard = c.intensity_class === 'HARD' || c.intensity_class === 'RACE';
  const long = c.duration_class === 'LONG' || c.duration_class === 'VERY_LONG';
  const hot = c.environment_class === 'HOT_HUMID';
  const warm = c.environment_class === 'WARM';
  const minutes = c.resolved_duration_minutes;

  // Hydration
  let hydration = durationBase(c.duration_class);
  if (warm) hydration += 1;
  if (hot) hydration += 2;
  if (hard && minutes >= 60) hydration += 1;
  if (c.multi_session) hydration = atLeast(hydration, 2);

  // Carbohydrate — no mandatory during-session target below the threshold (§7.1)
  let carbohydrate: PriorityScore = 0;
  if (minutes >= getRulesForInput(input).carbohydrate.during_relevant_from_min) {
    carbohydrate = c.duration_class === 'VERY_LONG' ? 3 : 2;
    if (hard) carbohydrate += 1;
  }

  // Sodium — never mandatory for every workout (§6.1)
  let sodium: PriorityScore = c.duration_class === 'VERY_LONG' ? 2 : long ? 1 : 0;
  if (hot) sodium += 1;
  if (warm && long) sodium += 1;
  if (c.multi_session) sodium += 1;
  const sweat = pickSweatData(input.profile, c.environment_class);
  if (sweat?.sweat_sodium_mg_per_l) sodium = atLeast(sodium, 2);

  // Recovery
  let recovery = durationBase(c.duration_class);
  if (input.context?.resistance_training) recovery = atLeast(recovery + 1, 2);
  if (c.multi_session) recovery += 1;
  if (hard && long) recovery += 1;

  // Preparation
  let preparation: PriorityScore = c.duration_class === 'SHORT' ? 1 : long ? 3 : 2;
  if (isEarlyStart(input.session.start_at) && long) preparation = 3;
  if (c.multi_session) preparation = 3;
  if (hot) preparation += 1;

  return {
    hydration: clampScore(hydration),
    carbohydrate: clampScore(carbohydrate),
    sodium: clampScore(sodium),
    recovery: clampScore(recovery),
    preparation: clampScore(preparation),
  };
}

function getRulesForInput(input: CalculateInput): RulesConfig {
  return getRules(input.methodology_version);
}

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

function hydrationEstimate(
  c: ClassificationResult,
  input: CalculateInput,
  rules: RulesConfig,
): FluidEstimate | null {
  const relevant =
    c.resolved_duration_minutes >= rules.hydration.planning_relevant_from_min ||
    c.environment_class === 'WARM' ||
    c.environment_class === 'HOT_HUMID' ||
    c.multi_session;
  if (!relevant) return null;

  const sweat = pickSweatData(input.profile, c.environment_class);
  if (sweat?.sweat_rate_l_per_h) {
    const ml = sweat.sweat_rate_l_per_h * 1000;
    return {
      ...roundRange({ min: ml * 0.9, max: ml * 1.1 }),
      confidence: 'high',
      basis: 'measured_sweat_rate',
    };
  }
  return {
    ...rules.hydration.fallback_fluid_ml_per_hour,
    confidence: 'low',
    basis: 'reference_range',
  };
}

function carbohydrateEstimate(
  score: PriorityScore,
  c: ClassificationResult,
  rules: RulesConfig,
): CarbohydrateEstimate | null {
  if (score <= 0) return null;
  return {
    ...rules.carbohydrate.reference_g_per_hour,
    confidence: c.duration_estimated ? 'low' : 'moderate',
  };
}

function sodiumEstimate(
  score: PriorityScore,
  c: ClassificationResult,
  input: CalculateInput,
  rules: RulesConfig,
): SodiumEstimate | null {
  if (score <= 0) return null;
  const sweat = pickSweatData(input.profile, c.environment_class);
  if (sweat?.sweat_rate_l_per_h && sweat.sweat_sodium_mg_per_l) {
    return {
      mode: 'estimated_loss',
      mg_per_hour: Math.round(sweat.sweat_rate_l_per_h * sweat.sweat_sodium_mg_per_l),
      confidence: 'moderate',
    };
  }
  return {
    mode: 'reference_concentration',
    mg_per_litre: { ...rules.sodium.reference_mg_per_litre },
    confidence: 'low',
  };
}

// ---------------------------------------------------------------------------
// Recommendation inputs (§9, §17)
// ---------------------------------------------------------------------------

function fmtRange(r: Range, unit: string): string {
  return `${r.min}–${r.max} ${unit}`;
}

function buildRecommendations(
  c: ClassificationResult,
  input: CalculateInput,
  priorities: ReturnType<typeof computePriorities>,
  estimates: FuelingCalculation['estimates'],
  bottleMl: number | undefined,
): RecommendationInput[] {
  const recs: RecommendationInput[] = [];
  const phase = input.phase ?? 'planning';
  const long = c.duration_class === 'LONG' || c.duration_class === 'VERY_LONG';
  const early = isEarlyStart(input.session.start_at);

  if (phase === 'post_workout') {
    if (input.context?.injury_or_pain) {
      const reason = input.context.reason_for_modification
        ? ` (${input.context.reason_for_modification})`
        : '';
      recs.push({
        priority: 'high',
        timing: 'immediately_after',
        category: 'safety',
        action: `You cut the session short because of pain${reason}. Treat that as the priority: don't try to make up the missed distance now, and if it stays sore, is painful to load, or gets worse, have it assessed by a health professional.`,
        reason_codes: ['pain_or_injury', 'stopped_early'],
      });
    }
    if (priorities.recovery >= 2) {
      recs.push({
        priority: 'medium',
        timing: 'immediately_after',
        category: 'recovery',
        action: `Have a normal meal with carbohydrate and protein within a few hours; a practical protein reference is about ${fmtRange(
          { min: 20, max: 40 },
          'g',
        )}.`,
        reason_codes: ['completed_session'],
      });
    }
    if (input.context?.poor_sleep) {
      recs.push({
        priority: 'low',
        timing: 'later_today',
        category: 'context',
        action:
          'Poor sleep can make a normal session feel harder. Noting it as context — not treating it as evidence of under-fueling.',
        reason_codes: ['poor_sleep'],
      });
    }
    return recs;
  }

  // planning phase
  if (priorities.preparation >= 2) {
    const bottle = bottleMl ? `your usual ${bottleMl} ml bottle` : 'your bottle';
    recs.push({
      priority: priorities.preparation >= 3 ? 'high' : 'medium',
      timing: 'day_before',
      category: 'preparation',
      action: `Prepare ${bottle}${
        priorities.carbohydrate > 0
          ? ' and an easy-to-digest carbohydrate source (a banana, toast, a sports drink, or a couple of gels)'
          : ''
      } the night before${early ? ', and decide your breakfast in advance' : ''}. Have a familiar recovery meal available for afterwards, and avoid trying several new products at once.`,
      reason_codes: [long ? 'long_session' : 'session_prep', ...(early ? ['early_start'] : [])],
    });
  }

  if (priorities.hydration >= 1) {
    const fluid = estimates.fluid_ml_per_hour;
    const tail = fluid
      ? ` For the session itself, ${fmtRange(fluid, 'ml')} of fluid per hour is a ${
          fluid.basis === 'measured_sweat_rate' ? 'personalised' : 'starting'
        } reference — adjust to thirst and conditions.`
      : '';
    recs.push({
      priority: priorities.hydration >= 3 ? 'high' : 'medium',
      timing: 'pre_workout',
      category: 'hydration',
      action: `Hydrate normally across the day so you don't start already dehydrated.${tail}`,
      reason_codes: [c.environment_class === 'HOT_HUMID' ? 'hot_humid' : 'routine_hydration'],
    });
  }

  if (priorities.carbohydrate >= 1 && estimates.carbohydrate_g_per_hour) {
    recs.push({
      priority: priorities.carbohydrate >= 3 ? 'high' : 'medium',
      timing: 'during',
      category: 'carbohydrate',
      action: `For a session this long, a practical starting range is ${fmtRange(
        estimates.carbohydrate_g_per_hour,
        'g',
      )} of carbohydrate per hour — plan your gels/food around that rather than counting every gram.`,
      reason_codes: ['long_session'],
    });
  }

  if (priorities.sodium >= 2 && estimates.sodium) {
    const s = estimates.sodium;
    const detail =
      s.mode === 'estimated_loss' && s.mg_per_hour
        ? `your measured sweat data suggests roughly ${s.mg_per_hour} mg sodium lost per hour — a guide, not a 1:1 replacement target`
        : s.mg_per_litre
          ? `a reasonable starting point is an electrolyte drink providing roughly ${fmtRange(
              s.mg_per_litre,
              'mg',
            )} sodium per litre of fluid`
          : 'a sodium-containing drink may be useful';
    recs.push({
      priority: priorities.sodium >= 3 ? 'high' : 'medium',
      timing: 'during',
      category: 'sodium',
      action: `A sodium-containing drink may be useful for this session; ${detail}. This is a starting reference, not a measured requirement.`,
      reason_codes: ['prolonged_or_hot'],
    });
  }

  return recs;
}

// ---------------------------------------------------------------------------
// Confidence (§16)
// ---------------------------------------------------------------------------

function overallConfidence(c: ClassificationResult, usedMeasuredSweat: boolean): Confidence {
  if (usedMeasuredSweat && !c.duration_estimated) return 'high';
  if (c.duration_estimated && c.environment_class === 'UNKNOWN') return 'low';
  return 'moderate';
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function calculateFuelingTargets(input: CalculateInput): FuelingCalculation {
  const rules = getRulesForInput(input);
  const c = classifySession(
    {
      sport: input.session.sport,
      intensity: input.session.intensity,
      duration_minutes: input.session.duration_minutes,
      distance_km: input.session.distance_km,
      environment: input.session.environment,
      multi_session: input.session.multi_session,
    },
    rules,
  );

  const priorities = computePriorities(c, input);
  const fluid = hydrationEstimate(c, input, rules);
  const carbohydrate = carbohydrateEstimate(priorities.carbohydrate, c, rules);
  const sodium = sodiumEstimate(priorities.sodium, c, input, rules);
  const estimates: FuelingCalculation['estimates'] = {
    fluid_ml_per_hour: fluid,
    carbohydrate_g_per_hour: carbohydrate,
    sodium,
  };

  const warnings: string[] = [...c.notes];
  if (c.duration_estimated) {
    warnings.push('Duration was estimated from distance; treat the numbers as a rough starting point.');
  }
  if (input.context?.poor_sleep && (input.phase ?? 'planning') === 'planning') {
    warnings.push('Poor sleep noted as context only; it does not change fueling targets.');
  }

  // Overdrinking safety check (§5.3, test 16)
  if (
    rules.safety.flag_overdrinking_on_weight_gain &&
    typeof input.actual?.pre_weight_kg === 'number' &&
    typeof input.actual?.post_weight_kg === 'number' &&
    input.actual.post_weight_kg > input.actual.pre_weight_kg
  ) {
    warnings.push(
      'Reported body mass increased during exercise, which can indicate overdrinking. More fluid is not automatically better — do not increase fluid intake based on this session.',
    );
  }

  const bottleMl = input.profile.usual_bottle_ml;
  const recommendation_inputs = buildRecommendations(c, input, priorities, estimates, bottleMl);

  const weight = input.profile.body_weight_kg;
  const usedMeasuredSweat = fluid?.basis === 'measured_sweat_rate';

  return {
    session_classification: {
      duration_class: c.duration_class,
      intensity_class: c.intensity_class,
      environment_class: c.environment_class,
      multi_session: c.multi_session,
      resolved_duration_minutes: c.resolved_duration_minutes,
      duration_estimated: c.duration_estimated,
    },
    priorities: {
      hydration: toLevel(priorities.hydration),
      carbohydrate: toLevel(priorities.carbohydrate),
      sodium: toLevel(priorities.sodium),
      recovery: toLevel(priorities.recovery),
      preparation: toLevel(priorities.preparation),
    },
    estimates,
    recovery: {
      protein_daily_g_per_kg: { ...rules.protein.daily_g_per_kg },
      protein_daily_g:
        typeof weight === 'number'
          ? roundRange({
              min: weight * rules.protein.daily_g_per_kg.min,
              max: weight * rules.protein.daily_g_per_kg.max,
            })
          : null,
      post_workout_protein_reference_g: { ...rules.protein.post_workout_reference_g },
      post_workout_protein_per_kg_g:
        typeof weight === 'number' ? Math.round(weight * rules.protein.post_workout_g_per_kg) : null,
    },
    recommendation_inputs,
    warnings,
    methodology_version: rules.methodology_version,
    calculated_at: new Date().toISOString(),
    confidence: overallConfidence(c, usedMeasuredSweat),
    source_ids: [...rules.source_ids],
  };
}
