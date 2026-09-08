import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../../src/agent/index';
import type { PlannedSession, Profile, WeeklyPlan } from '../../src/domain/types';

const profile: Profile = {
  user_id: 'user_demo',
  username: 'Sam',
  body_weight_kg: 70,
  usual_sports: ['running', 'gym'],
  onboarded_at: '2026-09-06T00:00:00Z',
};

function plan(): WeeklyPlan {
  return {
    id: 'week_1',
    user_id: 'user_demo',
    week_start: '2026-09-14',
    rest_days: ['2026-09-14'],
    created_at: '2026-09-06T00:00:00Z',
  };
}

function session(over: Partial<PlannedSession>): PlannedSession {
  return {
    id: `plan_${Math.random()}`,
    user_id: 'user_demo',
    kind: 'planned',
    sport: 'running',
    intensity: 'easy',
    start_at: '2026-09-15T07:00:00',
    weekly_plan_id: 'week_1',
    created_at: '2026-09-06T00:00:00Z',
    ...over,
  };
}

describe('buildDashboard', () => {
  it('reports the daily protein baseline from body weight', () => {
    const d = buildDashboard({ profile, weeklyPlan: plan(), sessions: [] });
    expect(d.baseline.protein_daily_g).toEqual({ min: Math.round(70 * 1.4), max: Math.round(70 * 2.0) });
    expect(d.baseline.post_session_protein_g).toEqual({ min: 20, max: 40 });
  });

  it('has no plan when there is no weekly plan', () => {
    const d = buildDashboard({ profile, weeklyPlan: undefined, sessions: [] });
    expect(d.has_plan).toBe(false);
    expect(d.days).toHaveLength(0);
    // baseline is still available (weight is on the fixture)
    expect(d.baseline.protein_daily_g).not.toBeNull();
    expect(d.baseline.protein_daily_g!.min).toBeGreaterThan(0);
  });

  it('fills per-day carb/fluid targets only where the engine can classify the session', () => {
    const d = buildDashboard({
      profile,
      weeklyPlan: plan(),
      sessions: [
        session({ start_at: '2026-09-15T07:00:00', distance_km: 18, is_long: true }), // long run -> targets
        session({ start_at: '2026-09-16T07:00:00', sport: 'gym', needs_detail: ['intensity', 'duration_or_distance'] }), // unclassifiable -> null
      ],
    });
    expect(d.has_plan).toBe(true);

    const longRunDay = d.days.find((x) => x.date === '2026-09-15')!;
    expect(longRunDay.carb_g_per_hour).toEqual({ min: 30, max: 60 });
    expect(longRunDay.fluid_ml_per_hour).toEqual({ min: 400, max: 800 });

    const gymDay = d.days.find((x) => x.date === '2026-09-16')!;
    expect(gymDay.carb_g_per_hour).toBeNull();
    expect(gymDay.fluid_ml_per_hour).toBeNull();

    // Monday is a rest day — but still carries the daily protein target
    const rest = d.days.find((x) => x.date === '2026-09-14')!;
    expect(rest.is_rest).toBe(true);
    expect(rest.protein_daily_g).toEqual(d.baseline.protein_daily_g);
    expect(rest.carb_g_per_hour).toBeNull();

    // days are date-sorted
    expect(d.days.map((x) => x.date)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16']);
  });

  it('flags the day before a long session (but not before a plain hard one)', () => {
    const d = buildDashboard({
      profile,
      weeklyPlan: plan(),
      sessions: [
        session({ start_at: '2026-09-15T07:00:00', distance_km: 6, intensity: 'hard' }), // Tue, hard but short
        session({ start_at: '2026-09-16T07:00:00', sport: 'gym', duration_minutes: 45 }), // Wed, routine
        session({ start_at: '2026-09-17T07:00:00', distance_km: 20, is_long: true }), // Thu, long run
      ],
    });
    const mon = d.days.find((x) => x.date === '2026-09-14')!;
    const wed = d.days.find((x) => x.date === '2026-09-16')!;
    const thu = d.days.find((x) => x.date === '2026-09-17')!;
    expect(mon.prep_for).toBeNull(); // Tue is only hard+short — no day-before prep
    expect(wed.prep_for).toBe(thu.weekday); // day before the long run
    expect(thu.prep_for).toBeNull();
  });
});
