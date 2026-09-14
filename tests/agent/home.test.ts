import { describe, expect, it } from 'vitest';
import { buildHome, type KonaBriefing } from '../../src/agent/index';
import type { PlannedSession, Profile, RecoveryLog, WeeklyPlan } from '../../src/domain/types';

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
  it('lays out a rolling 14-day window (today - 6 .. today + 7), today marked and default-selected', () => {
    const h = buildHome({ profile, weeklyPlan: plan(), sessions: [], now: NOW });
    // NOW is Wed 2026-09-09, so the window runs Thu 09-03 .. Wed 09-16.
    expect(h.week.map((d) => d.date)).toEqual([
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
    ]);
    expect(h.week[0]!.date).toBe('2026-09-03');
    expect(h.week.at(-1)!.date).toBe('2026-09-16');
    expect(h.week.find((d) => d.is_today)?.date).toBe('2026-09-09');
    expect(h.week.filter((d) => d.date <= '2026-09-08')).toHaveLength(6); // 6 days scrollable to the left
    expect(h.week.filter((d) => d.date >= '2026-09-10')).toHaveLength(7); // 7 days ahead to the right
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

  it('YOUR DAY: a stated distance range shows verbatim, not a fabricated midpoint number', () => {
    const h = buildHome({
      profile,
      weeklyPlan: plan(),
      sessions: [
        session({
          start_at: '2026-09-09T18:00:00',
          distance_km: 13.5,
          distance_label: '13-14km',
          time_of_day: 'evening',
        }),
      ],
      now: NOW,
    });
    expect(h.briefing.your_day.headline).toContain('13-14km');
    expect(h.briefing.your_day.headline).not.toContain('13.5');
    expect(h.selected.sessions[0]!.duration_label).toBe('13-14km');
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
    expect(noPlan.briefing.your_day.line).toMatch(/bring your training plan/i);
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

  it('KONA BRIEFING: buildHome threads a caller-computed briefing through untouched (M24 — buildKonaBriefing owns the judgment, see briefing.test.ts)', () => {
    const briefing: KonaBriefing = {
      has_target: true,
      when: 'Tomorrow',
      date: '2026-09-10',
      headline: 'Long ride',
      action: 'Bring extra fluid — your second bottle if you have one.',
      why: 'Last time you did a similar long ride, you said: "got very thirsty".',
      basis: 'reported',
    };
    const h = buildHome({ profile, weeklyPlan: plan(), sessions: [], now: NOW, konaBriefing: briefing });
    expect(h.briefing.kona_briefing).toEqual(briefing);
  });

  it('KONA BRIEFING defaults to an honest "nothing special" state when the caller omits it', () => {
    const h = buildHome({ profile, weeklyPlan: plan(), sessions: [], now: NOW });
    expect(h.briefing.kona_briefing.has_target).toBe(false);
    expect(h.briefing.kona_briefing.action).toMatch(/nothing special/i);
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

  it('does not repeat the Kona Briefing\'s own evidence sentence inside KONA REMEMBERS', () => {
    // A recurring-symptom fact Kona would otherwise surface under "remembers" —
    // reused here as the briefing's own "why", to prove buildHome excludes it.
    const h = buildHome({
      profile,
      weeklyPlan: plan(),
      sessions: [],
      now: NOW,
      recoveryLogs: [
        { id: 'r1', user_id: 'u', logged_at: '2026-08-20T20:00:00Z', free_text: 'left calf tight' } as RecoveryLog,
        { id: 'r2', user_id: 'u', logged_at: '2026-09-05T20:00:00Z', free_text: 'calf sore again', overall_severity: 'moderate' } as RecoveryLog,
      ],
      konaBriefing: {
        has_target: true,
        when: 'Tomorrow',
        date: '2026-09-10',
        headline: 'Long run',
        action: 'Ease into it.',
        why: "You've noted calf 2 times — most recently 5 Sep. Kona doesn't diagnose; this is just a flag.",
        basis: 'reported',
      },
    });
    // Without the dedup, this exact text would also appear under "remembers".
    expect(h.briefing.remembers.some((t) => /calf/i.test(t))).toBe(false);
  });

  it('ignores a malformed selectedDate and falls back to today', () => {
    const h = buildHome({ profile, weeklyPlan: plan(), sessions: [], now: NOW, selectedDate: 'garbage' });
    expect(h.selected_date).toBe('2026-09-09');
  });

  it('surfaces a goal_line when the goal has a (parseable) date, null otherwise', () => {
    const withDate = buildHome({
      profile: { ...profile, goal: { text: 'Chicago Marathon on 2026-10-11' } },
      weeklyPlan: plan(),
      sessions: [],
      now: NOW,
    });
    expect(withDate.goal_line).toMatch(/weeks to your Chicago Marathon/i);

    const noDate = buildHome({
      profile: { ...profile, goal: { text: 'Stay consistent' } },
      weeklyPlan: plan(),
      sessions: [],
      now: NOW,
    });
    expect(noDate.goal_line).toBeNull();

    const noGoal = buildHome({ profile, weeklyPlan: plan(), sessions: [], now: NOW });
    expect(noGoal.goal_line).toBeNull();
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
    expect(buildHome(withSession).checkin).toEqual({ due: true, done: false, today_due: true, missed_date: null });
    expect(buildHome({ ...withSession, checkinDoneToday: true }).checkin).toEqual({
      due: false,
      done: true,
      today_due: false,
      missed_date: null,
    });

    const restToday = buildHome({
      profile,
      weeklyPlan: { ...plan(), rest_days: ['2026-09-09'] },
      sessions: [],
      now: NOW,
    });
    expect(restToday.checkin.due).toBe(false);
  });

  it('flags the most recent PAST training day with no check-in as missed, surviving past midnight (2026-09-14 alpha feedback)', () => {
    const sessions = [
      session({ start_at: '2026-09-08T07:00:00' }), // Tue — never checked in
      session({ start_at: '2026-09-09T07:00:00' }), // Wed (today) — its own due/today_due path, not "missed"
    ];

    const noCheckins = buildHome({ profile, weeklyPlan: plan(), sessions, now: NOW });
    expect(noCheckins.checkin.missed_date).toBe('2026-09-08');
    expect(noCheckins.checkin.due).toBe(true);

    // Tuesday gets a recovery log (in the athlete's local day) -> no longer missed.
    const resolved = buildHome({
      profile,
      weeklyPlan: plan(),
      sessions,
      recoveryDates: new Set(['2026-09-08']),
      now: NOW,
    });
    expect(resolved.checkin.missed_date).toBeNull();
    expect(resolved.checkin.today_due).toBe(true); // today's own check-in is still due
  });

  it('week_preview starts with today and carries real per-day titles', () => {
    const h = buildHome({
      profile,
      weeklyPlan: plan(),
      sessions: [
        session({ start_at: '2026-09-09T07:00:00', distance_km: 6 }),
        session({ start_at: '2026-09-10T18:00:00', distance_km: 10 }),
      ],
      now: NOW,
    });
    expect(h.week_preview).toHaveLength(4);
    expect(h.week_preview[0]).toMatchObject({ date: '2026-09-09', is_today: true });
    expect(h.week_preview[0]!.title).toMatch(/6 km/);
    expect(h.week_preview[1]).toMatchObject({ date: '2026-09-10', is_today: false });
    expect(h.week_preview[1]!.title).toMatch(/10 km/);
    expect(h.week_preview[2]).toMatchObject({ date: '2026-09-11', title: null }); // open day — nothing told to Kona yet
  });
});
