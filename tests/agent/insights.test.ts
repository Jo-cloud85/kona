import { describe, expect, it } from 'vitest';
import { deriveInsights, similarSessionFlag, type InsightInput } from '../../src/agent/index';
import type { ActualSession, FuelLog, PersistedMemory, RecoveryLog } from '../../src/domain/types';

let n = 0;
function actual(over: Partial<ActualSession>): ActualSession {
  return {
    id: `a_${n++}`,
    user_id: 'u',
    kind: 'actual',
    sport: 'cycling',
    intensity: 'easy',
    start_at: '2026-09-01T07:00:00',
    status: 'completed',
    created_at: '2026-09-01T07:30:00Z',
    ...over,
  };
}
function recovery(over: Partial<RecoveryLog>): RecoveryLog {
  return { id: `r_${n++}`, user_id: 'u', logged_at: '2026-09-01T20:00:00Z', free_text: '', ...over };
}
function fuel(items: string[], logged_at = '2026-09-01T09:00:00Z'): FuelLog {
  return {
    id: `f_${n++}`,
    user_id: 'u',
    logged_at,
    items: items.map((description) => ({ description, certainty: 'user_reported' as const })),
  };
}

const EMPTY: InsightInput = { actualSessions: [], recoveryLogs: [], fuelLogs: [], memories: [] as PersistedMemory[] };

