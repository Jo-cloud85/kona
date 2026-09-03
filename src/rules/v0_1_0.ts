import type { RulesConfig } from './types.js';

/**
 * Kona calculation methodology v0.1.0.
 *
 * Values are the reference-implementation placeholders from
 * CALCULATION_ENGINE_SPEC.md and REQUIRE expert review before public launch.
 *
 * Deviations from the spec text, recorded deliberately:
 *  - Fallback hydration range uses §5.2's 0.4–0.8 L/h (=> 400–800 ml/h). The
 *    §20 example JSON shows 500–800; §5.2 is the substantive guidance and wins.
 *    Noted in CALCULATION_ENGINE_SPEC.md §20 and progress.md.
 */
export const RULES_V0_1_0: RulesConfig = {
  methodology_version: '0.1.0',
  source_ids: [
    'ACSM_FLUID_2007', // PMID 17277604
    'ACSM_AND_DC_2016', // PMID 26891166
    'ISSN_PROTEIN_2017', // PMID 28642676
    'ISSN_NUTRIENT_TIMING_2017', // PMID 28919842
    'NATA_FLUID_2017', // PMID 28985128
  ],

  duration_classes: {
    short_max_min: 60, // < 60 => SHORT
    moderate_max_min: 90, // < 90 => MODERATE
    long_max_min: 150, // <= 150 => LONG, else VERY_LONG
  },

  environment_classes: {
    hot_humid: {
      min_temp_c: 28,
      or_temp_c_with_humidity: { temp_c: 25, humidity_percent: 70 },
    },
    warm: { min_temp_c: 22 },
  },

  pace_estimates_min_per_km: {
    running: { easy: 6.0, moderate: 5.3, hard: 4.6, race: 4.2 },
    cycling: { easy: 2.4, moderate: 2.0, hard: 1.7, race: 1.5 },
  },

  hydration: {
    fallback_fluid_ml_per_hour: { min: 400, max: 800 },
    planning_relevant_from_min: 60,
  },

  carbohydrate: {
    during_relevant_from_min: 60,
    reference_g_per_hour: { min: 30, max: 60 },
    higher_option_g_per_hour: { min: 60, max: 90 },
    higher_option_from_min: 150,
  },

  sodium: {
    reference_mg_per_litre: { min: 500, max: 700 },
  },

  protein: {
    daily_g_per_kg: { min: 1.4, max: 2.0 },
    post_workout_reference_g: { min: 20, max: 40 },
    post_workout_g_per_kg: 0.25,
  },

  safety: {
    flag_overdrinking_on_weight_gain: true,
  },
};
