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

    // one prep line per session-day, and Friday's is the double-session one
    expect(a.recommendation_inputs.map((r) => r.date)).toEqual(['2026-09-07', '2026-09-11']);
    const rec = a.recommendation_inputs.find((r) => r.date === '2026-09-11')!;
    expect(rec.priority).toBe('high');
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

  it('gives an easy short single session a low-priority "nothing special" line', () => {
    const a = analyzeWeek({
      week_start: '2026-09-07',
      sessions: [s('2026-09-08', { sport: 'gym', intensity: 'easy', duration_minutes: 40 })],
      profile,
    });
    expect(a.days[0]!.is_key_day).toBe(false);
    expect(a.key_days).toHaveLength(0);
    expect(a.recommendation_inputs).toHaveLength(1);
    expect(a.recommendation_inputs[0]).toMatchObject({ priority: 'low', reason_codes: ['routine_day'] });
    expect(a.recommendation_inputs[0]!.action).toMatch(/nothing special to prepare/i);
  });

  it('classifies a long run that has a distance and gives fuller day-before advice', () => {
    const a = analyzeWeek({
      week_start: '2026-09-07',
      sessions: [s('2026-09-13', { distance_km: 20, is_long: true, start_at: '2026-09-13T07:00:00' })],
      profile,
    });
    const sun = a.days.find((d) => d.date === '2026-09-13')!.sessions[0]!;
    expect(sun.duration_class).toBe('LONG');
    expect(sun.calc?.estimates.carbohydrate_g_per_hour).toMatchObject({ min: 30, max: 60 });

    const rec = a.recommendation_inputs.find((r) => r.date === '2026-09-13')!;
    expect(rec.action).toMatch(/^Sun/);
    expect(rec.action).toMatch(/day before/i); // carbs + hydration the day before
    expect(rec.action).toMatch(/not by drinking a lot right before/i);
    expect(rec.action).toMatch(/protein \(~20–40 g\)/);
    expect(rec.action).toMatch(/if it's warm.*sodium/i);
    // stays non-diagnostic about cramps
    expect(rec.action).toMatch(/cramps have several causes/i);
  });

  it('stamps the methodology version', () => {
    const a = analyzeWeek({ week_start: '2026-09-07', sessions: [], profile });
    expect(a.methodology_version).toBe('0.1.0');
  });

  it('gives a prep line for EVERY session day and structured prompts for gaps', () => {
    const a = analyzeWeek({
      week_start: '2026-09-07',
      sessions: [
        s('2026-09-07', { sport: 'gym', needs_detail: ['intensity', 'duration_or_distance'] }),
        s('2026-09-08', { sport: 'running', distance_km: 6, intensity: 'easy' }), // fully specified, easy
        s('2026-09-13', { is_long: true, distance_km: 20, start_at: '2026-09-13T07:00:00' }),
      ],
      profile,
    });

    // a line per day: Mon (gym), Tue (easy run — light), Sun (long — rich)
    expect(a.recommendation_inputs.map((r) => r.date)).toEqual(['2026-09-07', '2026-09-08', '2026-09-13']);
    const tue = a.recommendation_inputs.find((r) => r.date === '2026-09-08')!;
    expect(tue.priority).toBe('low');
    expect(tue.action).toMatch(/nothing special/i);

    // structured prompt only for the gym session that has gaps
    expect(a.session_prompts).toHaveLength(1);
    expect(a.session_prompts[0]).toMatchObject({
      sport: 'gym',
      ask_intensity: true,
      ask_size: true,
    });
    expect(a.session_prompts[0]!.intensity_options.map((o) => o.value)).toEqual(['easy', 'moderate', 'hard']);
    expect(a.session_prompts[0]!.size_options.map((o) => o.minutes)).toEqual([30, 45, 60, 90, 120]);
  });
});
