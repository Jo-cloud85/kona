import { describe, expect, it } from 'vitest';
import { deriveInsights, deriveTurnEvents, type Insight, type InsightInput } from '../../src/agent/index';
import type { ActualSession, RecoveryLog } from '../../src/domain/types';

/**
 * M22 — Product Truth Audit acceptance tests.
 *
 * The distinction Kona must never blur:
 *   reported   — the athlete literally said it
 *   repeated   — it happened N times (FREQUENCY ONLY — not "it works")
 *   outcome    — repetition + a consistent good/bad result
 *   adaptation — a LATER recommendation actually used earlier evidence
 *
 * Conservative, no-diagnosis philosophy is preserved throughout.
 */

let n = 0;
function ride(over: Partial<ActualSession>): ActualSession {
  return {
    id: `a_${n++}`,
    user_id: 'u',
    kind: 'actual',
    sport: 'cycling',
    intensity: 'moderate',
    start_at: '2026-09-01T07:00:00',
    status: 'completed',
    created_at: '2026-09-01T08:00:00Z',
    ...over,
  };
}
function felt(date: string, free_text: string, over: Partial<RecoveryLog> = {}): RecoveryLog {
  return { id: `r_${n++}`, user_id: 'u', logged_at: `${date}T20:00:00Z`, free_text, ...over };
}
const EMPTY: InsightInput = { actualSessions: [], recoveryLogs: [], fuelLogs: [], memories: [] };

const has = (out: Insight[], p: (i: Insight) => boolean) => out.some(p);
const noCausalLanguage = (t: string) =>
  expect(t).not.toMatch(/\b(because of|caused by|due to|is causing|your fault|you failed|blame)\b/i);

