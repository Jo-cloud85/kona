import { describe, expect, it } from 'vitest';
import { buildWeek } from '../../src/agent/index';
import type { ActualSession, PlannedSession, Profile, WeeklyPlan } from '../../src/domain/types';

const profile: Profile = {
  user_id: 'user_demo',
  username: 'Joan',
  body_weight_kg: 62,
  usual_sports: ['running'],
  onboarded_at: '2026-09-01T00:00:00Z',
};

// Wed 2026-09-09, 08:00 local.
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

describe('buildWeek', () => {
  it('is a two-calendar-week window always starting on Monday (M27.1)', () => {
    const w = buildWeek({ profile, weeklyPlan: plan(), sessions: [], now: NOW });
    expect(w.days).toHaveLength(14);
    expect(w.days[0]!.date).toBe('2026-09-07'); // Monday of NOW's week
    expect(w.days[0]!.weekday).toBe('Mon');
    expect(w.days.at(-1)!.date).toBe('2026-09-20');
    expect(w.days.find((d) => d.is_today)?.date).toBe('2026-09-09');
    expect(w.range_label).toBe('7 – 20 Sep');
  });

  it('has_plan is true from a standalone session alone, with no weekly plan on record', () => {
    const w = buildWeek({
      profile,
      weeklyPlan: undefined,
      sessions: [session({ weekly_plan_id: undefined, start_at: '2026-09-09T18:00:00', distance_km: 10 })],
      now: NOW,
    });
    expect(w.has_plan).toBe(true);
    expect(w.days.find((d) => d.date === '2026-09-09')?.title_lines.join(' ')).toMatch(/run/i);
  });

  it('is false (empty state) when there is truly nothing in the window', () => {
    const w = buildWeek({ profile, weeklyPlan: undefined, sessions: [], now: NOW });
    expect(w.has_plan).toBe(false);
  });

  it('has_plan is true from a logged actual session alone — no plan, no standalone planned session either', () => {
    const actual: ActualSession = {
      id: 'a1',
      user_id: 'user_demo',
      kind: 'actual',
      sport: 'running',
      intensity: 'easy',
      start_at: '2026-09-09T18:00:00',
      status: 'completed',
      created_at: '2026-09-09T19:00:00Z',
    };
    const w = buildWeek({ profile, weeklyPlan: undefined, sessions: [], actualSessions: [actual], now: NOW });
    expect(w.has_plan).toBe(true);
    expect(w.days.find((d) => d.date === '2026-09-09')?.has_recap).toBe(true);
  });

  it('shows "Updated: …" when what was actually logged differs from the plan (M27.4)', () => {
    const planned = session({ start_at: '2026-09-09T06:00:00', notes: '15km long run' });
    const actual: ActualSession = {
      id: 'a1',
      user_id: 'user_demo',
      kind: 'actual',
      sport: 'running',
      intensity: 'easy',
      notes: '9km easy run',
      start_at: '2026-09-09T06:00:00',
      status: 'modified',
      created_at: '2026-09-09T19:00:00Z',
    };
    const w = buildWeek({ profile, weeklyPlan: plan(), sessions: [planned], actualSessions: [actual], now: NOW });
    const day = w.days.find((d) => d.date === '2026-09-09');
    expect(day!.title_lines.join(' ')).toMatch(/15km long run/i);
    expect(day!.updated_lines.join(' ')).toMatch(/9km easy run/i);
  });

  it('leaves updated_lines empty when the actual completed as planned, even if worded differently (M27.8)', () => {
    // Regression: comparing TEXT flagged almost every completed session as
    // "updated", since the athlete rarely logs it with identical wording to
    // the plan — "Gym" vs. "Morning cardio core and lower body strength" is
    // the same session, just described tersely. Only status should matter.
    const planned = session({ start_at: '2026-09-09T06:00:00', notes: 'cardio core and lower body strength' });
    const actual: ActualSession = {
      id: 'a1',
      user_id: 'user_demo',
      kind: 'actual',
      sport: 'gym',
      intensity: 'moderate',
      notes: 'Gym',
      start_at: '2026-09-09T06:00:00',
      status: 'completed',
      created_at: '2026-09-09T19:00:00Z',
    };
    const w = buildWeek({ profile, weeklyPlan: plan(), sessions: [planned], actualSessions: [actual], now: NOW });
    expect(w.days.find((d) => d.date === '2026-09-09')?.updated_lines).toEqual([]);
  });

  it('shows "Updated: …" for an unplanned session logged on an otherwise open day', () => {
    const actual: ActualSession = {
      id: 'a1',
      user_id: 'user_demo',
      kind: 'actual',
      sport: 'cycling',
      intensity: 'easy',
      notes: 'easy spin',
      start_at: '2026-09-10T06:00:00',
      status: 'completed',
      created_at: '2026-09-10T19:00:00Z',
    };
    const w = buildWeek({ profile, weeklyPlan: plan(), sessions: [], actualSessions: [actual], now: NOW });
    const day = w.days.find((d) => d.date === '2026-09-10');
    expect(day!.title_lines).toEqual([]);
    expect(day!.updated_lines.join(' ')).toMatch(/easy spin/i);
  });

  it('session_count only counts sessions inside the displayed window, not every session ever saved', () => {
    const w = buildWeek({
      profile,
      weeklyPlan: plan(),
      sessions: [
        session({ start_at: '2026-09-09T18:00:00' }), // inside the window
        session({ start_at: '2026-01-01T18:00:00' }), // long past — outside the window
      ],
      now: NOW,
    });
    expect(w.session_count).toBe(1);
  });

  it('a session outside the stored plan week still shows its title (fuelling numbers may be absent there — known limitation)', () => {
    const w = buildWeek({
      profile,
      weeklyPlan: plan(), // week_start 2026-09-07, i.e. only covers 09-07..09-13
      sessions: [session({ start_at: '2026-09-15T18:00:00', distance_km: 8 })], // inside the rolling window, outside the plan week
      now: NOW,
    });
    const day = w.days.find((d) => d.date === '2026-09-15');
    expect(day?.title_lines.join(' ')).toMatch(/run/i);
  });
});
