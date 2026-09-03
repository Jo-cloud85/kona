import { describe, expect, it } from 'vitest';
import { calculateFuelingTargets, type CalculateInput } from '../../src/engine/index.js';

const baseProfile = { body_weight_kg: 64, usual_bottle_ml: 750 };

function calc(overrides: Partial<CalculateInput>): ReturnType<typeof calculateFuelingTargets> {
  return calculateFuelingTargets({
    session: { sport: 'running', intensity: 'easy', duration_minutes: 60 },
    profile: baseProfile,
    ...overrides,
  } as CalculateInput);
}

describe('calculateFuelingTargets — CALCULATION_ENGINE_SPEC.md §21', () => {
  it('1. 40-min easy gym session → no mandatory carbohydrate target', () => {
    const r = calc({ session: { sport: 'gym', intensity: 'easy', duration_minutes: 40 } });
    expect(r.priorities.carbohydrate).toBe('NONE');
    expect(r.estimates.carbohydrate_g_per_hour).toBeNull();
  });

  it('2. 50-min easy run in normal conditions → basic hydration guidance only', () => {
    const r = calc({ session: { sport: 'running', intensity: 'easy', duration_minutes: 50 } });
    expect(r.estimates.fluid_ml_per_hour).toBeNull(); // no per-hour planning number
    expect(r.priorities.hydration).toBe('LOW');
    expect(r.estimates.carbohydrate_g_per_hour).toBeNull();
  });

  it('3. 75-min hard run → carbohydrate planning becomes relevant', () => {
    const r = calc({ session: { sport: 'running', intensity: 'hard', duration_minutes: 75 } });
    expect(r.estimates.carbohydrate_g_per_hour).not.toBeNull();
    expect(['MODERATE', 'HIGH']).toContain(r.priorities.carbohydrate);
    expect(r.estimates.carbohydrate_g_per_hour).toMatchObject({ min: 30, max: 60 });
  });

  it('4. 110-min moderate run → carbohydrate + hydration preparation', () => {
    const r = calc({ session: { sport: 'running', intensity: 'moderate', duration_minutes: 110 } });
    expect(r.estimates.carbohydrate_g_per_hour).not.toBeNull();
    expect(r.estimates.fluid_ml_per_hour).not.toBeNull();
    expect(r.priorities.preparation).toBe('HIGH');
  });

  it('5. 110-min run in hot/humid conditions → hydration priority increases', () => {
    const cool = calc({ session: { sport: 'running', intensity: 'moderate', duration_minutes: 110 } });
    const hot = calc({
      session: {
        sport: 'running',
        intensity: 'moderate',
        duration_minutes: 110,
        environment: { temperature_c: 31, humidity_percent: 80 },
      },
    });
    const order = ['NONE', 'LOW', 'MODERATE', 'HIGH'];
    expect(order.indexOf(hot.priorities.hydration)).toBeGreaterThan(order.indexOf(cool.priorities.hydration));
    expect(hot.priorities.hydration).toBe('HIGH');
  });

  it('6. measured sweat rate overrides the fallback hydration estimate', () => {
    const r = calc({
      session: { sport: 'running', intensity: 'moderate', duration_minutes: 110 },
      profile: {
        ...baseProfile,
        known_sweat_data: [{ environment_class: 'COOL_OR_NORMAL', sweat_rate_l_per_h: 1.2 }],
      },
    });
    expect(r.estimates.fluid_ml_per_hour?.basis).toBe('measured_sweat_rate');
    expect(r.estimates.fluid_ml_per_hour?.confidence).toBe('high');
    // ~1200 ml/h ± 10%, outside the 400–800 fallback band
    expect(r.estimates.fluid_ml_per_hour!.max).toBeGreaterThan(800);
  });

  it('7. known sweat sodium switches sodium mode to estimated_loss', () => {
    const r = calc({
      session: { sport: 'running', intensity: 'moderate', duration_minutes: 150 },
      profile: {
        ...baseProfile,
        known_sweat_data: [
          { environment_class: 'COOL_OR_NORMAL', sweat_rate_l_per_h: 1.2, sweat_sodium_mg_per_l: 800 },
        ],
      },
    });
    expect(r.estimates.sodium?.mode).toBe('estimated_loss');
    expect(r.estimates.sodium?.mg_per_hour).toBe(960);
    expect(r.estimates.sodium?.mg_per_litre).toBeUndefined();
  });

  it('8. user with no sweat data is never given an exact personal sodium-loss number', () => {
    const r = calc({ session: { sport: 'running', intensity: 'hard', duration_minutes: 160 } });
    expect(r.estimates.sodium?.mode).toBe('reference_concentration');
    expect(r.estimates.sodium?.mg_per_hour).toBeUndefined();
    expect(r.estimates.sodium?.mg_per_litre).toMatchObject({ min: 500, max: 700 });
  });

  it('9. planned 18km vs actual 10km → the actual session drives the post-workout calc', () => {
    const r = calculateFuelingTargets({
      session: { sport: 'running', intensity: 'easy', distance_km: 10 },
      profile: baseProfile,
      phase: 'post_workout',
      context: { injury_or_pain: true, reason_for_modification: 'left hip discomfort' },
    });
    expect(r.session_classification.resolved_duration_minutes).toBe(60); // 10km, not 18km
    const safety = r.recommendation_inputs.find((x) => x.category === 'safety');
    expect(safety).toBeDefined();
    expect(safety!.action).toMatch(/make up the missed distance/i);
  });

  it('10. swim + gym same day → multi-session logic raises priorities', () => {
    const single = calc({ session: { sport: 'swimming', intensity: 'moderate', duration_minutes: 45 } });
    const multi = calc({
      session: { sport: 'swimming', intensity: 'moderate', duration_minutes: 45, multi_session: true },
    });
    expect(single.session_classification.multi_session).toBe(false);
    expect(multi.session_classification.multi_session).toBe(true);
    const order = ['NONE', 'LOW', 'MODERATE', 'HIGH'];
    expect(order.indexOf(multi.priorities.hydration)).toBeGreaterThanOrEqual(
      order.indexOf(single.priorities.hydration),
    );
    expect(multi.priorities.preparation).toBe('HIGH');
  });

  it('11. poor sleep is acknowledged as context, not treated as under-fueling', () => {
    const rested = calc({ session: { sport: 'running', intensity: 'moderate', duration_minutes: 110 } });
    const tired = calc({
      session: { sport: 'running', intensity: 'moderate', duration_minutes: 110 },
      context: { poor_sleep: true },
    });
    expect(tired.estimates.carbohydrate_g_per_hour).toEqual(rested.estimates.carbohydrate_g_per_hour);
    expect(tired.priorities).toEqual(rested.priorities);
    expect(tired.warnings.join(' ')).toMatch(/poor sleep/i);
  });

  it('16. body-mass gain during exercise → flag overdrinking, no "drink more"', () => {
    const r = calculateFuelingTargets({
      session: { sport: 'cycling', intensity: 'moderate', duration_minutes: 120 },
      profile: baseProfile,
      phase: 'post_workout',
      actual: { pre_weight_kg: 64, post_weight_kg: 64.6 },
    });
    expect(r.warnings.join(' ')).toMatch(/overdrinking/i);
    const drinkMore = r.recommendation_inputs.find((x) => /drink more|increase fluid/i.test(x.action));
    expect(drinkMore).toBeUndefined();
  });

  it('always stamps methodology version and source ids (§19)', () => {
    const r = calc({});
    expect(r.methodology_version).toBe('0.1.0');
    expect(r.source_ids.length).toBeGreaterThan(0);
    expect(r.calculated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('derives daily protein from body weight (§8.1)', () => {
    const r = calc({});
    expect(r.recovery.protein_daily_g).toMatchObject({ min: Math.round(64 * 1.4), max: Math.round(64 * 2.0) });
  });
});

describe('the 18km @ 6am planning slice', () => {
  it('classifies LONG, flags an estimated duration, and produces day-before prep', () => {
    const r = calculateFuelingTargets({
      session: { sport: 'running', intensity: 'easy', distance_km: 18, start_at: '2026-09-04T06:00:00' },
      profile: baseProfile,
      phase: 'planning',
    });
    expect(r.session_classification.duration_class).toBe('LONG');
    expect(r.session_classification.duration_estimated).toBe(true);
    expect(r.priorities.preparation).toBe('HIGH');
    const prep = r.recommendation_inputs.find((x) => x.category === 'preparation');
    expect(prep?.timing).toBe('day_before');
    expect(prep?.action).toMatch(/750 ml bottle/);
    expect(prep?.reason_codes).toContain('early_start');
    // no invented sodium-per-hour number for a user with no sweat data
    expect(r.estimates.sodium?.mg_per_hour).toBeUndefined();
  });
});
