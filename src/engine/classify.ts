import type {
  DurationClass,
  Environment,
  EnvironmentClass,
  Intensity,
  IntensityClass,
  Sport,
} from '../domain/types.js';
import type { RulesConfig } from '../rules/index.js';

export interface ClassifyInput {
  sport: Sport;
  intensity: Intensity;
  duration_minutes?: number;
  distance_km?: number;
  environment?: Environment;
  /** Set when this session is part of a same-day linked group (§11). */
  multi_session?: boolean;
}

export interface ClassificationResult {
  duration_class: DurationClass;
  intensity_class: IntensityClass;
  environment_class: EnvironmentClass;
  multi_session: boolean;
  /** Minutes actually used for bucketing. */
  resolved_duration_minutes: number;
  /** True when duration was derived from distance via a pace estimate. */
  duration_estimated: boolean;
  notes: string[];
}

export class ClassificationInputError extends Error {}

const INTENSITY_TO_CLASS: Record<Intensity, IntensityClass> = {
  easy: 'EASY',
  moderate: 'MODERATE',
  hard: 'HARD',
  race: 'RACE',
};

function resolveDuration(
  input: ClassifyInput,
  rules: RulesConfig,
): { minutes: number; estimated: boolean; note?: string } {
  if (typeof input.duration_minutes === 'number' && input.duration_minutes > 0) {
    return { minutes: input.duration_minutes, estimated: false };
  }
  if (typeof input.distance_km === 'number' && input.distance_km > 0) {
    const pace = rules.pace_estimates_min_per_km[input.sport]?.[input.intensity];
    if (pace) {
      const minutes = Math.round(input.distance_km * pace);
      return {
        minutes,
        estimated: true,
        note: `Duration estimated as ~${minutes} min from ${input.distance_km} km at a reference ${pace} min/km ${input.intensity} ${input.sport} pace.`,
      };
    }
  }
  throw new ClassificationInputError(
    'Cannot classify session: provide either duration_minutes or a distance_km for a sport with a known pace estimate.',
  );
}

export function classifyDuration(minutes: number, rules: RulesConfig): DurationClass {
  const { short_max_min, moderate_max_min, long_max_min } = rules.duration_classes;
  if (minutes < short_max_min) return 'SHORT';
  if (minutes < moderate_max_min) return 'MODERATE';
  if (minutes <= long_max_min) return 'LONG';
  return 'VERY_LONG';
}

export function classifyEnvironment(env: Environment | undefined, rules: RulesConfig): EnvironmentClass {
  if (!env || typeof env.temperature_c !== 'number') return 'UNKNOWN';
  const { hot_humid, warm } = rules.environment_classes;
  const temp = env.temperature_c;
  if (temp >= hot_humid.min_temp_c) return 'HOT_HUMID';
  const combo = hot_humid.or_temp_c_with_humidity;
  if (
    combo &&
    typeof env.humidity_percent === 'number' &&
    temp >= combo.temp_c &&
    env.humidity_percent >= combo.humidity_percent
  ) {
    return 'HOT_HUMID';
  }
  if (temp >= warm.min_temp_c) return 'WARM';
  return 'COOL_OR_NORMAL';
}

export function classifySession(input: ClassifyInput, rules: RulesConfig): ClassificationResult {
  const duration = resolveDuration(input, rules);
  const notes: string[] = [];
  if (duration.note) notes.push(duration.note);

  return {
    duration_class: classifyDuration(duration.minutes, rules),
    intensity_class: INTENSITY_TO_CLASS[input.intensity],
    environment_class: classifyEnvironment(input.environment, rules),
    multi_session: input.multi_session ?? false,
    resolved_duration_minutes: duration.minutes,
    duration_estimated: duration.estimated,
    notes,
  };
}
