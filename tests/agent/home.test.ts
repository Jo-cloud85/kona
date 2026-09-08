import { describe, expect, it } from 'vitest';
import { buildHome } from '../../src/agent/index';
import type { PlannedSession, Profile, WeeklyPlan } from '../../src/domain/types';

const profile: Profile = {
  user_id: 'user_demo',
  username: 'Joan',
  body_weight_kg: 62,
  usual_sports: ['running', 'gym'],
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
    // a session day carries the post-session protein reference (rules table)
    expect(h.selected.fuel.post_session_protein_g).not.toBeNull();
    expect(h.selected.fuel.post_session_protein_g!.max).toBeGreaterThan(h.selected.fuel.post_session_protein_g!.min);
    expect(h.week.find((d) => d.date === '2026-09-09')?.has_session).toBe(true);
  });

  it('treats a rest day as a normal day — no during-session block, no protein line', () => {
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
    expect(h.selected.fuel.post_session_protein_g).toBeNull();
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

  it('works with no weekly plan — still returns the week', () => {
    const h = buildHome({ profile, sessions: [], now: NOW });
    expect(h.has_plan).toBe(false);
    expect(h.week).toHaveLength(7);
    expect(h.selected.in_plan).toBe(false);
    expect(h.selected.fuel.is_normal_day).toBe(true);
    expect(h.selected.fuel.during_session).toBeNull();
  });

  it('ignores a malformed selectedDate and falls back to today', () => {
    const h = buildHome({ profile, weeklyPlan: plan(), sessions: [], now: NOW, selectedDate: 'garbage' });
    expect(h.selected_date).toBe('2026-09-09');
  });

  it('puts the time of day in the session title and adds a morning pre-fuel note', () => {
    const h = buildHome({
      profile,
      weeklyPlan: plan(),
      sessions: [session({ start_at: '2026-09-09T07:00:00', distance_km: 6, time_of_day: 'morning' })],
      now: NOW,
    });
    const s = h.selected.sessions[0]!;
    expect(s.time_of_day).toBe('morning');
    expect(s.title.toLowerCase()).toContain('morning');
    expect(h.selected.fuel.pre_fuel_note).toMatch(/morning session/i);
    expect(h.selected.fuel.pre_fuel_note).toMatch(/banana|dates|toast/i);
  });

  it('has no pre-fuel note for an afternoon session', () => {
    const h = buildHome({
      profile,
      weeklyPlan: plan(),
      sessions: [session({ start_at: '2026-09-09T13:00:00', distance_km: 6, time_of_day: 'afternoon' })],
      now: NOW,
    });
    expect(h.selected.sessions[0]!.time_of_day).toBe('afternoon');
    expect(h.selected.fuel.pre_fuel_note).toBeNull();
  });

  it('flags an end-of-day check-in as due on a training day, cleared once done', () => {
    const withSession = {
      profile,
      weeklyPlan: plan(),
      sessions: [session({ start_at: '2026-09-09T07:00:00', distance_km: 6, time_of_day: 'morning' })],
      now: NOW,
    };
    expect(buildHome(withSession).checkin).toEqual({ due: true, done: false });
    expect(buildHome({ ...withSession, checkinDoneToday: true }).checkin).toEqual({ due: false, done: true });

    // a rest day (no session today) is never "due"
    const restToday = buildHome({
      profile,
      weeklyPlan: { ...plan(), rest_days: ['2026-09-09'] },
      sessions: [],
      now: NOW,
    });
    expect(restToday.checkin.due).toBe(false);
  });
});
