import { beforeEach, describe, expect, it } from 'vitest';
import { createSeededRepository, DEMO_USER_ID } from '../../src/data/index';
import { DeterministicLlmClient, deriveTurnEvents, handleMessage, type AgentDeps } from '../../src/agent/index';
import type { Insight } from '../../src/agent/index';
import type { InMemoryRepository } from '../../src/data/in-memory-repository';

const pattern: Insight = {
  kind: 'pattern',
  text: 'Your last 3 running sessions all went to plan.',
  certainty: 'moderate',
  evidence_count: 3,
  topic: 'training',
  evidence: [],
};
const staple: Insight = {
  kind: 'fact',
  text: 'You have logged sis gel 3 times.',
  certainty: 'moderate',
  evidence_count: 3,
  topic: 'fuelling',
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
  });

  it('emits insight_formed + recommendation_adapted for a NEW pattern or fuelling fact', () => {
    const events = deriveTurnEvents({
      userId: 'u',
      toolResults: [{ tool: 'save_recovery', ok: true }],
      knownInsightTexts: new Set(),
      insightsAfter: [pattern, staple],
    });
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'insight_formed')).toHaveLength(2);
    expect(types.filter((t) => t === 'recommendation_adapted')).toHaveLength(2);
    expect(events.find((e) => e.type === 'insight_formed')!.summary).toMatch(/^Kona spotted — /);
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
    // three completed rides already on record
    for (const d of ['2026-09-04', '2026-09-07', '2026-09-10']) {
      await repo.saveActualSession({
        user_id: DEMO_USER_ID,
        sport: 'cycling',
        intensity: 'easy',
        start_at: `${d}T07:00:00`,
        distance_km: 40,
        status: 'completed',
      });
    }
  });
  const say = (message: string) =>
    handleMessage(deps, { userId: DEMO_USER_ID, conversationId: 'c', message, now: NOW });

  it('records the loop: a pattern forms → advice adapts, and only once', async () => {
    // a turn that fires a tool triggers the insight-detection pass
    await say('My legs feel good after that ride.');

    const events = await repo.listActivityEvents(DEMO_USER_ID);
    const types = events.map((e) => e.type);
    expect(types).toContain('recovery_logged');
    expect(types).toContain('insight_formed');
    expect(types).toContain('recommendation_adapted');
    expect(events.find((e) => e.type === 'insight_formed')!.summary).toMatch(
      /^Kona spotted — Your last 3 cycling sessions all went to plan/,
    );

    const formedBefore = events.filter((e) => e.type === 'insight_formed').length;
    await say('My legs still feel fine today.');
    const formedAfter = (await repo.listActivityEvents(DEMO_USER_ID)).filter((e) => e.type === 'insight_formed').length;
    expect(formedAfter).toBe(formedBefore); // the same pattern is not recorded again
  });
});
