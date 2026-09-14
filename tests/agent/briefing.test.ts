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

describe('buildKonaBriefing — tier 5: honest default', () => {
  it('nothing meaningful coming up — honest, explicit "nothing to prepare" (quality bar 4)', () => {
    const b = buildKonaBriefing({ today: TODAY, sessions: [], actualSessions: [], recoveryLogs: [] });
    expect(b.action).toMatch(/nothing meaningful/i);
    expect(b.why).toBeNull();
    expect(b.date).toBeNull();
    expect(b.session_label).toBeNull();
    expect(b.headline).toBeTruthy(); // always present, even the honest default
  });
});

describe('buildKonaBriefing — tier 4: upcoming meaningful session (M24, unchanged in substance)', () => {
  it('a meaningful session with no comparable history — honest default action, no fabricated "why"', () => {
    const s = session({ start_at: `${TODAY}T18:00:00`, is_long: true, sport: 'running' });
    const b = buildKonaBriefing({ today: TODAY, sessions: [s], actualSessions: [], recoveryLogs: [] });
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
    expect(b.headline).toMatch(/bring extra fluid/i);
    expect(b.why).toContain('thirsty');
    expect(b.basis).toBe('reported');
  });

  it('session_label names a double-session day', () => {
    const run = session({ start_at: '2026-09-15T06:00:00', sport: 'running', is_long: false, intensity: 'easy' });
    const swim = session({ start_at: '2026-09-15T18:00:00', sport: 'swimming', is_long: false, intensity: 'easy' });
    const b = buildKonaBriefing({
      today: TODAY,
      sessions: [run, swim],
      actualSessions: [],
      recoveryLogs: [],
    });
    expect(b.when).toBe('Tomorrow');
    expect(b.session_label).toMatch(/double session/i);
  });
});

describe('buildKonaBriefing — tier 1: a recent bad outcome, and today trains (M25.1)', () => {
  it('yesterday stopped early + today has a session -> "keep today easy", with why + deviation', () => {
    const plan = session({ start_at: '2026-09-13T18:00:00', sport: 'cycling', distance_km: 40, intensity: 'moderate' });
    const yesterday = actual({
      id: 'a-yesterday',
      sport: 'cycling',
      start_at: '2026-09-13T18:00:00',
      distance_km: 22,
      status: 'stopped_early',
      planned_session_id: plan.id,
      reason: 'legs felt heavy',
    });
    const today = session({ start_at: `${TODAY}T06:00:00`, sport: 'running', intensity: 'easy' });
    const b = buildKonaBriefing({
      today: TODAY,
      sessions: [plan, today],
      actualSessions: [yesterday],
      recoveryLogs: [],
    });
    expect(b.when).toBe('Today');
    expect(b.headline).toMatch(/keep today easy/i);
    expect(b.why).toContain('Yesterday');
    expect(b.why).toContain('ride'); // sportLabel(cycling) => "ride"
    expect(b.basis).toBe('reported');
    expect(b.deviation).toEqual({ planned: '40 km', actual: '22 km', reason: 'legs felt heavy' });
  });

  it('does not fire when today has nothing planned, even after a bad session', () => {
    const yesterday = actual({ start_at: '2026-09-13T18:00:00', status: 'stopped_early' });
    const b = buildKonaBriefing({ today: TODAY, sessions: [], actualSessions: [yesterday], recoveryLogs: [] });
    expect(b.headline).not.toMatch(/keep today easy/i);
  });

  it('does not fire when the recent session has no outcome signal at all — silence, not a guess', () => {
    const yesterday = actual({ start_at: '2026-09-13T18:00:00', status: 'completed' });
    const today = session({ start_at: `${TODAY}T06:00:00` });
    const b = buildKonaBriefing({ today: TODAY, sessions: [today], actualSessions: [yesterday], recoveryLogs: [] });
    expect(b.headline).not.toMatch(/keep today easy/i);
  });

  it('outranks an upcoming meaningful session (tier 1 beats tier 4)', () => {
    const yesterday = actual({ start_at: '2026-09-13T18:00:00', status: 'stopped_early' });
    // Today is itself a long run — tier 4 would happily talk about this instead.
    const today = session({ start_at: `${TODAY}T06:00:00`, is_long: true, sport: 'running' });
    const b = buildKonaBriefing({ today: TODAY, sessions: [today], actualSessions: [yesterday], recoveryLogs: [] });
    expect(b.headline).toMatch(/keep today easy/i);
  });
});

describe('buildKonaBriefing — tier 2: an unacknowledged planned session (M25.1)', () => {
  it('a planned session 2 days back with no actual record -> "don\'t chase" it, not the recent-outcome tier', () => {
    const missed = session({ start_at: '2026-09-12T06:00:00', sport: 'running', distance_km: 8 });
    const b = buildKonaBriefing({ today: TODAY, sessions: [missed], actualSessions: [], recoveryLogs: [] });
    expect(b.headline).toMatch(/don't chase/i);
    expect(b.why).toMatch(/no record it happened/i);
    expect(b.basis).toBeNull(); // an absence, not a claim with evidence behind it
  });

  it('does not fire once an actual session exists for that date, regardless of outcome', () => {
    const missed = session({ start_at: '2026-09-12T06:00:00', sport: 'running' });
    const logged = actual({ start_at: '2026-09-12T06:00:00', sport: 'running', status: 'completed' });
    const b = buildKonaBriefing({ today: TODAY, sessions: [missed], actualSessions: [logged], recoveryLogs: [] });
    expect(b.headline).not.toMatch(/don't chase/i);
  });

  it('only looks back 3 days, not indefinitely', () => {
    const old = session({ start_at: '2026-09-09T06:00:00', sport: 'running' }); // 5 days back
    const b = buildKonaBriefing({ today: TODAY, sessions: [old], actualSessions: [], recoveryLogs: [] });
    expect(b.headline).not.toMatch(/don't chase/i);
  });
});

describe('buildKonaBriefing — tier 3: an emerging pattern (M25.1)', () => {
  it('surfaces the top pattern insight verbatim when nothing more immediate applies', () => {
    const dates = ['2026-08-24', '2026-08-28', '2026-09-01'];
    const sessions = dates.map((d) => actual({ sport: 'running', start_at: `${d}T06:00:00`, status: 'completed' }));
    const recs = dates.map((d) =>
      recovery({ logged_at: `${d}T20:00:00Z`, free_text: 'felt strong, no issues', overall_severity: 'none' }),
    );
    const b = buildKonaBriefing({ today: TODAY, sessions: [], actualSessions: sessions, recoveryLogs: recs });
    expect(b.headline).toMatch(/emerging pattern/i);
    expect(b.why).toMatch(/running sessions have been going well/i);
    expect(b.basis).toBe('outcome');
  });
});
