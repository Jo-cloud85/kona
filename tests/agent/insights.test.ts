import { describe, expect, it } from 'vitest';
import {
  buildCheckinLog,
  deriveInsights,
  learnedCategoryInsights,
  recentSessionRead,
  similarSessionFlag,
  type InsightInput,
} from '../../src/agent/index';
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

  it('does not fabricate a "cramping" pattern from ordinary check-ins about unrelated symptoms (2026-09-19 regression — the old free_text boilerplate contained the literal word "cramps" on every "pains: yes" answer)', () => {
    const knee = buildCheckinLog({ legs: 'heavy', went_as_planned: true, pains: true, elaborate: 'left knee ached a bit' });
    const soreness = buildCheckinLog({ legs: 'heavy', went_as_planned: true, pains: true, elaborate: 'general soreness, nothing specific' });
    const out = deriveInsights({
      ...EMPTY,
      recoveryLogs: [
        recovery({ logged_at: '2026-09-16T20:00:00Z', free_text: knee.free_text, reported_symptoms: knee.reported_symptoms }),
        recovery({ logged_at: '2026-09-17T20:00:00Z', free_text: soreness.free_text, reported_symptoms: soreness.reported_symptoms }),
      ],
    });
    expect(out.some((i) => /cramp/i.test(i.text))).toBe(false);
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

describe('recentSessionRead (M25.1 — the most recent session within a lookback window)', () => {
  const TODAY = '2026-09-14';

  it('returns null with no sessions at all', () => {
    expect(recentSessionRead(TODAY, 2, { actualSessions: [], recoveryLogs: [] })).toBeNull();
  });

  it('returns null when the only session is outside the lookback window', () => {
    const sessions = [actual({ start_at: '2026-09-10T07:00:00' })]; // 4 days back
    expect(recentSessionRead(TODAY, 2, { actualSessions: sessions, recoveryLogs: [] })).toBeNull();
  });

  it('reads a stopped_early session as negative, from the record alone', () => {
    const sessions = [actual({ start_at: '2026-09-13T07:00:00', status: 'stopped_early' })];
    const read = recentSessionRead(TODAY, 2, { actualSessions: sessions, recoveryLogs: [] });
    expect(read?.outcome).toBe('negative');
    expect(read?.date).toBe('2026-09-13');
  });

  it('reads a positive recovery note as positive', () => {
    const sessions = [actual({ start_at: '2026-09-13T07:00:00' })];
    const recs = [recovery({ logged_at: '2026-09-13T20:00:00Z', free_text: 'felt great, no issues' })];
    const read = recentSessionRead(TODAY, 2, { actualSessions: sessions, recoveryLogs: recs });
    expect(read?.outcome).toBe('positive');
  });

  it('with no outcome signal at all, outcome is null — NOT read as fine', () => {
    const sessions = [actual({ start_at: '2026-09-13T07:00:00' })];
    const read = recentSessionRead(TODAY, 2, { actualSessions: sessions, recoveryLogs: [] });
    expect(read?.outcome).toBeNull();
  });

  it('reads "gassed" as trouble — real alpha phrasing, 2026-09-14', () => {
    const sessions = [actual({ start_at: '2026-09-13T18:00:00', status: 'completed' })];
    const recs = [recovery({ logged_at: '2026-09-13T21:00:00Z', free_text: 'legs completely gassed by the end' })];
    const read = recentSessionRead(TODAY, 2, { actualSessions: sessions, recoveryLogs: recs });
    expect(read?.outcome).toBe('negative');
  });

  it('picks the single most recent session within the window, not an older one', () => {
    const sessions = [
      actual({ start_at: '2026-09-12T07:00:00', status: 'stopped_early' }),
      actual({ start_at: '2026-09-13T07:00:00', status: 'completed' }),
    ];
    const read = recentSessionRead(TODAY, 2, { actualSessions: sessions, recoveryLogs: [] });
    expect(read?.date).toBe('2026-09-13');
    expect(read?.outcome).toBeNull(); // the more recent one has no trouble signal
  });
});

describe('learnedCategoryInsights (M27) — "Kona learned: X", not a self-graded track record', () => {
  function followed(category: string, outcome: 'better' | 'worse' | 'same'): RecoveryLog {
    return recovery({ followed_category: category, followed_outcome: outcome });
  }

  it('needs at least 2 "better" outcomes for the same category before saying anything', () => {
    expect(learnedCategoryInsights([followed('thirst', 'better')])).toEqual([]);
    const two = learnedCategoryInsights([followed('thirst', 'better'), followed('thirst', 'better')]);
    expect(two).toHaveLength(1);
    expect(two[0]!.category).toBe('thirst');
    expect(two[0]!.text).toMatch(/extra fluid/i);
  });

  it('"worse"/"same" outcomes count toward the total shown but never toward the "better" count', () => {
    const logs = [followed('cramp', 'better'), followed('cramp', 'better'), followed('cramp', 'worse')];
    const out = learnedCategoryInsights(logs);
    expect(out).toHaveLength(1);
    expect(out[0]!.count).toBe(2);
    expect(out[0]!.text).toMatch(/based on 2 of your last 3/i);
  });

  it('categories are tracked independently', () => {
    const logs = [
      followed('thirst', 'better'),
      followed('thirst', 'better'),
      followed('gi', 'better'), // only 1 — not enough yet
    ];
    const out = learnedCategoryInsights(logs);
    expect(out.map((l) => l.category)).toEqual(['thirst']);
  });

  it('logs with no followed_category (an ordinary check-in) are ignored, not miscounted', () => {
    const logs = [recovery({ free_text: 'felt fine' }), followed('thirst', 'better'), followed('thirst', 'better')];
    expect(learnedCategoryInsights(logs)).toHaveLength(1);
  });
});
