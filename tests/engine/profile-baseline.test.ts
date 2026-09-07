import { describe, expect, it } from 'vitest';
import { profileDailyBaseline } from '../../src/engine/index';

describe('profileDailyBaseline', () => {
  it('derives the daily protein range from body weight (rules table)', () => {
    const b = profileDailyBaseline({ body_weight_kg: 72 });
    expect(b.protein_daily_g_per_kg).toEqual({ min: 1.4, max: 2.0 });
    expect(b.protein_daily_g).toEqual({ min: Math.round(72 * 1.4), max: Math.round(72 * 2.0) });
    expect(b.post_session_protein_g).toEqual({ min: 20, max: 40 });
  });

  it('reports fluid/sodium as training references, not daily totals', () => {
    const b = profileDailyBaseline({ body_weight_kg: 60 });
    expect(b.training_fluid_ml_per_hour).toEqual({ min: 400, max: 800 });
    expect(b.training_sodium_mg_per_litre).toEqual({ min: 500, max: 700 });
    expect(b.notes.join(' ')).toMatch(/not (a )?fixed daily/i);
  });

  it('stamps the methodology version', () => {
    expect(profileDailyBaseline({ body_weight_kg: 70 }).methodology_version).toBe('0.1.0');
  });
});
