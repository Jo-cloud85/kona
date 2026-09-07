import type { ActivityLevel, Gender, Range } from '../domain/types';
import { getDailyRules } from '../rules/index';

/**
 * Whole-day nutrition targets, estimated from the Mifflin–St Jeor resting-energy
 * equation × an activity factor, with macro ranges from ACSM/AND/ISSN guidance
 * (see `src/rules/daily_v0_2_0.ts` for every constant + its source).
 *
 * These are ESTIMATES with a confidence flag, not prescriptions. Sodium is left
 * as guidance text, not a computed target (CALCULATION_ENGINE_SPEC.md §6.4).
 */

export interface DailyNutritionInput {
  body_weight_kg: number;
  height_cm?: number;
  age?: number;
  gender?: Gender;
  activity_level?: ActivityLevel;
  /** Fallback for activity_level when it isn't set. */
  typical_weekly_sessions?: number;
}

export interface DailyNutrition {
  energy_kcal: Range;
  protein_g: Range;
  protein_g_per_kg: Range;
  carbohydrate_g: Range;
  carbohydrate_g_per_kg: Range;
  fat_g: Range;
  fibre_g: number;
  /** Daily fluid from drinks (litres); add more per hour of exercise. */
  fluid_l: Range;
  fluid_l_per_exercise_hour: Range;
  sodium_guidance: { adequate_intake_g: number; upper_guidance_g: number };
  activity_level: ActivityLevel;
  activity_level_assumed: boolean;
  methodology_version: string;
  source_ids: string[];
  confidence: 'high' | 'moderate' | 'low';
  assumptions: string[];
}

const DEFAULT_HEIGHT_CM = 170;

export function activityFromSessions(sessions: number | undefined): ActivityLevel {
  if (sessions == null) return 'moderate';
  if (sessions <= 1) return 'sedentary';
  if (sessions <= 3) return 'light';
  if (sessions <= 5) return 'moderate';
  if (sessions <= 7) return 'very_active';
  return 'extra_active';
}

function roundRange(r: Range, digits = 0): Range {
  const f = 10 ** digits;
  return { min: Math.round(r.min * f) / f, max: Math.round(r.max * f) / f };
}

export function dailyNutrition(input: DailyNutritionInput): DailyNutrition {
  const rules = getDailyRules();
  const assumptions: string[] = [];

  const weight = input.body_weight_kg;
  const height = input.height_cm ?? DEFAULT_HEIGHT_CM;
  if (input.height_cm == null) assumptions.push(`Height not given — assumed ${DEFAULT_HEIGHT_CM} cm.`);
  const age = input.age ?? 35;
  if (input.age == null) assumptions.push('Age not given — assumed 35.');

  const genderKey: 'male' | 'female' | 'unspecified' =
    input.gender === 'male' ? 'male' : input.gender === 'female' ? 'female' : 'unspecified';
  if (genderKey === 'unspecified') {
    assumptions.push('Sex not specified — used the average of the male/female equation constants.');
  }

  const activity_level = input.activity_level ?? activityFromSessions(input.typical_weekly_sessions);
  const activity_level_assumed = input.activity_level == null;
  if (activity_level_assumed) {
    assumptions.push(`Activity level not set — inferred "${activity_level}" from ~${input.typical_weekly_sessions ?? '?'} sessions/week.`);
  }

  // Mifflin–St Jeor resting energy, then a whole-day activity factor.
  const bmr =
    rules.mifflin_per_kg * weight +
    rules.mifflin_per_cm * height +
    rules.mifflin_per_year * age +
    rules.mifflin_constant[genderKey];
  const tdee = bmr * rules.activity_factor[activity_level];
  const energy_kcal = roundRange(
    { min: tdee * (1 - rules.energy_range_frac), max: tdee * (1 + rules.energy_range_frac) },
    -1, // nearest 10
  );

  const protein_g_per_kg = { ...rules.protein_g_per_kg };
  const carbohydrate_g_per_kg = { ...rules.carb_g_per_kg[activity_level] };

  const protein_g = roundRange({ min: weight * protein_g_per_kg.min, max: weight * protein_g_per_kg.max });
  const carbohydrate_g = roundRange({
    min: weight * carbohydrate_g_per_kg.min,
    max: weight * carbohydrate_g_per_kg.max,
  });
  const fat_g = roundRange({
    min: (energy_kcal.min * rules.fat_energy_fraction.min) / 9,
    max: (energy_kcal.max * rules.fat_energy_fraction.max) / 9,
  });
  const fibre_g = Math.round((rules.fibre_g_per_1000kcal * ((energy_kcal.min + energy_kcal.max) / 2)) / 1000);

  const fluidBase = rules.fluid_l_from_drinks[genderKey];
  const fluid_l = roundRange({ min: fluidBase - 0.3, max: fluidBase + 0.3 }, 1);

  const confidence: DailyNutrition['confidence'] =
    input.height_cm != null && input.age != null && genderKey !== 'unspecified' && !activity_level_assumed
      ? 'moderate'
      : 'low';

  return {
    energy_kcal,
    protein_g,
    protein_g_per_kg,
    carbohydrate_g,
    carbohydrate_g_per_kg,
    fat_g,
    fibre_g,
    fluid_l,
    fluid_l_per_exercise_hour: { ...rules.fluid_l_per_exercise_hour },
    sodium_guidance: {
      adequate_intake_g: rules.sodium.adequate_intake_g,
      upper_guidance_g: rules.sodium.upper_guidance_g,
    },
    activity_level,
    activity_level_assumed,
    methodology_version: rules.methodology_version,
    source_ids: [...rules.source_ids],
    confidence,
    assumptions,
  };
}
