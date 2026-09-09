import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { createSeededRepository, DEMO_USER_ID } from '../../src/data/index';
import {
  AnthropicLlmClient,
  handleMessage,
  toInterpretResult,
  type AgentDeps,
  type AnthropicLike,
} from '../../src/agent/index';

function msg(content: unknown[]): Anthropic.Message {
  return { role: 'assistant', type: 'message', content } as unknown as Anthropic.Message;
}

describe('toInterpretResult', () => {
  it('maps tool_use blocks to ordered tool calls and an intent', () => {
    const result = toInterpretResult(
      msg([
        { type: 'text', text: 'ok' },
        { type: 'tool_use', id: 't1', name: 'save_planned_session', input: { sport: 'running', start_at: 'x' } },
        { type: 'tool_use', id: 't2', name: 'calculate_fueling_targets', input: { planned_session_id: '$last', phase: 'planning' } },
      ]),
    );
    expect(result.intent).toBe('plan_session');
    expect(result.tool_calls.map((c) => c.tool)).toEqual(['save_planned_session', 'calculate_fueling_targets']);
    expect(result.tool_calls[0]!.args).toEqual({ sport: 'running', start_at: 'x' });
    expect(result.clarifying_question).toBeUndefined();
  });

  it('treats a text-only response as a clarifying question', () => {
    const result = toInterpretResult(msg([{ type: 'text', text: 'How long will the run take?' }]));
    expect(result.intent).toBe('clarify');
    expect(result.tool_calls).toHaveLength(0);
    expect(result.clarifying_question).toBe('How long will the run take?');
  });
});

describe('AnthropicLlmClient (fake transport, no network)', () => {
  it('runs a full plan turn: interpret -> tools -> compose', async () => {
    const create = vi
      .fn<AnthropicLike['messages']['create']>()
      // 1st call = interpret
      .mockResolvedValueOnce(
        msg([
          { type: 'tool_use', id: 'a', name: 'save_planned_session', input: { sport: 'running', start_at: '2026-09-04T06:00:00', distance_km: 18, intensity: 'easy' } },
          { type: 'tool_use', id: 'b', name: 'calculate_fueling_targets', input: { planned_session_id: '$last', phase: 'planning' } },
        ]),
      )
      // 2nd call = compose
      .mockResolvedValueOnce(msg([{ type: 'text', text: 'Saved your 18 km run for tomorrow. Prep your bottle tonight.' }]));

    const fake: AnthropicLike = { messages: { create } };
    const repo = await createSeededRepository();
    const deps: AgentDeps = { repo, llm: new AnthropicLlmClient({ client: fake }) };

    const turn = await handleMessage(deps, {
      userId: DEMO_USER_ID,
      conversationId: 'c1',
      message: "Tomorrow I'm doing an 18km run at 6am.",
      now: new Date(2026, 8, 3, 20, 0, 0),
    });

    expect(turn.intent).toBe('plan_session');
    expect(turn.reply).toMatch(/Saved your 18 km run/);

    const plans = await repo.listPlannedSessions(DEMO_USER_ID);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ distance_km: 18, sport: 'running' });

    // interpret call was given the tool schemas
    expect(create).toHaveBeenCalledTimes(2);
    const interpretBody = create.mock.calls[0]![0];
    expect(interpretBody.tools?.map((t) => ('name' in t ? t.name : undefined))).toContain(
      'calculate_fueling_targets',
    );
    expect(interpretBody.tool_choice).toEqual({ type: 'auto' });

    // compose call was given the tool results (the only number source)
    const composeBody = create.mock.calls[1]![0];
    const composeText = JSON.stringify(composeBody.messages);
    expect(composeText).toMatch(/TOOL RESULTS/);
    expect(composeText).toMatch(/methodology_version/);
  });

  it('puts the goal and recent history into both prompts', async () => {
    const create = vi
      .fn<AnthropicLike['messages']['create']>()
      .mockResolvedValueOnce(
        msg([
          {
            type: 'tool_use',
            id: 'a',
            name: 'save_planned_session',
            input: { sport: 'cycling', start_at: '2026-09-04T07:00:00', distance_km: 40, intensity: 'easy' },
          },
          { type: 'tool_use', id: 'b', name: 'calculate_fueling_targets', input: { planned_session_id: '$last', phase: 'planning' } },
        ]),
      )
      .mockResolvedValueOnce(msg([{ type: 'text', text: 'Logged.' }]));

    const fake: AnthropicLike = { messages: { create } };
    const repo = await createSeededRepository();
    // some history to reference
    await repo.saveActualSession({
      user_id: DEMO_USER_ID,
      sport: 'cycling',
      intensity: 'easy',
      start_at: '2026-08-30T07:00:00',
      distance_km: 38,
      status: 'completed',
    });
    await repo.saveRecoveryLog({ user_id: DEMO_USER_ID, free_text: 'legs felt great after the long ride' });
    await repo.saveFuelLog({
      user_id: DEMO_USER_ID,
      items: [{ description: 'SIS gel', quantity: 2, certainty: 'user_reported' }],
    });

    const deps: AgentDeps = { repo, llm: new AnthropicLlmClient({ client: fake }) };
    await handleMessage(deps, {
      userId: DEMO_USER_ID,
      conversationId: 'ch',
      message: "Tomorrow I'm doing a 40km ride",
      now: new Date(2026, 8, 3, 20, 0, 0),
    });

    const interpretText = JSON.stringify(create.mock.calls[0]![0].messages);
    const composeText = JSON.stringify(create.mock.calls[1]![0].messages);
    for (const text of [interpretText, composeText]) {
      expect(text).toMatch(/goal/);
      expect(text).toMatch(/Stay consistent across run, bike and swim/); // the goal text
      expect(text).toMatch(/recent_sessions/);
      expect(text).toMatch(/legs felt great after the long ride/); // recovery note
      expect(text).toMatch(/SIS gel/); // fuel log
    }
  });

  it('a text-only interpret response short-circuits to a clarifying question (no compose call)', async () => {
    const create = vi
      .fn<AnthropicLike['messages']['create']>()
      .mockResolvedValueOnce(msg([{ type: 'text', text: 'Which sport, and how far?' }]));
    const fake: AnthropicLike = { messages: { create } };
    const repo = await createSeededRepository();
    const deps: AgentDeps = { repo, llm: new AnthropicLlmClient({ client: fake }) };

    const turn = await handleMessage(deps, {
      userId: DEMO_USER_ID,
      conversationId: 'c2',
      message: 'training tomorrow',
    });

    expect(turn.clarifying_question).toBe('Which sport, and how far?');
    expect(turn.tool_results).toHaveLength(0);
    expect(create).toHaveBeenCalledTimes(1); // no compose
  });

  it('safety red flags never reach the model', async () => {
    const create = vi.fn<AnthropicLike['messages']['create']>();
    const fake: AnthropicLike = { messages: { create } };
    const repo = await createSeededRepository();
    const deps: AgentDeps = { repo, llm: new AnthropicLlmClient({ client: fake }) };

    const turn = await handleMessage(deps, {
      userId: DEMO_USER_ID,
      conversationId: 'c3',
      message: 'I had chest pain during the run and nearly passed out.',
    });

    expect(turn.intent).toBe('safety_escalation');
    expect(create).not.toHaveBeenCalled();
  });
});