describe('deriveInsights', () => {
  it('returns nothing when there is not enough history', () => {
    expect(deriveInsights(EMPTY)).toEqual([]);
    expect(
      deriveInsights({ ...EMPTY, actualSessions: [actual({}), actual({})] }),
    ).toEqual([]); // only 2 sessions — below the 3 threshold
  });

  it('three completions with NO outcome signal is a frequency fact only — not "it works"', () => {
    const sessions = ['2026-09-01', '2026-09-04', '2026-09-08'].map((d) =>
      actual({ sport: 'running', start_at: `${d}T06:00:00`, status: 'completed' }),
    );
    const out = deriveInsights({ ...EMPTY, actualSessions: sessions });
    const freq = out.find((i) => i.kind === 'fact' && /completed your last 3 running sessions as planned/i.test(i.text));
    expect(freq?.basis).toBe('repeated');
    expect(freq?.certainty).toBe('high');
    // frequency alone must NOT produce a pattern or a "keep it" recommendation
    expect(out.some((i) => i.kind === 'pattern')).toBe(false);
    expect(out.some((i) => i.kind === 'recommendation')).toBe(false);
    expect(out.some((i) => /working|keep it/i.test(i.text))).toBe(false);
  });

  it('becomes an outcome-backed working setup only when recovery on those days was positive', () => {
    const sessions = ['2026-09-01', '2026-09-04', '2026-09-08'].map((d) =>
      actual({ sport: 'running', start_at: `${d}T06:00:00` }),
    );
    const recs = ['2026-09-01', '2026-09-04', '2026-09-08'].map((d) =>
      recovery({ logged_at: `${d}T20:00:00Z`, free_text: 'legs felt great', overall_severity: 'none' }),
    );
    const out = deriveInsights({ ...EMPTY, actualSessions: sessions, recoveryLogs: recs });
    const pattern = out.find((i) => i.kind === 'pattern');
    const rec = out.find((i) => i.kind === 'recommendation');
    expect(pattern?.basis).toBe('outcome');
    expect(pattern?.text).toMatch(/going well/i);
    expect(pattern?.text).toMatch(/felt good afterwards \(3 of 3\)/i);
    expect(rec?.basis).toBe('outcome');
    expect(rec?.text).toMatch(/looks like it's working/i);
  });

  it('FACT for a body part mentioned more than once — non-diagnostic', () => {
    const out = deriveInsights({
      ...EMPTY,
      recoveryLogs: [
        recovery({ logged_at: '2026-08-20T20:00:00Z', free_text: 'left hip a bit tight' }),
        recovery({ logged_at: '2026-09-05T20:00:00Z', reported_symptoms: ['right hip discomfort'], overall_severity: 'moderate' }),
      ],
    });
    const fact = out.find((i) => i.kind === 'fact' && /hip/i.test(i.text));
    expect(fact?.certainty).toBe('high');
    expect(fact?.evidence_count).toBe(2);
    expect(fact?.text).toMatch(/most recently 5 Sep/);
    expect(fact?.text.toLowerCase()).toContain("doesn't diagnose");
    // evidence explains why Kona believes it
    expect(fact?.evidence).toHaveLength(2);
    expect(fact?.evidence.some((e) => /felt significant/.test(e))).toBe(true);
    // a moderate+ severity also yields a gentle recommendation
    expect(out.some((i) => i.kind === 'recommendation' && /get it assessed/i.test(i.text))).toBe(true);
  });

  it('FACT when recent sessions repeatedly did not go to plan (no cause implied)', () => {
    const sessions = [
      actual({ start_at: '2026-09-01T07:00:00', status: 'stopped_early' }),
      actual({ start_at: '2026-09-03T07:00:00', status: 'completed' }),
      actual({ start_at: '2026-09-06T07:00:00', status: 'modified' }),
      actual({ start_at: '2026-09-09T07:00:00', status: 'skipped' }),
    ];
    const out = deriveInsights({ ...EMPTY, actualSessions: sessions });
    const fact = out.find((i) => i.kind === 'fact' && /didn't go as planned/i.test(i.text));
    expect(fact?.text).toMatch(/3 of your last 4/);
    expect(fact?.text).not.toMatch(/because|caused by|due to fuelling/i);
  });

  it('FACT for a fuel item logged 3+ times', () => {
    const out = deriveInsights({
      ...EMPTY,
      fuelLogs: [
        fuel(['2 SIS gels'], '2026-08-01T09:00:00Z'),
        fuel(['SIS gel', 'banana'], '2026-08-15T09:00:00Z'),
        fuel(['a SIS gel'], '2026-09-01T09:00:00Z'),
      ],
    });
    const fact = out.find((i) => i.kind === 'fact' && /sis gel/i.test(i.text));
    expect(fact?.text).toMatch(/logged sis gel 3 times/i);
    expect(fact?.topic).toBe('fuelling');
  });
});

describe('similarSessionFlag (M24.2 — single comparable session)', () => {
  it('returns null with no history at all', () => {
    expect(
      similarSessionFlag({ sport: 'running', is_long: true, intensity: 'easy' }, { actualSessions: [], recoveryLogs: [] }),
    ).toBeNull();
  });

  it('no insight merely because two sessions share a sport — a short easy run is not evidence for a long run', () => {
    const sessions = [actual({ sport: 'running', is_long: false, intensity: 'easy', start_at: '2026-09-01T06:00:00' })];
    const recs = [recovery({ logged_at: '2026-09-01T20:00:00Z', free_text: 'felt really thirsty by the end' })];
    const flag = similarSessionFlag(
      { sport: 'running', is_long: true, intensity: 'easy' },
      { actualSessions: sessions, recoveryLogs: recs },
    );
    expect(flag).toBeNull();
  });

  it('a comparable session with nothing notable to report yields no insight (comparability alone is not evidence)', () => {
    const sessions = [actual({ sport: 'running', is_long: true, intensity: 'easy', start_at: '2026-09-01T18:00:00' })];
    const recs = [recovery({ logged_at: '2026-09-01T20:00:00Z', free_text: 'legs felt great, no issues' })];
    const flag = similarSessionFlag(
      { sport: 'running', is_long: true, intensity: 'easy' },
      { actualSessions: sessions, recoveryLogs: recs },
    );
    expect(flag).toBeNull();
  });

  it('a genuinely comparable long evening run with a reported hydration flag becomes a single-instance FACT', () => {
    const sessions = [actual({ sport: 'running', is_long: true, intensity: 'easy', start_at: '2026-09-01T18:00:00' })];
    const recs = [
      recovery({ logged_at: '2026-09-01T21:00:00Z', free_text: 'got really thirsty during the last third' }),
    ];
    const flag = similarSessionFlag(
      { sport: 'running', is_long: true, intensity: 'easy' },
      { actualSessions: sessions, recoveryLogs: recs },
    );
    expect(flag).not.toBeNull();
    expect(flag?.category).toBe('thirst');
    expect(flag?.basis).toBe('reported'); // ONE instance — never 'outcome' or 'repeated'
    expect(flag?.text).toContain('1 Sep');
    expect(flag?.text).toContain('thirsty during the last third');
    expect(flag?.evidence).toHaveLength(1);
  });

  it('prefers the most recent genuinely comparable session, even over a more dramatic older one', () => {
    const sessions = [
      actual({ sport: 'running', is_long: true, intensity: 'easy', start_at: '2026-08-01T18:00:00' }),
      actual({ sport: 'running', is_long: true, intensity: 'easy', start_at: '2026-09-10T18:00:00' }),
    ];
    const recs = [
      recovery({ logged_at: '2026-08-01T21:00:00Z', free_text: 'stomach cramped badly, awful run' }),
      recovery({ logged_at: '2026-09-10T21:00:00Z', free_text: 'felt fine, no issues' }),
    ];
    // The most recent one (10 Sep) was uneventful, so there is nothing to flag —
    // it must NOT fall back to the older dramatic one.
    const flag = similarSessionFlag(
      { sport: 'running', is_long: true, intensity: 'easy' },
      { actualSessions: sessions, recoveryLogs: recs },
    );
    expect(flag).toBeNull();
  });

  it('a stopped_early session with no recovery log still flags, from the session record alone', () => {
    const sessions = [
      actual({ sport: 'cycling', is_long: true, intensity: 'hard', start_at: '2026-09-05T07:00:00', status: 'stopped_early' }),
    ];
    const flag = similarSessionFlag(
      { sport: 'cycling', is_long: true, intensity: 'hard' },
      { actualSessions: sessions, recoveryLogs: [] },
    );
    expect(flag?.category).toBe('stopped_early');
    expect(flag?.basis).toBe('reported');
  });

  it('a non-long session matches on intensity instead', () => {
    const sessions = [actual({ sport: 'running', is_long: false, intensity: 'hard', start_at: '2026-09-01T18:00:00' })];
    const recs = [recovery({ logged_at: '2026-09-01T21:00:00Z', free_text: 'cramped up badly near the end' })];
    const flag = similarSessionFlag(
      { sport: 'running', is_long: false, intensity: 'hard' },
      { actualSessions: sessions, recoveryLogs: recs },
    );
    expect(flag?.category).toBe('cramp');

    // A different intensity, same non-long shape, is not comparable.
    const noMatch = similarSessionFlag(
      { sport: 'running', is_long: false, intensity: 'easy' },
      { actualSessions: sessions, recoveryLogs: recs },
    );
    expect(noMatch).toBeNull();
  });

  it('an 18km run is "long" by distance even when is_long was never explicitly set (real alpha gap, 2026-09-14)', () => {
    // 18km at an easy running pace (~6 min/km) is 108 min — LONG per the
    // engine's own duration_classes (>=90, <=150) — regardless of the is_long flag.
    const sessions = [
      actual({ sport: 'running', is_long: undefined, intensity: 'easy', distance_km: 18, start_at: '2026-09-07T18:00:00' }),
    ];
    const recs = [recovery({ logged_at: '2026-09-07T21:00:00Z', free_text: 'got very thirsty in the final third' })];
    const flag = similarSessionFlag(
      { sport: 'running', is_long: true, intensity: 'easy' },
      { actualSessions: sessions, recoveryLogs: recs },
    );
    expect(flag).not.toBeNull();
    expect(flag?.category).toBe('thirst');
  });
});
