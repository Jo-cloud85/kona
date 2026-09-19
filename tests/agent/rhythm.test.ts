import { describe, expect, it } from 'vitest';
import { buildConsistencyDays, describeConsistency } from '../../src/agent/index';
import type { ActualSession, PlannedSession } from '../../src/domain/types';
import type { FeltVsPlanned } from '../../src/agent/rhythm';

let n = 0;
function actual(over: Partial<ActualSession>): ActualSession {
  return {
    id: `a_${n++}`,
    user_id: 'u',
    kind: 'actual',
    sport: 'running',
    intensity: 'easy',
    start_at: '2026-09-01T18:00:00',
    status: 'completed',
    created_at: '2026-09-01T18:30:00Z',
    ...over,
  };
}
function planned(over: Partial<PlannedSession>): PlannedSession {
  return {
    id: `p_${n++}`,
    user_id: 'u',
    kind: 'planned',
    sport: 'running',
    intensity: 'easy',
    start_at: '2026-09-01T06:00:00',
    created_at: '2026-08-25T00:00:00Z',
    ...over,
  };
}

const NOW = new Date(2026, 8, 14); // Mon 14 Sep 2026 — buildConsistencyDays' own window start
const DAY = '2026-09-14';

function checkins(over: {
  felt?: [string, FeltVsPlanned][];
  confirmed?: string[];
  pain?: string[];
}) {
  return {
    feltVsPlanned: new Map(over.felt ?? []),
    confirmedAsPlanned: new Set(over.confirmed ?? []),
    pain: new Set(over.pain ?? []),
  };
}
const NOTHING = checkins({});

function dayFor(days: ReturnType<typeof buildConsistencyDays>, date: string) {
  return days.find((d) => d.date === date);
}

