import { describe, expect, it } from 'vitest';
import { deriveInsights, type InsightInput } from '../../src/agent/index';
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

  it('PATTERN + RECOMMENDATION when a per-sport routine keeps going to plan', () => {
    const sessions = ['2026-09-01', '2026-09-04', '2026-09-08'].map((d) =>
      actual({ sport: 'running', start_at: `${d}T06:00:00`, status: 'completed' }),
    );
    const out = deriveInsights({ ...EMPTY, actualSessions: sessions });
    const pattern = out.find((i) => i.kind === 'pattern');
    const rec = out.find((i) => i.kind === 'recommendation');
    expect(pattern?.text).toMatch(/last 3 running sessions all went to plan/i);
    expect(pattern?.certainty).toBe('moderate');
    expect(pattern?.evidence).toHaveLength(3); // one line per session
    expect(pattern?.evidence[0]).toMatch(/running/);
    expect(rec?.text).toMatch(/keep it rather than change/i);
  });

  it('strengthens the pattern when recovery on those days was positive', () => {
    const sessions = ['2026-09-01', '2026-09-04', '2026-09-08'].map((d) =>
      actual({ sport: 'running', start_at: `${d}T06:00:00` }),
    );
    const recs = ['2026-09-01', '2026-09-04', '2026-09-08'].map((d) =>
      recovery({ logged_at: `${d}T20:00:00Z`, free_text: 'legs felt great', overall_severity: 'none' }),
    );
    const out = deriveInsights({ ...EMPTY, actualSessions: sessions, recoveryLogs: recs });
    expect(out.find((i) => i.kind === 'pattern')?.text).toMatch(/felt good after them/i);
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
