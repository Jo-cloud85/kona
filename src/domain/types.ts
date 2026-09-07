/**
 * Shared domain types for Kona.
 *
 * These describe structured facts the system stores and passes between layers.
 * Numerical fueling targets are NEVER produced here or by the LLM — they come
 * only from the deterministic calculation engine (see src/engine).
 */

// ---------------------------------------------------------------------------
// Provenance / certainty (ARCHITECTURE.md "Structured information classes",
// CALCULATION_ENGINE_SPEC.md §15)
// ---------------------------------------------------------------------------

export type Certainty =
  | 'known' // packaged product label, measured value
  | 'user_reported' // the user told us
  | 'estimated' // engine/food estimate, ranges
  | 'inferred' // derived from other facts
  | 'recommended'; // an action Kona suggests

// ---------------------------------------------------------------------------
// Session vocabulary (CALCULATION_ENGINE_SPEC.md §3, §4)
// ---------------------------------------------------------------------------

export type Sport =
  | 'running'
  | 'cycling'
  | 'swimming'
  | 'gym'
  | 'climbing'
  | 'hyrox'
  | 'triathlon'
  | 'other';

export type Intensity = 'easy' | 'moderate' | 'hard' | 'race';

export type PreFedState = 'fed' | 'fasted' | 'unknown';

export type IndoorOutdoor = 'indoor' | 'outdoor' | 'unknown';

export type HeatAcclimatization = 'unknown' | 'partial' | 'acclimatized';

export interface Environment {
  temperature_c?: number;
  humidity_percent?: number;
  indoor_outdoor?: IndoorOutdoor;
  sun_exposure?: 'low' | 'moderate' | 'high';
  heat_acclimatization?: HeatAcclimatization;
}

/** The status of an *actual* session relative to what was planned. */
export type ActualStatus = 'completed' | 'modified' | 'skipped' | 'stopped_early';

// ---------------------------------------------------------------------------
// Profile (CALCULATION_ENGINE_SPEC.md §3.1)
// ---------------------------------------------------------------------------

export interface KnownSweatData {
  /** Environment class this measurement applies to. */
  environment_class: EnvironmentClass;
  sweat_rate_l_per_h: number;
  sweat_sodium_mg_per_l?: number;
}

export type Gender = 'female' | 'male' | 'nonbinary' | 'other' | 'prefer_not_to_say';

/** Subjective 1–5 self-ratings from onboarding. 5 = excellent for sleep/hydration;
 *  5 = a lot / excessive for sweat. Context for the companion, NOT a calc input. */
export interface SelfPerception {
  sleep_quality: number; // 1–5
  hydration: number; // 1–5
  sweat_level: number; // 1–5 (5 = heavy sweater)
}

export interface Profile {
  user_id: string;
  /** Required for the calculation engine (protein targets). */
  body_weight_kg: number;
  usual_sports: Sport[];
  usual_bottle_ml?: number;
  typical_weekly_sessions?: number;
  known_sweat_data?: KnownSweatData[];
  /** Product ids (see data/products.ts) the user commonly uses. */
  preferred_product_ids?: string[];

  // Onboarding background — helps the companion, not the numbers.
  username?: string;
  gender?: Gender;
  age?: number;
  /** Free text: injuries or cramps in the last month, or empty. */
  recent_injuries_note?: string;
  self_perception?: SelfPerception;
  /** Set once the user has completed onboarding. */
  onboarded_at?: string;
}

// ---------------------------------------------------------------------------
// Planned vs actual sessions (kept as SEPARATE records — PRODUCT_VISION.md,
// CALCULATION_ENGINE_SPEC.md §10)
// ---------------------------------------------------------------------------

/** Details the user did not give for a planned session, so Kona can ask. */
export type MissingDetail = 'intensity' | 'duration_or_distance';

export interface SessionInputCore {
  sport: Sport;
  /** ISO-8601 local datetime for the session start. */
  start_at: string;
  duration_minutes?: number;
  distance_km?: number;
  intensity: Intensity;
  pre_fed_state?: PreFedState;
  environment?: Environment;
  /** 0-based order within a same-day linked group. */
  sequence_index?: number;
  /** Shared id for same-day linked sessions. */
  session_group_id?: string;
  /** The user described it as a "long" session (long run, long ride, ...). */
  is_long?: boolean;
  /** What the user left unspecified. When non-empty, Kona should ask. */
  needs_detail?: MissingDetail[];
  notes?: string;
}