describe('buildConsistencyDays (M28.1 — effort color + independent pain flag)', () => {
  it('is empty with no session, no plan-confirmation, no check-in at all', () => {
    const days = buildConsistencyDays([], [], NOTHING, NOW);
    expect(dayFor(days, DAY)?.state).toBe('empty');
    expect(dayFor(days, DAY)?.pain).toBe(false);
  });

  it('grades a logged session by its own intensity when nothing else applies', () => {
    const days = buildConsistencyDays([actual({ start_at: `${DAY}T06:00:00`, intensity: 'easy' })], [], NOTHING, NOW);
    expect(dayFor(days, DAY)?.state).toBe('easy');
  });

  it('moderate and hard sessions grade the same way', () => {
    const mod = buildConsistencyDays([actual({ start_at: `${DAY}T06:00:00`, intensity: 'moderate' })], [], NOTHING, NOW);
    expect(dayFor(mod, DAY)?.state).toBe('moderate');
    const hard = buildConsistencyDays([actual({ start_at: `${DAY}T06:00:00`, intensity: 'hard' })], [], NOTHING, NOW);
    expect(dayFor(hard, DAY)?.state).toBe('hard');
  });

  it('a multi-session day grades on the hardest session, not automatically "hard" for having several (founder report, 2026-09-18 — swim+gym+run, felt fine, was not a hard day)', () => {
    const days = buildConsistencyDays(
      [
        actual({ start_at: `${DAY}T06:00:00`, sport: 'swimming', intensity: 'easy' }),
        actual({ start_at: `${DAY}T18:00:00`, sport: 'gym', intensity: 'easy' }),
        actual({ start_at: `${DAY}T19:00:00`, sport: 'running', intensity: 'moderate' }),
      ],
      [],
      NOTHING,
      NOW,
    );
    expect(dayFor(days, DAY)?.state).toBe('moderate');
  });

  it('a skipped session does not count as an effort — falls through like no session at all', () => {
    const days = buildConsistencyDays(
      [actual({ start_at: `${DAY}T06:00:00`, intensity: 'hard', status: 'skipped' })],
      [],
      NOTHING,
      NOW,
    );
    expect(dayFor(days, DAY)?.state).toBe('empty');
  });

  it('falls back to the planned intensity when the check-in confirms the plan happened but nothing was separately logged (the original bug report)', () => {
    const days = buildConsistencyDays(
      [],
      [planned({ start_at: `${DAY}T06:00:00`, intensity: 'moderate' })],
      checkins({ confirmed: [DAY] }),
      NOW,
    );
    expect(dayFor(days, DAY)?.state).toBe('moderate');
  });

  it('stays empty when the plan was not confirmed, even if a session was planned (e.g. shifted to another day)', () => {
    const days = buildConsistencyDays([], [planned({ start_at: `${DAY}T06:00:00`, intensity: 'hard' })], NOTHING, NOW);
    expect(dayFor(days, DAY)?.state).toBe('empty');
  });

  it('an actual session always outranks a bare plan confirmation', () => {
    const days = buildConsistencyDays(
      [actual({ start_at: `${DAY}T06:00:00`, intensity: 'easy' })],
      [planned({ start_at: `${DAY}T06:00:00`, intensity: 'hard' })],
      checkins({ confirmed: [DAY] }),
      NOW,
    );
    expect(dayFor(days, DAY)?.state).toBe('easy');
  });

  it('a check-in reporting "harder than planned" shifts the color up one step', () => {
    const days = buildConsistencyDays(
      [actual({ start_at: `${DAY}T06:00:00`, intensity: 'easy' })],
      [],
      checkins({ felt: [[DAY, 'harder']] }),
      NOW,
    );
    expect(dayFor(days, DAY)?.state).toBe('moderate');
  });

  it('a check-in reporting "easier than planned" shifts the color down one step', () => {
    const days = buildConsistencyDays(
      [actual({ start_at: `${DAY}T06:00:00`, intensity: 'hard' })],
      [],
      checkins({ felt: [[DAY, 'easier']] }),
      NOW,
    );
    expect(dayFor(days, DAY)?.state).toBe('moderate');
  });

  it('the felt-vs-planned shift clamps at both ends of the scale', () => {
    const alreadyHard = buildConsistencyDays(
      [actual({ start_at: `${DAY}T06:00:00`, intensity: 'hard' })],
      [],
      checkins({ felt: [[DAY, 'harder']] }),
      NOW,
    );
    expect(dayFor(alreadyHard, DAY)?.state).toBe('hard');

    const alreadyEasy = buildConsistencyDays(
      [actual({ start_at: `${DAY}T06:00:00`, intensity: 'easy' })],
      [],
      checkins({ felt: [[DAY, 'easier']] }),
      NOW,
    );
    expect(dayFor(alreadyEasy, DAY)?.state).toBe('easy');
  });

  it('"about right" leaves the color unchanged', () => {
    const days = buildConsistencyDays(
      [actual({ start_at: `${DAY}T06:00:00`, intensity: 'moderate' })],
      [],
      checkins({ felt: [[DAY, 'as_expected']] }),
      NOW,
    );
    expect(dayFor(days, DAY)?.state).toBe('moderate');
  });

  it('pain is an independent flag, not a color — a hard day can still be flagged for pain', () => {
    const days = buildConsistencyDays(
      [actual({ start_at: `${DAY}T06:00:00`, intensity: 'hard' })],
      [],
      checkins({ pain: [DAY] }),
      NOW,
    );
    expect(dayFor(days, DAY)?.state).toBe('hard');
    expect(dayFor(days, DAY)?.pain).toBe(true);
  });

  it('pain can flag an otherwise-empty day (e.g. skipped a session because of it)', () => {
    const days = buildConsistencyDays([], [], checkins({ pain: [DAY] }), NOW);
    expect(dayFor(days, DAY)?.state).toBe('empty');
    expect(dayFor(days, DAY)?.pain).toBe(true);
  });

  it('marks is_today only for the athlete-local current date', () => {
    const days = buildConsistencyDays([], [], NOTHING, NOW);
    expect(dayFor(days, '2026-09-14')?.is_today).toBe(true);
    expect(dayFor(days, '2026-09-15')?.is_today).toBe(false);
  });

  it('spans exactly 168 days (24 weeks)', () => {
    expect(buildConsistencyDays([], [], NOTHING, NOW)).toHaveLength(168);
  });

  it('is Monday-aligned — every 7th day starting at index 0 is a Monday', () => {
    const days = buildConsistencyDays([], [], NOTHING, NOW);
    for (let i = 0; i < days.length; i += 7) {
      const [y, m, d] = days[i]!.date.split('-').map(Number) as [number, number, number];
      expect(new Date(y, m - 1, d).getDay()).toBe(1); // 1 = Monday
    }
  });

  it('runs forward from this week, not backward — column 0 is this week, day 7 is next week', () => {
    const days = buildConsistencyDays([], [], NOTHING, NOW);
    expect(days[0]!.date).toBe('2026-09-14');
    expect(days[7]!.date).toBe('2026-09-21');
  });
});

describe('describeConsistency (M27.3 — headline + detail line)', () => {
  const TODAY = '2026-09-20';

  it('reads as aligned with fewer than 2 recent hard sessions', () => {
    const r = describeConsistency([], TODAY);
    expect(r.headline).toBe('Aligned with your normal');
    expect(r.detail).toMatch(/no unusual clustering/i);
  });

  it('reads as worth watching, naming the specific days, with 2+ recent hard sessions', () => {
    const recentHard = [
      actual({ start_at: '2026-09-17T06:00:00', intensity: 'hard' }),
      actual({ start_at: '2026-09-19T06:00:00', intensity: 'hard' }),
    ];
    const r = describeConsistency(recentHard, TODAY);
    expect(r.headline).toBe('Worth watching');
    expect(r.detail).toMatch(/2 hard sessions/i);
    expect(r.detail).toMatch(/Yesterday/); // 09-19 is the day before TODAY
  });
});
