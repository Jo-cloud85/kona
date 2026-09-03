import { describe, expect, it } from 'vitest';
import { analyzeWeek, type WeekSessionInput } from '../../src/engine/index';

const profile = { body_weight_kg: 64, usual_bottle_ml: 750 };

// Week of Mon 2026-09-07.
function s(date: string, over: Partial<WeekSessionInput>): WeekSessionInput {
  return { sport: 'running', intensity: 'easy', start_at: `${date}T07:00:00`, ...over };
}

describe('analyzeWeek', () => {
  it('flags a double-session day and makes it the top preparation priority', () => {
    const a = analyzeWeek({
      week_start: '2026-09-07',
      sessions: [
        s('2026-09-07', { sport: 'gym', intensity: 'easy', duration_minutes: 45 }),
        s('2026-09-11', { sport: 'cycling', intensity: 'moderate', start_at: '2026-09-11T07:00:00' }),
        s('2026-09-11', { sport: 'running', intensity: 'easy', start_at: '2026-09-11T17:00:00' }),
      ],
      profile,
    });

    const friday = a.days.find((d) => d.date === '2026-09-11')!;
    expect(friday.multi_session).toBe(true);
    expect(friday.is_key_day).toBe(true);
    expect(a.key_days).toContain('2026-09-11');

    const rec = a.recommendation_inputs[0]!;
    expect(rec.date).toBe('2026-09-11');
    expect(rec.action).toMatch(/double-session/i);
    expect(rec.action).toMatch(/750 ml bottle/);
    expect(rec.action).toMatch(/after the second session/i);
  });

  it('flags a "long run" (no distance) as a key day without inventing a duration', () => {
    const a = analyzeWeek({
      week_start: '2026-09-07',
      sessions: [s('2026-09-13', { is_long: true, start_at: '2026-09-13T07:00:00' })],
      profile,
    });
    const sunday = a.days.find((d) => d.date === '2026-09-13')!;
    expect(sunday.is_key_day).toBe(true);
    expect(sunday.sessions[0]!.duration_class).toBeUndefined(); // could not classify — not guessed
    expect(a.recommendation_inputs.some((r) => r.date === '2026-09-13')).toBe(true);
  });

  it('does not flag an easy short single session', () => {
    const a = analyzeWeek({
      week_start: '2026-09-07',
      sessions: [s('2026-09-08', { sport: 'gym', intensity: 'easy', duration_minutes: 40 })],
      profile,
    });
    expect(a.days[0]!.is_key_day).toBe(false);
    expect(a.key_days).toHaveLength(0);
    expect(a.recommendation_inputs).toHaveLength(0);
  });

  it('uses the engine\'s own numbers for a long run that has a distance', () => {
    const a = analyzeWeek({
      week_start: '2026-09-07',
      sessions: [s('2026-09-13', { distance_km: 20, is_long: true, start_at: '2026-09-13T07:00:00' })],
      profile,
    });
    const sun = a.days.find((d) => d.date === '2026-09-13')!.sessions[0]!;
    expect(sun.duration_class).toBe('LONG');
    expect(sun.calc?.estimates.carbohydrate_g_per_hour).toMatchObject({ min: 30, max: 60 });
    // week recommendation reuses the engine's day-before line
    expect(a.recommendation_inputs.find((r) => r.date === '2026-09-13')?.action).toMatch(/Sun:/);
  });

  it('stamps the methodology version', () => {
    const a = analyzeWeek({ week_start: '2026-09-07', sessions: [], profile });
    expect(a.methodology_version).toBe('0.1.0');
  });
});
