import { describe, expect, it } from 'vitest';
import { buildHome } from '../../src/agent/index';
import type { PlannedSession, Profile, WeeklyPlan } from '../../src/domain/types';

const profile: Profile = {
  user_id: 'user_demo',
  username: 'Joan',
  body_weight_kg: 62,
  height_cm: 168,
  age: 34,
  gender: 'female',
  activity_level: 'moderate',
  usual_sports: ['running', 'gym'],
  self_perception: { sleep_quality: 3, hydration: 3, sweat_level: 3 },
  onboarded_at: '2026-09-01T00:00:00Z',
};

// Week Mon 2026-09-07 … Sun 2026-09-13; "now" = Wed 2026-09-09, 08:00 local.
const NOW = new Date(2026, 8, 9, 8, 0, 0);

function plan(): WeeklyPlan {
  return {
    id: 'w1',
    user_id: 'user_demo',
    week_start: '2026-09-07',
    rest_days: ['2026-09-07'],
    created_at: '2026-09-01T00:00:00Z',
  };
}

function session(over: Partial<PlannedSession>): PlannedSession {
  return {
    id: `p_${Math.random()}`,
    user_id: 'user_demo',
    kind: 'planned',
    sport: 'running',
    intensity: 'easy',
    start_at: '2026-09-09T06:00:00',
    weekly_plan_id: 'w1',
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

describe('buildHome', () => {
  it('lays out Mon–Sun of the current week with today marked and defaults to today', () => {
    const h = buildHome({ profile, weeklyPlan: plan(), sessions: [], now: NOW });
    expect(h.week.map((d) => d.date)).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ]);
    expect(h.week.map((d) => d.weekday)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(h.week.find((d) => d.is_today)?.date).toBe('2026-09-09');
    expect(h.selected_date).toBe('2026-09-09');
    expect(h.greeting_name).toBe('Joan');
  });

  it('surfaces the planned session with length + effort and during-session fuel', () => {
    const h = buildHome({
      profile,
      weeklyPlan: plan(),
      sessions: [session({ start_at: '2026-09-09T06:00:00', distance_km: 18, is_long: true })],
      now: NOW,
    });
    expect(h.selected.sessions).toHaveLength(1);
    const s = h.selected.sessions[0]!;
    expect(s.is_long).toBe(true);
    expect(s.title.toLowerCase()).toContain('run');
    expect(s.duration_label).toContain('18');
    expect(s.intensity_known).toBe(true);

    expect(h.selected.fuel.during_session).not.toBeNull();
    expect(h.selected.fuel.is_normal_day).toBe(false);
    // the daily average is always there too
    expect(h.selected.fuel.daily.energy_kcal.min).toBeGreaterThan(0);
    expect(h.selected.fuel.daily.protein_g.max).toBeGreaterThan(h.selected.fuel.daily.protein_g.min);
    expect(h.week.find((d) => d.date === '2026-09-09')?.has_session).toBe(true);
  });

  it('treats a rest day as a normal day — daily average only, no during-session block', () => {
    const h = buildHome({
      profile,
      weeklyPlan: plan(),
      sessions: [],
      now: NOW,
      selectedDate: '2026-09-07',
    });
    expect(h.selected.is_rest).toBe(true);
    expect(h.selected.sessions).toHaveLength(0);
    expect(h.selected.fuel.during_session).toBeNull();
    expect(h.selected.fuel.is_normal_day).toBe(true);
    expect(h.selected.fuel.daily.carbohydrate_g.min).toBeGreaterThan(0);
  });

  it('flags effort / length not set when the session still needs detail', () => {
    const h = buildHome({
      profile,
      weeklyPlan: plan(),
      sessions: [
        session({
          start_at: '2026-09-10T18:00:00',
          sport: 'gym',
          needs_detail: ['intensity', 'duration_or_distance'],
        }),
      ],
      now: NOW,
      selectedDate: '2026-09-10',
    });
    const s = h.selected.sessions[0]!;
    expect(s.intensity_known).toBe(false);
    expect(s.intensity).toBeNull();
    expect(s.duration_label).toMatch(/not set/i);
    // an unclassifiable session is still a "normal day" for fuelling
    expect(h.selected.fuel.is_normal_day).toBe(true);
  });

  it('works with no weekly plan — still returns the week and a daily average', () => {
    const h = buildHome({ profile, sessions: [], now: NOW });
    expect(h.has_plan).toBe(false);
    expect(h.week).toHaveLength(7);
    expect(h.selected.in_plan).toBe(false);
    expect(h.selected.fuel.is_normal_day).toBe(true);
    expect(h.selected.fuel.daily.energy_kcal.max).toBeGreaterThan(0);
  });

  it('ignores a malformed selectedDate and falls back to today', () => {
    const h = buildHome({ profile, weeklyPlan: plan(), sessions: [], now: NOW, selectedDate: 'garbage' });
    expect(h.selected_date).toBe('2026-09-09');
  });
});
