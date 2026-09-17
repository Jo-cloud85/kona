import { describe, expect, it } from 'vitest';
import { buildConsistencyDays, describeConsistency } from '../../src/agent/index';
import type { ActualSession } from '../../src/domain/types';

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

const NOW = new Date(2026, 8, 20); // Sun 20 Sep 2026

function dayFor(days: ReturnType<typeof buildConsistencyDays>, date: string) {
  return days.find((d) => d.date === date);
}

describe('buildConsistencyDays (M27.5 — five states)', () => {
  it('is empty on a day with no logged session', () => {
    const days = buildConsistencyDays([], new Set(), NOW);
    expect(dayFor(days, '2026-09-19')?.state).toBe('empty');
  });

  it('is easy for a completed easy session with no other signal', () => {
    const sessions = [actual({ start_at: '2026-09-19T06:00:00', intensity: 'easy' })];
    const days = buildConsistencyDays(sessions, new Set(), NOW);
    expect(dayFor(days, '2026-09-19')?.state).toBe('easy');
  });

  it('is moderate for a completed moderate/hard session, pain-free, followed as planned', () => {
    const sessions = [actual({ start_at: '2026-09-19T06:00:00', intensity: 'hard' })];
    const days = buildConsistencyDays(sessions, new Set(), NOW);
    expect(dayFor(days, '2026-09-19')?.state).toBe('moderate');
  });

  it('is off_plan for a day that did not go as planned', () => {
    const sessions = [actual({ start_at: '2026-09-19T06:00:00', intensity: 'easy', status: 'skipped' })];
    const days = buildConsistencyDays(sessions, new Set(), NOW);
    expect(dayFor(days, '2026-09-19')?.state).toBe('off_plan');
  });

  it('is off_plan for a day with a reported pain/injury check-in, even for an easy session', () => {
    const sessions = [actual({ start_at: '2026-09-19T06:00:00', intensity: 'easy' })];
    const days = buildConsistencyDays(sessions, new Set(['2026-09-19']), NOW);
    expect(dayFor(days, '2026-09-19')?.state).toBe('off_plan');
  });

  it('is off_plan from a check-in alone, even with no logged session that day (M27.8)', () => {
    const days = buildConsistencyDays([], new Set(['2026-09-19']), NOW);
    expect(dayFor(days, '2026-09-19')?.state).toBe('off_plan');
  });

  it('is hard for a day that is part of a cluster (2+ hard/race days within the trailing 4-day window)', () => {
    const sessions = [
      actual({ start_at: '2026-09-17T06:00:00', intensity: 'hard' }),
      actual({ start_at: '2026-09-19T06:00:00', intensity: 'hard' }),
    ];
    const days = buildConsistencyDays(sessions, new Set(), NOW);
    expect(dayFor(days, '2026-09-17')?.state).toBe('hard');
    expect(dayFor(days, '2026-09-19')?.state).toBe('hard');
  });

  it('does not mark a lone hard day outside any cluster as hard', () => {
    const sessions = [actual({ start_at: '2026-09-19T06:00:00', intensity: 'hard' })];
    const days = buildConsistencyDays(sessions, new Set(), NOW);
    expect(dayFor(days, '2026-09-19')?.state).toBe('moderate');
  });

  it('prefers off_plan over hard when both apply (didn\'t follow, and part of a cluster)', () => {
    const sessions = [
      actual({ start_at: '2026-09-17T06:00:00', intensity: 'hard' }),
      actual({ start_at: '2026-09-19T06:00:00', intensity: 'hard', status: 'modified' }),
    ];
    const days = buildConsistencyDays(sessions, new Set(), NOW);
    expect(dayFor(days, '2026-09-19')?.state).toBe('off_plan');
  });

  it('is hard for a completed double-session day, regardless of each session\'s own intensity', () => {
    const sessions = [
      actual({ start_at: '2026-09-19T06:00:00', sport: 'cardio', intensity: 'moderate' }),
      actual({ start_at: '2026-09-19T07:00:00', sport: 'gym', intensity: 'moderate' }),
    ];
    const days = buildConsistencyDays(sessions, new Set(), NOW);
    expect(dayFor(days, '2026-09-19')?.state).toBe('hard');
  });

  it('prefers hard over an off-plan check-in when the double session itself went as planned (founder report, 2026-09-18)', () => {
    const sessions = [
      actual({ start_at: '2026-09-19T06:00:00', sport: 'cardio', intensity: 'moderate' }),
      actual({ start_at: '2026-09-19T07:00:00', sport: 'gym', intensity: 'moderate' }),
    ];
    // A same-day check-in reported some soreness, but nothing was skipped
    // or modified — that's a hard day, not a deviation.
    const days = buildConsistencyDays(sessions, new Set(['2026-09-19']), NOW);
    expect(dayFor(days, '2026-09-19')?.state).toBe('hard');
  });

  it('marks is_today only for the athlete-local current date', () => {
    const days = buildConsistencyDays([], new Set(), NOW);
    expect(dayFor(days, '2026-09-20')?.is_today).toBe(true);
    expect(dayFor(days, '2026-09-19')?.is_today).toBe(false);
  });

  it('spans exactly 168 days (24 weeks)', () => {
    expect(buildConsistencyDays([], new Set(), NOW)).toHaveLength(168);
  });

  it('is Monday-aligned — every 7th day starting at index 0 is a Monday (M27.5)', () => {
    const days = buildConsistencyDays([], new Set(), NOW);
    for (let i = 0; i < days.length; i += 7) {
      const [y, m, d] = days[i]!.date.split('-').map(Number) as [number, number, number];
      expect(new Date(y, m - 1, d).getDay()).toBe(1); // 1 = Monday
    }
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