export interface PlannedSession extends SessionInputCore {
  id: string;
  user_id: string;
  kind: 'planned';
  /** Set when this session belongs to a saved weekly plan. */
  weekly_plan_id?: string;
  created_at: string;
}

export interface ActualSession extends SessionInputCore {
  id: string;
  user_id: string;
  kind: 'actual';
  /** Link back to the plan this session was executed against, if any. */
  planned_session_id?: string;
  status: ActualStatus;
  /** Free-text reason for a modified/skipped/stopped_early session. Stored separately. */
  reason?: string;
  created_at: string;
}

export type AnySession = PlannedSession | ActualSession;

// ---------------------------------------------------------------------------
// Weekly plan (PRODUCT_VISION.md "Weekly planning", ARCHITECTURE.md)
// ---------------------------------------------------------------------------

/**
 * A saved week. The individual sessions live as normal PlannedSession records
 * (linked back via `weekly_plan_id`), so actual-vs-planned comparison works the
 * same way as for a single planned session.
 */
export interface WeeklyPlan {
  id: string;
  user_id: string;
  /** ISO date (YYYY-MM-DD) of the Monday the week starts. */
  week_start: string;
  /** The sentence the user gave, kept verbatim for reference. */
  source_text?: string;
  /** ISO dates (YYYY-MM-DD) the user explicitly called rest/off days. */
  rest_days: string[];
  created_at: string;
}

// ---------------------------------------------------------------------------
// Fuel logs (CALCULATION_ENGINE_SPEC.md §3.4, §14)
// ---------------------------------------------------------------------------

export interface FuelItem {
  /** What the user said, verbatim-ish. */
  description: string;
  /** Resolved catalog product id, when we recognised a branded product. */
  product_id?: string;
  quantity?: number;
  fluid_ml?: number;
  /** Known/estimated nutrition. `null` means "not known — do not invent". */
  carbohydrate_g?: number | null;
  sodium_mg?: number | null;
  protein_g?: number | null;
  /** For estimated foods: a range instead of a point value. */
  carbohydrate_g_range?: Range;
  protein_g_range?: Range;
  certainty: Certainty;
  note?: string;
}

export interface FuelLog {
  id: string;
  user_id: string;
  /** The actual session this intake is associated with, if any. */
  session_id?: string;
  logged_at: string;
  items: FuelItem[];
}

// ---------------------------------------------------------------------------
// Recovery logs (PRODUCT_VISION.md "Recovery language", CALCULATION_ENGINE_SPEC.md §12)
// ---------------------------------------------------------------------------

export type RecoverySeverity = 'none' | 'low' | 'moderate' | 'high';

export interface RecoveryLog {
  id: string;
  user_id: string;
  session_id?: string;
  logged_at: string;
  /** What the user actually said. The primary record — kept human. */
  free_text: string;
  /** Optional coarse structured severity for later pattern-spotting. */
  overall_severity?: RecoverySeverity;
  /** Named symptoms the user reported (e.g. "left hip discomfort"). No diagnosis. */
  reported_symptoms?: string[];
  sleep_quality?: 'poor' | 'ok' | 'good' | 'unknown';
}

// ---------------------------------------------------------------------------
// Personal memory (ARCHITECTURE.md §5, AGENT_SPEC.md "Memory behaviour")
// ---------------------------------------------------------------------------

export interface MemoryCandidate {
  user_id: string;
  key: string;
  value: string;
  certainty: Certainty;
  source: 'conversation';
  proposed_at: string;
}

export interface PersistedMemory extends MemoryCandidate {
  id: string;
  status: 'active';
  persisted_at: string;
}

// ---------------------------------------------------------------------------
// Conversation persistence (ARCHITECTURE.md §6)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

/** A row for the conversation history list. */
export interface ConversationSummary {
  id: string;
  /** Derived from the first user message. */
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Engine value objects
// ---------------------------------------------------------------------------

export interface Range {
  min: number;
  max: number;
}

export type Confidence = 'high' | 'moderate' | 'low';

export type DurationClass = 'SHORT' | 'MODERATE' | 'LONG' | 'VERY_LONG';

export type IntensityClass = 'EASY' | 'MODERATE' | 'HARD' | 'RACE';

export type EnvironmentClass = 'COOL_OR_NORMAL' | 'WARM' | 'HOT_HUMID' | 'UNKNOWN';

export type PriorityLevel = 'NONE' | 'LOW' | 'MODERATE' | 'HIGH';
