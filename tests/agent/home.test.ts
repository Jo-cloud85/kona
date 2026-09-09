import { describe, expect, it } from 'vitest';
import { buildHome } from '../../src/agent/index';
import type { ActualSession, PlannedSession, Profile, RecoveryLog, WeeklyPlan } from '../../src/domain/types';

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
function actual(over: Partial<ActualSession>): ActualSession {
  return {
    id: `a_${Math.random()}`,
    user_id: 'user_demo',
    kind: 'actual',
    sport: 'cycling',
    intensity: 'easy',
    start_at: '2026-09-01T07:00:00',
    status: 'completed',
    created_at: '2026-09-01T08:00:00Z',
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

  it('YOUR DAY: an easy session reads plainly, no numbers, nothing to prepare', () => {
    const h = buildHome({
      profile,
      weeklyPlan: plan(),
      sessions: [session({ start_at: '2026-09-09T13:00:00', distance_km: 6, time_of_day: 'afternoon' })],
      now: NOW,
    });
    const yd = h.briefing.your_day;
    expect(yd.headline.toLowerCase()).toContain('6 km');
    expect(yd.headline.toLowerCase()).toContain('run');
    expect(yd.line).toMatch(/nothing unusual|keep it easy/i);
    expect(yd.fuelling).toBeNull();
    expect(yd.needs).toEqual([]);
  });

  it('YOUR DAY: a long session shows the during-session references + post protein', () => {
    const h = buildHome({
      profile,
      weeklyPlan: plan(),
      sessions: [session({ start_at: '2026-09-09T06:00:00', distance_km: 18, is_long: true })],
      now: NOW,
    });
    const yd = h.briefing.your_day;
    expect(yd.headline.toLowerCase()).toContain('long');
    expect(yd.fuelling).not.toBeNull();
    expect(yd.fuelling!.carb_g_per_hour.max).toBeGreaterThan(0);
    expect(yd.fuelling!.post_session_protein_g!.max).toBeGreaterThan(yd.fuelling!.post_session_protein_g!.min);
    expect(yd.line).toMatch(/bigger one/i);
  });

  it('YOUR DAY: a rest day and an unplanned day read honestly', () => {
    const rest = buildHome({ profile, weeklyPlan: plan(), sessions: [], now: NOW, selectedDate: '2026-09-07' });
    expect(rest.briefing.your_day.headline).toBe('Rest day');
    expect(rest.briefing.your_day.fuelling).toBeNull();

    const noPlan = buildHome({ profile, sessions: [], now: NOW });
    expect(noPlan.briefing.your_day.headline).toMatch(/no plan/i);
    expect(noPlan.briefing.your_day.line).toMatch(/tell kona your week/i);
  });

  it('YOUR DAY: unset details are listed and the line nudges to chat', () => {
    const h = buildHome({
      profile,
      weeklyPlan: plan(),
      sessions: [
        session({ start_at: '2026-09-10T18:00:00', sport: 'gym', needs_detail: ['intensity', 'duration_or_distance', 'time_of_day'] }),
      ],
      now: NOW,
      selectedDate: '2026-09-10',
    });
    expect(h.briefing.your_day.needs.sort()).toEqual(['effort', 'length', 'time']);
    expect(h.briefing.your_day.line).toMatch(/sort it in chat/i);
  });

  it('ONE THING TO THINK ABOUT: points at the next key day and folds in a real pattern', () => {
    // Thu 2026-09-10 is a long ride; three prior easy rides establish a pattern.
    const priorRides = ['2026-08-30', '2026-09-03', '2026-09-06'].map((d) =>
      actual({ sport: 'cycling', start_at: `${d}T07:00:00`, distance_km: 40 }),
    );
    const h = buildHome({
      profile,
      weeklyPlan: plan(),
      sessions: [session({ start_at: '2026-09-10T07:00:00', sport: 'cycling', distance_km: 90, is_long: true })],
      now: NOW,
      actualSessions: priorRides,
    });
    const nk = h.briefing.next_key;
    expect(nk).not.toBeNull();
    expect(nk!.when).toBe('Tomorrow');
    expect(nk!.headline.toLowerCase()).toContain('long');
    expect(nk!.line).toMatch(/big fuelling day/i);
    expect(nk!.line).toMatch(/last 3 cycling sessions all went to plan/i); // the real pattern
  });

  it('ONE THING TO THINK ABOUT is null when nothing notable is coming up', () => {
    const h = buildHome({
      profile,
      weeklyPlan: plan(),
      sessions: [session({ start_at: '2026-09-11T07:00:00', distance_km: 5, intensity: 'easy' })],
      now: NOW,
    });
    expect(h.briefing.next_key).toBeNull();
  });

  it('KONA REMEMBERS surfaces a recurring-symptom fact, and is empty with no history', () => {
    const withHistory = buildHome({
      profile,
      weeklyPlan: plan(),
      sessions: [],
      now: NOW,
      recoveryLogs: [
        { id: 'r1', user_id: 'u', logged_at: '2026-08-20T20:00:00Z', free_text: 'left calf tight' } as RecoveryLog,
        { id: 'r2', user_id: 'u', logged_at: '2026-09-05T20:00:00Z', free_text: 'calf sore again', overall_severity: 'moderate' } as RecoveryLog,
      ],
    });
    expect(withHistory.briefing.remembers.some((t) => /calf/i.test(t))).toBe(true);

    const empty = buildHome({ profile, weeklyPlan: plan(), sessions: [], now: NOW });
    expect(empty.briefing.remembers).toEqual([]);
  });

  it('does not repeat the same pattern in ONE THING and KONA REMEMBERS', () => {
    const priorRuns = ['2026-08-30', '2026-09-03', '2026-09-06'].map((d) =>
      actual({ sport: 'running', start_at: `${d}T07:00:00`, distance_km: 8 }),
    );
    const h = buildHome({
      profile,
      weeklyPlan: plan(),
      sessions: [session({ start_at: '2026-09-10T07:00:00', distance_km: 20, is_long: true })],
      now: NOW,
      actualSessions: priorRuns,
    });
    const inNext = h.briefing.next_key?.line ?? '';
    const patternText = 'Your last 3 running sessions all went to plan';
    expect(inNext).toContain(patternText);
    expect(h.briefing.remembers.some((t) => t.includes(patternText))).toBe(false);
  });

  it('ignores a malformed selectedDate and falls back to today', () => {
    const h = buildHome({ profile, weeklyPlan: plan(), sessions: [], now: NOW, selectedDate: 'garbage' });
    expect(h.selected_date).toBe('2026-09-09');
  });

  it('the session title carries the time of day and the morning pre-fuel note folds into the line', () => {
    const h = buildHome({
      profile,
      weeklyPlan: plan(),
      sessions: [session({ start_at: '2026-09-09T07:00:00', distance_km: 6, time_of_day: 'morning' })],
      now: NOW,
    });
    expect(h.selected.sessions[0]!.time_of_day).toBe('morning');
    expect(h.selected.sessions[0]!.title.toLowerCase()).toContain('morning');
    expect(h.briefing.your_day.line).toMatch(/banana|dates|toast/i);
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

    const restToday = buildHome({
      profile,
      weeklyPlan: { ...plan(), rest_days: ['2026-09-09'] },
      sessions: [],
      now: NOW,
    });
    expect(restToday.checkin.due).toBe(false);
  });
});
