import type {
  Confidence,
  DurationClass,
  EnvironmentClass,
  IntensityClass,
  PriorityLevel,
  Range,
} from '../domain/types';

/** Structured recommendation the LLM turns into natural language (§17). */
export interface RecommendationInput {
  priority: 'low' | 'medium' | 'high';
  timing:
    | 'day_before'
    | 'pre_workout'
    | 'during'
    | 'immediately_after'
    | 'later_today'
    | 'next_session';
  category: 'preparation' | 'hydration' | 'carbohydrate' | 'sodium' | 'recovery' | 'safety' | 'context';
  action: string;
  reason_codes: string[];
}

export interface FluidEstimate extends Range {
  confidence: Confidence;
  basis: 'measured_sweat_rate' | 'reference_range';
}

export interface CarbohydrateEstimate extends Range {
  confidence: Confidence;
}

export interface SodiumEstimate {
  mode: 'reference_concentration' | 'estimated_loss';
  /** Present in reference_concentration mode. */
  mg_per_litre?: Range;
  /** Present ONLY in estimated_loss mode (requires measured sweat sodium). */
  mg_per_hour?: number;
  confidence: Confidence;
}

/** The MVP output contract (CALCULATION_ENGINE_SPEC.md §20). */
export interface FuelingCalculation {
  session_classification: {
    duration_class: DurationClass;
    intensity_class: IntensityClass;
    environment_class: EnvironmentClass;
    multi_session: boolean;
    resolved_duration_minutes: number;
    duration_estimated: boolean;
  };
  priorities: {
    hydration: PriorityLevel;
    carbohydrate: PriorityLevel;
    sodium: PriorityLevel;
    recovery: PriorityLevel;
    preparation: PriorityLevel;
  };
  estimates: {
    fluid_ml_per_hour: FluidEstimate | null;
    carbohydrate_g_per_hour: CarbohydrateEstimate | null;
    sodium: SodiumEstimate | null;
  };
  recovery: {
    protein_daily_g_per_kg: Range;
    /** null when body weight is not on file yet. */
    protein_daily_g: Range | null;
    post_workout_protein_reference_g: Range;
    /** null when body weight is not on file yet. */
    post_workout_protein_per_kg_g: number | null;
  };
  recommendation_inputs: RecommendationInput[];
  warnings: string[];
  methodology_version: string;
  calculated_at: string;
  confidence: Confidence;
  source_ids: string[];
}
