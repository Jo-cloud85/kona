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

describe('buildConsistencyDays (M27.1 — four states)', () => {
  it('is empty on a day with no logged session', () => {
    const days = buildConsistencyDays([], new Set(), NOW);
    expect(dayFor(days, '2026-09-19')?.state).toBe('empty');
  });

  it('is easy for a completed easy session with no other signal', () => {
    const sessions = [actual({ start_at: '2026-09-19T06:00:00', intensity: 'easy' })];
    const days = buildConsistencyDays(sessions, new Set(), NOW);
    expect(dayFor(days, '2026-09-19')?.state).toBe('easy');
  });

  it('is normal for a completed moderate/hard session, pain-free, followed as planned', () => {
    const sessions = [actual({ start_at: '2026-09-19T06:00:00', intensity: 'hard' })];
    const days = buildConsistencyDays(sessions, new Set(), NOW);
    expect(dayFor(days, '2026-09-19')?.state).toBe('normal');
  });

  it('flags a day that did not go as planned', () => {
    const sessions = [actual({ start_at: '2026-09-19T06:00:00', intensity: 'easy', status: 'skipped' })];
    const days = buildConsistencyDays(sessions, new Set(), NOW);
    expect(dayFor(days, '2026-09-19')?.state).toBe('flag');
  });

  it('flags a day with a reported pain/injury check-in, even for an easy session', () => {
    const sessions = [actual({ start_at: '2026-09-19T06:00:00', intensity: 'easy' })];
    const days = buildConsistencyDays(sessions, new Set(['2026-09-19']), NOW);
    expect(dayFor(days, '2026-09-19')?.state).toBe('flag');
  });

  it('flags a hard day that is part of a cluster (2+ hard/race days within the trailing 4-day window)', () => {
    const sessions = [
      actual({ start_at: '2026-09-17T06:00:00', intensity: 'hard' }),
      actual({ start_at: '2026-09-19T06:00:00', intensity: 'hard' }),
    ];
    const days = buildConsistencyDays(sessions, new Set(), NOW);
    expect(dayFor(days, '2026-09-17')?.state).toBe('flag');
    expect(dayFor(days, '2026-09-19')?.state).toBe('flag');
  });

  it('does not flag a lone hard day outside any cluster', () => {
    const sessions = [actual({ start_at: '2026-09-19T06:00:00', intensity: 'hard' })];
    const days = buildConsistencyDays(sessions, new Set(), NOW);
    expect(dayFor(days, '2026-09-19')?.state).toBe('normal');
  });

  it('marks is_today only for the athlete-local current date', () => {
    const days = buildConsistencyDays([], new Set(), NOW);
    expect(dayFor(days, '2026-09-20')?.is_today).toBe(true);
    expect(dayFor(days, '2026-09-19')?.is_today).toBe(false);
  });

  it('spans exactly 168 days (24 weeks)', () => {
    expect(buildConsistencyDays([], new Set(), NOW)).toHaveLength(168);
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
