import type { Range, Sport, Intensity } from '../domain/types.js';

/**
 * A versioned, reviewable rules/config table for the calculation engine.
 *
 * CALCULATION_ENGINE_SPEC.md §20: "The production engine should be driven from a
 * versioned, reviewable rules table rather than hard-coded UI logic."
 *
 * Every numeric value the engine emits traces back to a field here. Changing any
 * numeric rule MUST bump `methodology_version` (§19).
 *
 * The values shipped in v0.1.0 are the reference-implementation placeholders from
 * the spec and REQUIRE expert review before public launch.
 */
export interface RulesConfig {
  methodology_version: string;
  /** Source ids attached to every calculation output for traceability (§19). */
  source_ids: string[];

  /** Duration-class cutoffs in minutes (§4.1). Upper bound is exclusive. */
  duration_classes: {
    short_max_min: number; // < this => SHORT
    moderate_max_min: number; // < this => MODERATE
    long_max_min: number; // <= this => LONG, else VERY_LONG
  };

  /**
   * Environment-class thresholds (§4.3). Configurable rather than a single global
   * definition of "hot". Evaluated top-down; first match wins.
   */
  environment_classes: {
    hot_humid: { min_temp_c: number; or_temp_c_with_humidity?: { temp_c: number; humidity_percent: number } };
    warm: { min_temp_c: number };
  };

  /** Estimated pace used ONLY to derive a duration when the user gave distance
   *  but no time. Marked `estimated` and lowers confidence. Not a nutrition rule. */
  pace_estimates_min_per_km: Partial<Record<Sport, Partial<Record<Intensity, number>>>>;

  hydration: {
    /** §5.2 fallback planning range when no measured sweat rate is available. */
    fallback_fluid_ml_per_hour: Range;
    /** Duration (min) at/above which deliberate hydration planning is surfaced. */
    planning_relevant_from_min: number;
  };

  carbohydrate: {
    /** §7.1 — below this, no mandatory during-session carbohydrate target. */
    during_relevant_from_min: number;
    /** §7.2 default reference range for prolonged/harder endurance exercise. */
    reference_g_per_hour: Range;
    /** §7.3 higher option, surfaced only as a note for very long sessions. */
    higher_option_g_per_hour: Range;
    /** Duration (min) at/above which the higher option may be *mentioned*. */
    higher_option_from_min: number;
  };

  sodium: {
    /** §6.3 reference *concentration* used when sweat sodium is unknown. */
    reference_mg_per_litre: Range;
  };

  protein: {
    /** §8.1 daily range, g per kg body weight per day. */
    daily_g_per_kg: Range;
    /** §8.2 practical post-workout reference serving, grams. */
    post_workout_reference_g: Range;
    /** §8.2 alternative per-kg post-workout reference. */
    post_workout_g_per_kg: number;
  };

  /** Safety anchors (§5.3, §18). */
  safety: {
    /** If intake implies body-mass gain during exercise, flag overdrinking. */
    flag_overdrinking_on_weight_gain: boolean;
  };
}
