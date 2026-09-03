import { describe, expect, it } from 'vitest';
import { classifySession, ClassificationInputError } from '../../src/engine/index.js';
import { getRules } from '../../src/rules/index.js';

const rules = getRules();

describe('classifySession', () => {
  it('buckets duration into SHORT/MODERATE/LONG/VERY_LONG', () => {
    expect(classifySession({ sport: 'gym', intensity: 'easy', duration_minutes: 40 }, rules).duration_class).toBe(
      'SHORT',
    );
    expect(
      classifySession({ sport: 'running', intensity: 'moderate', duration_minutes: 75 }, rules).duration_class,
    ).toBe('MODERATE');
    expect(
      classifySession({ sport: 'running', intensity: 'moderate', duration_minutes: 110 }, rules).duration_class,
    ).toBe('LONG');
    expect(
      classifySession({ sport: 'cycling', intensity: 'easy', duration_minutes: 200 }, rules).duration_class,
    ).toBe('VERY_LONG');
  });

  it('estimates duration from distance when time is not given, and flags it', () => {
    const result = classifySession({ sport: 'running', intensity: 'easy', distance_km: 18 }, rules);
    // 18 km * 6.0 min/km = 108 min => LONG
    expect(result.resolved_duration_minutes).toBe(108);
    expect(result.duration_class).toBe('LONG');
    expect(result.duration_estimated).toBe(true);
    expect(result.notes.join(' ')).toMatch(/estimated/i);
  });

  it('throws when neither duration nor a usable distance is provided', () => {
    expect(() => classifySession({ sport: 'swimming', intensity: 'easy' }, rules)).toThrow(
      ClassificationInputError,
    );
  });

  it('classifies environment with configurable thresholds', () => {
    expect(classifySession({ sport: 'running', intensity: 'easy', duration_minutes: 60 }, rules).environment_class).toBe(
      'UNKNOWN',
    );
    expect(
      classifySession(
        { sport: 'running', intensity: 'easy', duration_minutes: 60, environment: { temperature_c: 15 } },
        rules,
      ).environment_class,
    ).toBe('COOL_OR_NORMAL');
    expect(
      classifySession(
        { sport: 'running', intensity: 'easy', duration_minutes: 60, environment: { temperature_c: 24 } },
        rules,
      ).environment_class,
    ).toBe('WARM');
    expect(
      classifySession(
        { sport: 'running', intensity: 'easy', duration_minutes: 60, environment: { temperature_c: 30 } },
        rules,
      ).environment_class,
    ).toBe('HOT_HUMID');
    expect(
      classifySession(
        {
          sport: 'running',
          intensity: 'easy',
          duration_minutes: 60,
          environment: { temperature_c: 26, humidity_percent: 75 },
        },
        rules,
      ).environment_class,
    ).toBe('HOT_HUMID');
  });
});
