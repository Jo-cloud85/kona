import { describe, expect, it } from 'vitest';
import { dailyNutrition, activityFromSessions } from '../../src/engine/index';

describe('dailyNutrition', () => {
  it('estimates energy with Mifflin–St Jeor × an activity factor', () => {
    // Female, 34, 168 cm, 58 kg, moderate (×1.55):
    // BMR = 10*58 + 6.25*168 - 5*34 - 161 = 580 + 1050 - 170 - 161 = 1299
    // TDEE = 1299 * 1.55 = 2013.45 -> ±8% -> [1852, 2175] rounded to nearest 10
    const d = dailyNutrition({
      body_weight_kg: 58,
      height_cm: 168,
      age: 34,
      gender: 'female',
      activity_level: 'moderate',
    });
    expect(d.energy_kcal.min).toBeGreaterThanOrEqual(1840);
    expect(d.energy_kcal.min).toBeLessThanOrEqual(1860);
    expect(d.energy_kcal.max).toBeGreaterThanOrEqual(2170);
    expect(d.energy_kcal.max).toBeLessThanOrEqual(2185);
    expect(d.methodology_version).toBe('0.2.0');
    expect(d.confidence).toBe('moderate');
  });

  it('scales macros to body weight and activity', () => {
    const d = dailyNutrition({
      body_weight_kg: 70,
      height_cm: 178,
      age: 40,
      gender: 'male',
      activity_level: 'very_active',
    });
    expect(d.protein_g).toEqual({ min: Math.round(70 * 1.4), max: Math.round(70 * 2.0) });
    // very_active carb range is 6–10 g/kg
    expect(d.carbohydrate_g_per_kg).toEqual({ min: 6, max: 10 });
    expect(d.carbohydrate_g).toEqual({ min: 70 * 6, max: 70 * 10 });
    expect(d.fibre_g).toBeGreaterThan(20);
  });

  it('drops confidence and records assumptions when inputs are missing', () => {
    const d = dailyNutrition({ body_weight_kg: 65, typical_weekly_sessions: 3 });
    expect(d.confidence).toBe('low');
    expect(d.activity_level_assumed).toBe(true);
    expect(d.activity_level).toBe('light'); // 3 sessions -> light
    expect(d.assumptions.join(' ')).toMatch(/height not given/i);
    expect(d.assumptions.join(' ')).toMatch(/sex not specified/i);
  });

  it('keeps sodium as guidance, not a computed target', () => {
    const d = dailyNutrition({ body_weight_kg: 60, height_cm: 165, age: 30, gender: 'female', activity_level: 'light' });
    expect(d.sodium_guidance).toEqual({ adequate_intake_g: 1.5, upper_guidance_g: 2.3 });
    // no `sodium_g` field — it is deliberately not a target
    expect('sodium_g' in d).toBe(false);
  });

  it('maps weekly session count to an activity level', () => {
    expect(activityFromSessions(0)).toBe('sedentary');
    expect(activityFromSessions(2)).toBe('light');
    expect(activityFromSessions(5)).toBe('moderate');
    expect(activityFromSessions(7)).toBe('very_active');
    expect(activityFromSessions(10)).toBe('extra_active');
  });
});
