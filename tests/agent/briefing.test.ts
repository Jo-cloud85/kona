import { describe, expect, it } from 'vitest';
import { buildKonaBriefing, findNextMeaningfulSession } from '../../src/agent/index';
import type { ActualSession, PlannedSession, RecoveryLog } from '../../src/domain/types';

let n = 0;
function session(over: Partial<PlannedSession>): PlannedSession {
  return {
    id: `p_${n++}`,
    user_id: 'u',
    kind: 'planned',
    sport: 'running',
    intensity: 'easy',
    start_at: '2026-09-14T06:00:00',
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}
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
function recovery(over: Partial<RecoveryLog>): RecoveryLog {
  return { id: `r_${n++}`, user_id: 'u', logged_at: '2026-09-01T21:00:00Z', free_text: '', ...over };
}

const TODAY = '2026-09-14'; // a Monday

describe('findNextMeaningfulSession', () => {
  it('finds today when today itself is long', () => {
    const s = session({ start_at: `${TODAY}T18:00:00`, is_long: true });
    expect(findNextMeaningfulSession([s], TODAY)).toEqual({ date: TODAY, sessions: [s] });
  });

  it('an easy, non-long, single session today is NOT meaningful — looks further ahead', () => {
    const today = session({ start_at: `${TODAY}T06:00:00`, is_long: false, intensity: 'easy' });
    const thu = session({ start_at: '2026-09-17T18:00:00', is_long: true });
    expect(findNextMeaningfulSession([today, thu], TODAY)).toEqual({ date: '2026-09-17', sessions: [thu] });
  });

  it('a double-session day counts even when neither session alone is long/hard', () => {
    const run = session({ start_at: '2026-09-15T06:00:00', sport: 'running', is_long: false, intensity: 'easy' });
    const swim = session({ start_at: '2026-09-15T18:00:00', sport: 'swimming', is_long: false, intensity: 'easy' });
    expect(findNextMeaningfulSession([run, swim], TODAY)?.date).toBe('2026-09-15');
  });

  it('a hard (non-long) session is meaningful', () => {
    const s = session({ start_at: '2026-09-16T06:00:00', is_long: false, intensity: 'hard' });
    expect(findNextMeaningfulSession([s], TODAY)?.date).toBe('2026-09-16');
  });

  it('returns null when nothing meaningful is planned within the window', () => {
    const s = session({ start_at: '2026-09-16T06:00:00', is_long: false, intensity: 'easy' });
    expect(findNextMeaningfulSession([s], TODAY)).toBeNull();
  });

  it('returns null with no sessions at all', () => {
    expect(findNextMeaningfulSession([], TODAY)).toBeNull();
  });

  it('an 18km run is meaningful by distance alone, without an explicit is_long flag (real alpha gap, 2026-09-14)', () => {
    const s = session({ start_at: '2026-09-15T18:00:00', sport: 'running', distance_km: 18, intensity: 'easy' });
    expect(findNextMeaningfulSession([s], TODAY)?.date).toBe('2026-09-15');
  });

  it('a genuinely short run stays NOT meaningful even with a distance set', () => {
    const s = session({ start_at: '2026-09-15T18:00:00', sport: 'running', distance_km: 5, intensity: 'easy' });
    expect(findNextMeaningfulSession([s], TODAY)).toBeNull();
  });

  it('does not look past the horizon', () => {
    const s = session({ start_at: '2026-09-25T06:00:00', is_long: true }); // 11 days out
    expect(findNextMeaningfulSession([s], TODAY, 7)).toBeNull();
  });
});

describe('buildKonaBriefing', () => {
  it('nothing meaningful coming up — honest, explicit "nothing to prepare" (quality bar 4)', () => {
    const b = buildKonaBriefing({ today: TODAY, sessions: [], actualSessions: [], recoveryLogs: [] });
    expect(b.has_target).toBe(false);
    expect(b.action).toMatch(/nothing meaningful/i);
    expect(b.why).toBeNull();
    expect(b.date).toBeNull();
  });

  it('a meaningful session with no comparable history — honest default action, no fabricated "why"', () => {
    const s = session({ start_at: `${TODAY}T18:00:00`, is_long: true, sport: 'running' });
    const b = buildKonaBriefing({ today: TODAY, sessions: [s], actualSessions: [], recoveryLogs: [] });
    expect(b.has_target).toBe(true);
    expect(b.when).toBe('Today');
    expect(b.action).toMatch(/nothing special/i);
    expect(b.why).toBeNull();
    expect(b.basis).toBeNull();
  });

  it('a genuinely comparable session with a reported flag produces a specific action + why (quality bar 2)', () => {
    const target = session({ start_at: `${TODAY}T18:00:00`, is_long: true, sport: 'running' });
    const past = actual({ sport: 'running', is_long: true, intensity: 'easy', start_at: '2026-09-07T18:00:00' });
    const rec = recovery({ logged_at: '2026-09-07T21:00:00Z', free_text: 'got very thirsty in the final third' });
    const b = buildKonaBriefing({
      today: TODAY,
      sessions: [target],
      actualSessions: [past],
      recoveryLogs: [rec],
    });
    expect(b.action).toMatch(/bring extra fluid/i);
    expect(b.why).toContain('thirsty');
    expect(b.basis).toBe('reported');
  });

  it('headline names a double-session day', () => {
    const run = session({ start_at: '2026-09-15T06:00:00', sport: 'running', is_long: false, intensity: 'easy' });
    const swim = session({ start_at: '2026-09-15T18:00:00', sport: 'swimming', is_long: false, intensity: 'easy' });
    const b = buildKonaBriefing({
      today: TODAY,
      sessions: [run, swim],
      actualSessions: [],
      recoveryLogs: [],
    });
    expect(b.when).toBe('Tomorrow');
    expect(b.headline).toMatch(/double session/i);
  });
});
