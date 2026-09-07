import type { DietaryRestriction, Profile, Range } from '../domain/types';
import { dailyNutrition, type DailyNutrition } from '../engine/index';
import { foodsFor, type FoodItem, type MacroRole } from '../data/foods';

/**
 * The "Daily" tab payload: whole-day targets (from the engine) plus a few
 * illustrative food examples per macro, filtered by the user's dietary
 * restrictions. The foods are examples of what a target looks like — not a
 * prescribed menu.
 */

export interface FoodIdea {
  name: string;
  /** grams of THIS macro the portion provides. */
  amount_g: number;
}

export interface MacroIdeas {
  macro: MacroRole;
  label: string;
  target_g: Range;
  per_kg?: Range;
  items: FoodIdea[];
}

export interface DailyPlan {
  nutrition: DailyNutrition;
  macros: MacroIdeas[];
  fluid_text: string;
  sodium_text: string;
  note: string;
}

const MACRO_G: Record<MacroRole, keyof Pick<FoodItem, 'protein_g' | 'carb_g' | 'fat_g' | 'fibre_g'>> = {
  protein: 'protein_g',
  carb: 'carb_g',
  fat: 'fat_g',
  fibre: 'fibre_g',
};

/** Deterministic daily rotation so the examples vary day to day but are stable within a day. */
function rotate<T>(arr: T[], by: number, count: number): T[] {
  if (arr.length === 0) return [];
  const start = ((by % arr.length) + arr.length) % arr.length;
  return Array.from({ length: Math.min(count, arr.length) }, (_, i) => arr[(start + i) % arr.length]!);
}

export function buildDaily(profile: Profile, now: Date = new Date()): DailyPlan {
  const nutrition = dailyNutrition({
    body_weight_kg: profile.body_weight_kg,
    height_cm: profile.height_cm,
    age: profile.age,
    gender: profile.gender,
    activity_level: profile.activity_level,
    typical_weekly_sessions: profile.typical_weekly_sessions,
  });

  const restrictions: readonly DietaryRestriction[] = profile.dietary_restrictions ?? [];
  const dayIndex = Math.floor(now.getTime() / 86_400_000);

  const macros: MacroIdeas[] = (
    [
      ['protein', 'Protein', nutrition.protein_g, nutrition.protein_g_per_kg],
      ['carb', 'Carbohydrate', nutrition.carbohydrate_g, nutrition.carbohydrate_g_per_kg],
      ['fat', 'Fat', nutrition.fat_g, undefined],
      ['fibre', 'Fibre', { min: nutrition.fibre_g, max: nutrition.fibre_g }, undefined],
    ] as [MacroRole, string, Range, Range | undefined][]
  ).map(([macro, label, target_g, per_kg]) => {
    const key = MACRO_G[macro];
    const pool = foodsFor(macro, restrictions).filter((f) => (f[key] ?? 0) > 0);
    return {
      macro,
      label,
      target_g,
      per_kg,
      items: rotate(pool, dayIndex + macro.length, 5).map((f) => ({ name: f.name, amount_g: f[key] ?? 0 })),
    };
  });

  const fluidBase = ((nutrition.fluid_l.min + nutrition.fluid_l.max) / 2).toFixed(1);
  const cups = Math.round(((nutrition.fluid_l.min + nutrition.fluid_l.max) / 2 * 1000) / 250);
  const fluid_text = `About ${fluidBase} L from drinks a day (~${cups} cups). Add roughly 1–2 cups per hour of training, and more in heat — go by thirst and pale-yellow urine, not a fixed number.`;

  const dr = restrictions.length ? ` (respecting: ${restrictions.map((r) => r.replace(/_/g, ' ')).join(', ')})` : '';
  const sodium_text = `Sodium isn't a personalised target here. General adequate intake is about ${nutrition.sodium_guidance.adequate_intake_g} g/day, and staying under ~${nutrition.sodium_guidance.upper_guidance_g} g/day is within guidance. If you sweat heavily you lose more — top that up around sessions, not by salting everything.`;

  return {
    nutrition,
    macros,
    fluid_text,
    sodium_text,
    note: `Estimated from the Mifflin–St Jeor equation and your activity level${dr}. Ranges from general sports-nutrition guidance (methodology v${nutrition.methodology_version}), not exact targets — confidence: ${nutrition.confidence}. Foods are examples of what the targets look like, not a meal plan.`,
  };
}