describe('M22 product truth — successful repetition', () => {
  const dates = ['2026-08-28', '2026-09-01', '2026-09-05'];

  it('repetition WITHOUT an outcome signal is a frequency fact only — never "it works"', () => {
    const out = deriveInsights({
      ...EMPTY,
      actualSessions: dates.map((d) => ride({ start_at: `${d}T07:00:00`, status: 'completed' })),
    });
    const freq = out.find((i) => /completed your last 3 cycling sessions as planned/i.test(i.text));
    expect(freq?.kind).toBe('fact');
    expect(freq?.basis).toBe('repeated');
    expect(has(out, (i) => i.kind === 'pattern')).toBe(false);
    expect(has(out, (i) => i.kind === 'recommendation')).toBe(false);
    expect(has(out, (i) => /working|keep (it|doing)/i.test(i.text))).toBe(false);
  });

  it('repetition WITH consistent positive outcomes becomes an outcome-backed working setup', () => {
    const out = deriveInsights({
      ...EMPTY,
      actualSessions: dates.map((d) => ride({ start_at: `${d}T07:00:00`, status: 'completed' })),
      recoveryLogs: dates.map((d) => felt(d, 'legs felt strong, no issues', { overall_severity: 'none' })),
    });
    const pattern = out.find((i) => i.kind === 'pattern');
    const rec = out.find((i) => i.kind === 'recommendation');
    expect(pattern?.basis).toBe('outcome');
    expect(pattern?.text).toMatch(/going well/i);
    expect(rec?.basis).toBe('outcome');
    expect(rec?.text).toMatch(/looks like it's working/i);
    // the frequency fact is still there and still just a count
    expect(has(out, (i) => i.basis === 'repeated' && /completed your last 3/i.test(i.text))).toBe(true);
  });
});

describe('M22 product truth — repeated failure', () => {
  it('several flagged bad sessions → an outcome FACT, non-diagnostic, with no "keep it" recommendation', () => {
    const dates = ['2026-08-26', '2026-08-30', '2026-09-03', '2026-09-07'];
    const out = deriveInsights({
      ...EMPTY,
      actualSessions: dates.map((d) => ride({ start_at: `${d}T07:00:00`, status: 'completed' })),
      recoveryLogs: [
        felt('2026-08-30', 'bonked hard, no energy left'),
        felt('2026-09-03', 'really struggled, felt rough the whole way'),
        felt('2026-09-07', 'hit the wall again'),
      ],
    });
    const trouble = out.find((i) => /repeatedly run into problems/i.test(i.text));
    expect(trouble?.kind).toBe('fact');
    expect(trouble?.basis).toBe('outcome');
    expect(trouble?.certainty).toBe('high');
    expect(trouble?.text).toMatch(/doesn't diagnose/i);
    noCausalLanguage(trouble!.text);
    // it must NOT tell them the setup works, and must not recommend "keeping" anything
    expect(has(out, (i) => i.kind === 'recommendation' && /keep/i.test(i.text))).toBe(false);
    expect(has(out, (i) => i.kind === 'pattern' && /going well/i.test(i.text))).toBe(false);
  });
});

describe('M22 product truth — conflicting evidence', () => {
  it('good and bad with no clean reason → says so, low certainty, and recommends nothing', () => {
    const dates = ['2026-08-26', '2026-08-30', '2026-09-03', '2026-09-07'];
    const out = deriveInsights({
      ...EMPTY,
      actualSessions: dates.map((d) =>
        ride({ start_at: `${d}T07:00:00`, status: 'completed', time_of_day: 'morning', pre_fed_state: 'fed' }),
      ),
      recoveryLogs: [
        felt('2026-08-26', 'felt great, easy day'),
        felt('2026-08-30', 'bonked hard'),
        felt('2026-09-03', 'strong, no issues'),
        felt('2026-09-07', 'hit the wall, no energy'),
      ],
    });
    const mixed = out.find((i) => /mixed/i.test(i.text));
    expect(mixed?.kind).toBe('fact');
    expect(mixed?.basis).toBe('outcome');
    expect(mixed?.certainty).toBe('low');
    expect(mixed?.text).toMatch(/not enough to change anything on/i);
    expect(has(out, (i) => i.kind === 'recommendation')).toBe(false);
  });
});

describe('M22 product truth — new / unproven setup', () => {
  it('a single session with an outcome note → "too early", never a working-setup claim', () => {
    const out = deriveInsights({
      ...EMPTY,
      actualSessions: [ride({ sport: 'swimming', start_at: '2026-09-05T07:00:00', status: 'completed' })],
      recoveryLogs: [felt('2026-09-05', 'felt strong in the water')],
    });
    const unproven = out.find((i) => /once so far/i.test(i.text));
    expect(unproven?.kind).toBe('fact');
    expect(unproven?.basis).toBe('repeated');
    expect(unproven?.certainty).toBe('low');
    expect(unproven?.text).toMatch(/isn't enough/i);
    expect(has(out, (i) => i.kind === 'pattern' || i.kind === 'recommendation')).toBe(false);
  });
});

describe('M22 product truth — different outcomes under different conditions', () => {
  it('bad vs good split cleanly on fed/fasted → a condition PATTERN with no causal claim', () => {
    const out = deriveInsights({
      ...EMPTY,
      actualSessions: [
        ride({ start_at: '2026-08-26T07:00:00', pre_fed_state: 'fasted' }),
        ride({ start_at: '2026-08-30T07:00:00', pre_fed_state: 'fed' }),
        ride({ start_at: '2026-09-03T07:00:00', pre_fed_state: 'fasted' }),
        ride({ start_at: '2026-09-07T07:00:00', pre_fed_state: 'fed' }),
      ],
      recoveryLogs: [
        felt('2026-08-26', 'bonked hard, no energy'),
        felt('2026-08-30', 'felt great'),
        felt('2026-09-03', 'really struggled, felt rough'),
        felt('2026-09-07', 'strong, no issues'),
      ],
    });
    const cond = out.find((i) => i.kind === 'pattern' && /depending on conditions/i.test(i.text));
    expect(cond?.basis).toBe('outcome');
    expect(cond?.certainty).toBe('low');
    expect(cond?.text).toMatch(/done fasted/i);
    expect(cond?.text).toMatch(/isn't pinning down a cause/i);
    noCausalLanguage(cond!.text);
    // condition-dependent is NOT a green light — no "keep it" recommendation
    expect(has(out, (i) => i.kind === 'recommendation')).toBe(false);
  });

  it('splits on heat when that is the clean variable', () => {
    const out = deriveInsights({
      ...EMPTY,
      actualSessions: [
        ride({ start_at: '2026-08-26T07:00:00', environment: { temperature_c: 14 } }),
        ride({ start_at: '2026-08-30T16:00:00', environment: { temperature_c: 31 } }),
        ride({ start_at: '2026-09-03T07:00:00', environment: { temperature_c: 12 } }),
        ride({ start_at: '2026-09-07T16:00:00', environment: { temperature_c: 30 } }),
      ],
      recoveryLogs: [
        felt('2026-08-26', 'felt great'),
        felt('2026-08-30', 'hit the wall, no energy'),
        felt('2026-09-03', 'strong, no issues'),
        felt('2026-09-07', 'really struggled, felt rough'),
      ],
    });
    expect(out.find((i) => i.kind === 'pattern')?.text).toMatch(/in the heat/i);
  });
});

describe('M22 product truth — actual recommendation adaptation', () => {
  const rec: Insight = {
    kind: 'recommendation',
    basis: 'outcome',
    text: "What you're doing for cycling looks like it's working — worth keeping it steady rather than changing several things at once.",
    certainty: 'moderate',
    evidence_count: 3,
    topic: 'training',
    evidence: [],
  };
  const pat: Insight = { ...rec, kind: 'pattern', text: 'Your cycling sessions have been going well.' };

  it('a brand-new recommendation is only "Kona\'s take" — nothing is claimed adapted yet', () => {
    const ev = deriveTurnEvents({
      userId: 'u',
      toolResults: [{ tool: 'calculate_fueling_targets', ok: true }],
      knownInsightTexts: new Set(),
      insightsAfter: [rec],
      adviceProducedThisTurn: true,
    });
    expect(ev.map((e) => e.type)).toEqual(['insight_formed']);
    expect(ev[0]!.summary).toMatch(/^Kona's take — /);
  });

  it('recommendation_adapted fires only when a LATER turn\'s advice actually used it — once', () => {
    const known = new Set([rec.text]);
    const withAdvice = deriveTurnEvents({
      userId: 'u',
      toolResults: [{ tool: 'calculate_fueling_targets', ok: true }],
      knownInsightTexts: known,
      insightsAfter: [rec],
      adviceProducedThisTurn: true,
    });
    expect(withAdvice.map((e) => e.type)).toEqual(['recommendation_adapted']);
    expect(withAdvice[0]!.summary).toMatch(/applied what it's learned/i);

    const already = deriveTurnEvents({
      userId: 'u',
      toolResults: [{ tool: 'calculate_fueling_targets', ok: true }],
      knownInsightTexts: known,
      insightsAfter: [rec],
      adviceProducedThisTurn: true,
      alreadyAdaptedFrom: new Set([rec.text]),
    });
    expect(already.some((e) => e.type === 'recommendation_adapted')).toBe(false);
  });

  it('no advice this turn → no adaptation, even with the recommendation known', () => {
    const ev = deriveTurnEvents({
      userId: 'u',
      toolResults: [{ tool: 'save_recovery', ok: true }],
      knownInsightTexts: new Set([rec.text]),
      insightsAfter: [rec],
      adviceProducedThisTurn: false,
    });
    expect(ev.some((e) => e.type === 'recommendation_adapted')).toBe(false);
  });

  it('a pattern or fact never produces recommendation_adapted', () => {
    const ev = deriveTurnEvents({
      userId: 'u',
      toolResults: [{ tool: 'calculate_fueling_targets', ok: true }],
      knownInsightTexts: new Set([pat.text]),
      insightsAfter: [pat],
      adviceProducedThisTurn: true,
    });
    expect(ev.some((e) => e.type === 'recommendation_adapted')).toBe(false);
  });
});
