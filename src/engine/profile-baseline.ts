import type { Range } from '../domain/types';
import { getRules } from '../rules/index';

/**
 * A profile-level daily baseline, used for the onboarding summary. Every value
 * comes from the versioned rules table — nothing is invented here.
 *
 * Note the honest limits: only PROTEIN has a real daily target (weight-based,
 * CALCULATION_ENGINE_SPEC.md §8.1). Daily fluid and sodium are NOT fixed
 * numbers — the engine only defines *training* references (§5.2, §6.3), so those
 * are reported as per-session starting points, not daily requirements.
 */
export interface ProfileDailyBaseline {
  protein_daily_g_per_kg: Range;
  /** null when body weight is not on file yet. */
  protein_daily_g: Range | null;
  post_session_protein_g: Range;
  /** During-exercise starting reference (not a daily total). */
  training_fluid_ml_per_hour: Range;
  /** Reference sodium *concentration* for long/hot sessions (not a daily total). */
  training_sodium_mg_per_litre: Range;
  methodology_version: string;
  notes: string[];
}

function roundRange(r: Range): Range {
  return { min: Math.round(r.min), max: Math.round(r.max) };
}

export function profileDailyBaseline(input: {
  body_weight_kg?: number;
  methodology_version?: string;
}): ProfileDailyBaseline {
  const rules = getRules(input.methodology_version);
  const w = input.body_weight_kg;

  return {
    protein_daily_g_per_kg: { ...rules.protein.daily_g_per_kg },
    protein_daily_g:
      typeof w === 'number'
        ? roundRange({
            min: w * rules.protein.daily_g_per_kg.min,
            max: w * rules.protein.daily_g_per_kg.max,
          })
        : null,
    post_session_protein_g: { ...rules.protein.post_workout_reference_g },
    training_fluid_ml_per_hour: { ...rules.hydration.fallback_fluid_ml_per_hour },
    training_sodium_mg_per_litre: { ...rules.sodium.reference_mg_per_litre },
    methodology_version: rules.methodology_version,
    notes: [
      'Protein is a daily target from body weight; actual needs vary with goals, body composition and energy intake.',
      'Fluid and sodium are not fixed daily numbers — they depend on each session, its length and the conditions.',
    ],
  };
}
