import { beforeEach, describe, expect, it } from 'vitest';
import { createSeededRepository, DEMO_USER_ID } from '../../src/data/index';
import { DeterministicLlmClient, deriveTurnEvents, handleMessage, type AgentDeps } from '../../src/agent/index';
import type { Insight } from '../../src/agent/index';
import type { InMemoryRepository } from '../../src/data/in-memory-repository';

const pattern: Insight = {
  kind: 'pattern',
  basis: 'outcome',
  text: 'Your cycling sessions have been going well — completed as planned, and you have felt good afterwards (3 of 3).',
  certainty: 'moderate',
  evidence_count: 3,
  topic: 'training',
  evidence: [],
};
const staple: Insight = {
  kind: 'fact',
  basis: 'repeated',
  text: 'You have logged sis gel 3 times.',
  certainty: 'moderate',
  evidence_count: 3,
  topic: 'fuelling',
  evidence: [],
};
const recommendation: Insight = {
  kind: 'recommendation',
  basis: 'outcome',
  text: "What you're doing for cycling looks like it's working — worth keeping it steady rather than changing several things at once.",
  certainty: 'moderate',
  evidence_count: 3,
  topic: 'training',
  evidence: [],
};

describe('deriveTurnEvents', () => {
  it('turns tool results into action events', () => {
    const events = deriveTurnEvents({
      userId: 'u',
      toolResults: [
        { tool: 'save_actual_session', ok: true, data: { sport: 'cycling', distance_km: 60, status: 'completed' } },
        { tool: 'log_fuel_intake', ok: true, data: { items: [{ description: 'porridge' }, { description: '2 SIS gels' }] } },
      ],
      knownInsightTexts: new Set(),
      insightsAfter: [],
    });
    expect(events.map((e) => e.type)).toEqual(['session_logged', 'fuel_logged']);
    expect(events[0]!.summary).toMatch(/logged 60 km cycling/i);
    expect(events[1]!.summary).toMatch(/porridge, 2 SIS gels/);
    // no originMessageId given -> events carry none
    expect(events.every((e) => e.origin_message_id === undefined)).toBe(true);
  });

  it('stamps events with originMessageId when the turn provides one (M23.1)', () => {
    const events = deriveTurnEvents({
      userId: 'u',
      toolResults: [{ tool: 'save_actual_session', ok: true, data: { sport: 'running', status: 'completed' } }],
      knownInsightTexts: new Set(),
      insightsAfter: [],
      originMessageId: 'msg_turn_42',
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.origin_message_id).toBe('msg_turn_42');
  });

  it('spots a NEW pattern/fact but does NOT claim any recommendation was adapted', () => {
    const events = deriveTurnEvents({
      userId: 'u',
      toolResults: [{ tool: 'save_recovery', ok: true }],
      knownInsightTexts: new Set(),
      insightsAfter: [pattern, staple],
      adviceProducedThisTurn: true, // even so — nothing here is a recommendation
    });
    expect(events.map((e) => e.type)).toEqual(['recovery_logged', 'insight_formed', 'insight_formed']);
    expect(events.every((e) => e.type !== 'recommendation_adapted')).toBe(true);
    expect(events.find((e) => e.type === 'insight_formed')!.summary).toMatch(/^Kona spotted — /);
  });

  it('recommendation_adapted fires only on a LATER turn whose advice used a known recommendation, once', () => {
    // turn A: the outcome-based recommendation is brand new → recorded as "Kona's take", not adapted
    const a = deriveTurnEvents({
      userId: 'u',
      toolResults: [{ tool: 'calculate_fueling_targets', ok: true }],
      knownInsightTexts: new Set(),
      insightsAfter: [recommendation],
      adviceProducedThisTurn: true,
    });
    expect(a.map((e) => e.type)).toEqual(['insight_formed']);
    expect(a[0]!.summary).toMatch(/^Kona's take — /);

    // turn B: recommendation is now known AND this turn produced advice → adapted, once
    const known = new Set([recommendation.text]);
    const b = deriveTurnEvents({
      userId: 'u',
      toolResults: [{ tool: 'calculate_fueling_targets', ok: true }],
      knownInsightTexts: known,
      insightsAfter: [recommendation],
      adviceProducedThisTurn: true,
    });
    expect(b.map((e) => e.type)).toEqual(['recommendation_adapted']);
    expect(b[0]!.summary).toMatch(/applied what it's learned to today's training advice/i);

    // turn C: already reported as adapted → silent
    const c = deriveTurnEvents({
      userId: 'u',
      toolResults: [{ tool: 'calculate_fueling_targets', ok: true }],
      knownInsightTexts: known,
      insightsAfter: [recommendation],
      adviceProducedThisTurn: true,
      alreadyAdaptedFrom: new Set([recommendation.text]),
    });
    expect(c.some((e) => e.type === 'recommendation_adapted')).toBe(false);

    // turn D: recommendation known but NO advice produced this turn → nothing to adapt
    const d = deriveTurnEvents({
      userId: 'u',
      toolResults: [{ tool: 'save_recovery', ok: true }],
      knownInsightTexts: known,
      insightsAfter: [recommendation],
      adviceProducedThisTurn: false,
    });
    expect(d.some((e) => e.type === 'recommendation_adapted')).toBe(false);
  });

  it('does not re-emit an insight Kona already recorded', () => {
    const events = deriveTurnEvents({
      userId: 'u',
      toolResults: [{ tool: 'save_recovery', ok: true }],
      knownInsightTexts: new Set([pattern.text]),
      insightsAfter: [pattern],
    });
    expect(events.some((e) => e.type === 'insight_formed')).toBe(false);
  });
});

describe('activity loop through handleMessage', () => {
  let repo: InMemoryRepository;
  let deps: AgentDeps;
  const NOW = new Date(2026, 8, 12, 9, 0, 0);

  beforeEach(async () => {
    repo = await createSeededRepository({ now: () => NOW });
    deps = { repo, llm: new DeterministicLlmClient() };
    // three completed rides, each with a same-day "felt good" note — a genuine
    // outcome-backed run, not just three repetitions.
    for (const d of ['2026-09-04', '2026-09-07', '2026-09-10']) {
      const s = await repo.saveActualSession({
        user_id: DEMO_USER_ID,
        sport: 'cycling',
        intensity: 'easy',
        start_at: `${d}T07:00:00`,
        distance_km: 40,
        status: 'completed',
      });
      await repo.saveRecoveryLog({
        user_id: DEMO_USER_ID,
        session_id: s.id,
        free_text: 'legs felt great, no issues',
        overall_severity: 'none',
      });
    }
  });
  const say = (message: string) =>
    handleMessage(deps, { userId: DEMO_USER_ID, conversationId: 'c', message, now: NOW });

  it('records the loop: spotted → later advice actually applies it, and only once', async () => {
    // turn 1 — a recovery note. The outcome pattern + Kona's take get recorded,
    // but nothing is "adapted" yet (no advice this turn).
    await say('My legs feel good after that ride.');
    let events = await repo.listActivityEvents(DEMO_USER_ID);
    expect(events.map((e) => e.type)).toContain('insight_formed');
    expect(events.some((e) => e.type === 'recommendation_adapted')).toBe(false);
    expect(events.find((e) => /^Kona's take — /.test(e.summary))?.summary).toMatch(/looks like it's working/i);

    // turn 2 — planning a ride produces a fuelling calc; the standing
    // recommendation is now on file, so this is where advice actually adapts.
    await say("Tomorrow I'm doing a 35km ride at 7am.");
    events = await repo.listActivityEvents(DEMO_USER_ID);
    const adapted = events.filter((e) => e.type === 'recommendation_adapted');
    expect(adapted).toHaveLength(1);
    expect(adapted[0]!.summary).toMatch(/applied what it's learned/i);

    // turn 3 — another planning turn does not re-fire it.
    await say("Actually make tomorrow a 40km ride at 7am.");
    const adaptedAfter = (await repo.listActivityEvents(DEMO_USER_ID)).filter((e) => e.type === 'recommendation_adapted');
    expect(adaptedAfter).toHaveLength(1);
  });
});
