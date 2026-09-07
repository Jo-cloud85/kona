import { describe, expect, it } from 'vitest';
import { buildDaily } from '../../src/agent/index';
import type { Profile } from '../../src/domain/types';

const base: Profile = {
  user_id: 'user_demo',
  username: 'Sam',
  gender: 'male',
  age: 30,
  height_cm: 178,
  body_weight_kg: 74,
  activity_level: 'moderate',
  usual_sports: ['running', 'gym'],
  typical_weekly_sessions: 5,
  self_perception: { sleep_quality: 3, hydration: 3, sweat_level: 3 },
  onboarded_at: '2026-09-06T00:00:00Z',
};

const AT = new Date('2026-09-07T08:00:00Z');

describe('buildDaily', () => {
  it('returns per-macro targets and example foods', () => {
    const d = buildDaily(base, AT);
    expect(d.macros.map((m) => m.macro)).toEqual(['protein', 'carb', 'fat', 'fibre']);
    const protein = d.macros.find((m) => m.macro === 'protein')!;
    expect(protein.target_g).toEqual(d.nutrition.protein_g);
    expect(protein.items.length).toBeGreaterThan(0);
    expect(protein.items[0]).toHaveProperty('name');
    expect(protein.items[0]!.amount_g).toBeGreaterThan(0);
    expect(d.note).toMatch(/Mifflin–St Jeor/);
    expect(d.note).toMatch(/examples of what the targets look like, not a meal plan/i);
  });

  it('filters foods by dietary restrictions', () => {
    const vegan = buildDaily({ ...base, dietary_restrictions: ['vegan', 'gluten_free'] }, AT);
    const allNames = vegan.macros.flatMap((m) => m.items.map((i) => i.name.toLowerCase()));
    expect(allNames.some((n) => /chicken|beef|salmon|tuna|egg|yoghurt|milk|cheese|whey/.test(n))).toBe(false);
    expect(allNames.some((n) => /bread|pasta/.test(n))).toBe(false);
    // still finds vegan carbs / protein
    expect(allNames.some((n) => /rice|potato|oats|quinoa|lentil|tofu|bean/.test(n))).toBe(true);
    expect(vegan.note).toMatch(/respecting: vegan, gluten free/);
  });

  it('frames fluid and sodium as guidance, not fixed personal targets', () => {
    const d = buildDaily(base, AT);
    expect(d.fluid_text).toMatch(/go by thirst/i);
    expect(d.sodium_text).toMatch(/isn't a personalised target/i);
  });
});
