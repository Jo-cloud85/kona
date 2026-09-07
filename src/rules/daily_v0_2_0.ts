import type { Range } from '../domain/types';

/**
 * Daily-nutrition methodology — a SEPARATE versioned table from the
 * during-session engine (`RULES_V0_1_0`). It broadens Kona past training
 * fuelling into whole-day targets (PRODUCT_VISION / CALCULATION_ENGINE_SPEC
 * updated to note this).
 *
 * Every number here is from published guidance, not invented. It is still an
 * estimate — Kona is a wellness tool, not a clinical service — and outputs are
 * ranges with a confidence flag. Any numeric change bumps `methodology_version`.
 *
 * Sources:
 *  - Mifflin MD, St Jeor ST, et al. A new predictive equation for resting energy
 *    expenditure in healthy individuals. Am J Clin Nutr. 1990. PMID 2305711.
 *  - Thomas DT, Erdman KA, Burke LM. Nutrition and Athletic Performance (ACSM/
 *    AND/DC). Med Sci Sports Exerc. 2016. PMID 26891166. (carbohydrate g/kg,
 *    fat % of energy)
 *  - Jäger R et al. ISSN Position Stand: protein and exercise. 2017. PMID 28642676.
 *  - EFSA Panel. Scientific Opinion on Dietary Reference Values for water. 2010.
 *  - NASEM. Dietary Reference Intakes for Sodium and Potassium. 2019. (sodium AI
 *    1.5 g/day; CDRR < 2.3 g/day)
 *  - U.S. Dietary Guidelines / IOM: dietary fibre 14 g per 1000 kcal.
 */
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'very_active' | 'extra_active';

export interface DailyRules {
  methodology_version: string;
  source_ids: string[];

  /** Mifflin–St Jeor constant term by sex. Unspecified = mean of the two. */
  mifflin_constant: { male: number; female: number; unspecified: number };
  mifflin_per_kg: number; // 10
  mifflin_per_cm: number; // 6.25
  mifflin_per_year: number; // -5

  /** Total-energy multiplier applied to BMR. */
  activity_factor: Record<ActivityLevel, number>;
  /** Half-width of the reported energy range, as a fraction of the point estimate. */
  energy_range_frac: number;

  /** g/kg body weight per day. */
  protein_g_per_kg: Range;
  /** g/kg per day by activity level (ACSM/AND 2016). */
  carb_g_per_kg: Record<ActivityLevel, Range>;
  /** Fat as a fraction of total energy (AMDR). */
  fat_energy_fraction: Range;
  /** Dietary fibre, grams per 1000 kcal. */
  fibre_g_per_1000kcal: number;

  /** Adequate daily fluid intake from drinks, litres, by sex. */
  fluid_l_from_drinks: { male: number; female: number; unspecified: number };
  /** Extra fluid per hour of exercise, litres (mirrors the session engine §5.2). */
  fluid_l_per_exercise_hour: Range;

  sodium: {
    adequate_intake_g: number; // 1.5
    upper_guidance_g: number; // 2.3 (CDRR)
  };
}

export const DAILY_RULES: DailyRules = {
  methodology_version: '0.2.0',
  source_ids: [
    'MIFFLIN_1990', // PMID 2305711
    'ACSM_AND_DC_2016', // PMID 26891166
    'ISSN_PROTEIN_2017', // PMID 28642676
    'EFSA_WATER_2010',
    'NASEM_SODIUM_2019',
    'US_DGA_FIBRE',
  ],

  mifflin_constant: { male: 5, female: -161, unspecified: -78 },
  mifflin_per_kg: 10,
  mifflin_per_cm: 6.25,
  mifflin_per_year: -5,

  activity_factor: {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    very_active: 1.725,
    extra_active: 1.9,
  },
  energy_range_frac: 0.08,

  protein_g_per_kg: { min: 1.4, max: 2.0 },
  carb_g_per_kg: {
    sedentary: { min: 3, max: 5 },
    light: { min: 3, max: 5 },
    moderate: { min: 5, max: 7 },
    very_active: { min: 6, max: 10 },
    extra_active: { min: 8, max: 10 },
  },
  fat_energy_fraction: { min: 0.2, max: 0.35 },
  fibre_g_per_1000kcal: 14,

  fluid_l_from_drinks: { male: 2.5, female: 2.0, unspecified: 2.2 },
  fluid_l_per_exercise_hour: { min: 0.4, max: 0.8 },

  sodium: { adequate_intake_g: 1.5, upper_guidance_g: 2.3 },
};
