import { beforeEach, describe, expect, it } from 'vitest';
import { createSeededRepository, DEMO_USER_ID } from '../../src/data/index';
import { DeterministicLlmClient, handleMessage, type AgentDeps } from '../../src/agent/index';
import type { InMemoryRepository } from '../../src/data/in-memory-repository';
import type { FuelingCalculation } from '../../src/engine/index';

const CONV = 'conv_test';
const NOW = new Date(2026, 8, 3, 20, 0, 0); // Wed 3 Sep 2026, 8pm local

describe('four-message vertical slice (START_WITH_CLAUDE.md)', () => {
  let repo: InMemoryRepository;
  let deps: AgentDeps;

  beforeEach(async () => {
    repo = await createSeededRepository({ now: () => NOW });
    deps = { repo, llm: new DeterministicLlmClient() };
  });

  const say = (message: string) => handleMessage(deps, { userId: DEMO_USER_ID, conversationId: CONV, message, now: NOW });

  it('1. "Tomorrow I\'m doing an 18km run at 6am." → parse, save plan, classify, calculate, prep advice', async () => {
    const turn = await say("Tomorrow I'm doing an 18km run at 6am.");

    expect(turn.intent).toBe('plan_session');
    expect(turn.tool_calls.map((c) => c.tool)).toEqual(['save_planned_session', 'calculate_fueling_targets']);

    const plans = await repo.listPlannedSessions(DEMO_USER_ID);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ sport: 'running', distance_km: 18, intensity: 'easy' });
    expect(plans[0]!.start_at).toBe('2026-09-04T06:00:00');

    const calc = turn.tool_results[1]!.data as FuelingCalculation;
    expect(calc.session_classification.duration_class).toBe('LONG');
    expect(calc.session_classification.duration_estimated).toBe(true);
    expect(calc.priorities.preparation).toBe('HIGH');

    expect(turn.reply).toMatch(/18 km/);
    expect(turn.reply.toLowerCase()).toContain('planned');
    expect(turn.reply).toMatch(/750 ml bottle/);
    expect(turn.reply).toMatch(/starting ranges, not exact targets/);
  });

  it('2. "Actually I only ran 10km because my left hip hurt." → plan preserved, actual recorded separately with reason', async () => {
    await say("Tomorrow I'm doing an 18km run at 6am.");
    const turn = await say('Actually I only ran 10km because my left hip hurt.');

    expect(turn.intent).toBe('log_actual');

    const plans = await repo.listPlannedSessions(DEMO_USER_ID);
    const actuals = await repo.listActualSessions(DEMO_USER_ID);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.distance_km).toBe(18); // untouched
    expect(actuals).toHaveLength(1);
    expect(actuals[0]).toMatchObject({
      distance_km: 10,
      status: 'stopped_early',
      reason: 'left hip hurt',
      planned_session_id: plans[0]!.id,
    });

    // post-workout calc used the ACTUAL 10km session
    const calc = turn.tool_results[1]!.data as FuelingCalculation;
    expect(calc.session_classification.resolved_duration_minutes).toBe(60); // 10km @ 6min/km

    expect(turn.reply).toMatch(/Kept your planned 18 km/);
    expect(turn.reply).toMatch(/10 km \(stopped early\), reason: left hip hurt/);
    expect(turn.reply).toMatch(/make up the missed distance/i);
    expect(turn.reply).toMatch(/hip still bothering you/i);
    // must not diagnose
    expect(turn.reply.toLowerCase()).not.toMatch(/caused by|because you were low|you have a/);
  });

  it('3. "I had one SIS gel and my 750ml bottle." → known quantities recorded, no invented nutrition', async () => {
    await say("Tomorrow I'm doing an 18km run at 6am.");
    await say('Actually I only ran 10km because my left hip hurt.');
    const turn = await say('I had one SIS gel and my 750ml bottle.');

    expect(turn.intent).toBe('log_fuel');
    const logs = await repo.listFuelLogs(DEMO_USER_ID);
    expect(logs).toHaveLength(1);
    const items = logs[0]!.items;
    expect(items).toHaveLength(2);

    const gel = items.find((i) => i.product_id === 'sis-go-isotonic-gel')!;
    expect(gel.quantity).toBe(1);
    expect(gel.carbohydrate_g).toBeNull(); // not on file — not invented
    expect(gel.sodium_mg).toBeNull();

    const bottle = items.find((i) => i.product_id === 'bottle-750')!;
    expect(bottle.fluid_ml).toBe(750);

    const actuals = await repo.listActualSessions(DEMO_USER_ID);
    expect(logs[0]!.session_id).toBe(actuals[0]!.id);

    expect(turn.reply).toMatch(/750 ml bottle — 750 ml fluid \(known\)/);
    expect(turn.reply).toMatch(/SIS.*won't guess the numbers/i);
  });

  it('4. "My legs feel tired but okay." → minimal recovery record + appropriate next action', async () => {
    await say("Tomorrow I'm doing an 18km run at 6am.");
    await say('Actually I only ran 10km because my left hip hurt.');
    await say('I had one SIS gel and my 750ml bottle.');
    const turn = await say('My legs feel tired but okay.');

    expect(turn.intent).toBe('recovery_check_in');
    const recovery = await repo.listRecoveryLogs(DEMO_USER_ID);
    expect(recovery).toHaveLength(1);
    expect(recovery[0]).toMatchObject({ free_text: 'My legs feel tired but okay.', overall_severity: 'low' });
    expect(recovery[0]!.reported_symptoms).toContain('legs');

    // references the prior hip stop-early and gives a safety-aware next step
    expect(turn.reply).toMatch(/hip/i);
    expect(turn.reply).toMatch(/easy and short|easy swim or bike/i);
    expect(turn.reply).not.toMatch(/\d+ ?% (higher|lower)/); // no meaningless analytics
  });

  it('conversation is persisted (user + assistant messages)', async () => {
    await say("Tomorrow I'm doing an 18km run at 6am.");
    const msgs = await repo.listMessages(DEMO_USER_ID, CONV);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});

describe('safety layer', () => {
  it('escalates a red-flag symptom and skips the normal fueling flow', async () => {
    const repo = await createSeededRepository({ now: () => NOW });
    const deps: AgentDeps = { repo, llm: new DeterministicLlmClient() };
    const turn = await handleMessage(deps, {
      userId: DEMO_USER_ID,
      conversationId: CONV,
      message: 'I had chest pain and felt faint during the run.',
      now: NOW,
    });
    expect(turn.intent).toBe('safety_escalation');
    expect(turn.safety.escalate).toBe(true);
    expect(turn.tool_calls).toHaveLength(0);
    expect(turn.reply).toMatch(/medical professional/i);
  });

  it('does NOT escalate ordinary soreness', async () => {
    const repo = await createSeededRepository({ now: () => NOW });
    const deps: AgentDeps = { repo, llm: new DeterministicLlmClient() };
    const turn = await handleMessage(deps, {
      userId: DEMO_USER_ID,
      conversationId: CONV,
      message: 'My legs feel tired but okay.',
      now: NOW,
    });
    expect(turn.safety.escalate).toBe(false);
    expect(turn.intent).toBe('recovery_check_in');
  });
});
