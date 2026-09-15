import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { createSeededRepository, DEMO_USER_ID } from '../../src/data/index';
import { athleteNow } from '../../src/domain/time';
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

  it('intercepts ask_choice as a clarifying question with tappable options, not a tool call', () => {
    const result = toInterpretResult(
      msg([
        {
          type: 'tool_use',
          id: 't1',
          name: 'ask_choice',
          input: {
            question: 'Which sport?',
            options: [
              { label: 'Running', value: 'running' },
              { label: 'Cycling', value: 'cycling' },
              { label: 'Something else', value: '__type_own__' },
            ],
          },
        },
      ]),
    );
    expect(result.tool_calls).toHaveLength(0); // never reaches runTool()
    expect(result.clarifying_question).toBe('Which sport?');
    expect(result.clarifying_options).toEqual([
      { label: 'Running', value: 'running' },
      { label: 'Cycling', value: 'cycling' },
      { label: 'Something else', value: '__type_own__' },
    ]);
  });

  it('falls back to a plain clarifying question if ask_choice args are malformed', () => {
    const result = toInterpretResult(
      msg([{ type: 'tool_use', id: 't1', name: 'ask_choice', input: { question: 'Which sport?', options: 'not an array' } }]),
    );
    expect(result.tool_calls).toHaveLength(0);
    expect(result.clarifying_question).toBe('Which sport?');
    expect(result.clarifying_options).toBeUndefined();
  });

  it('ignores any other tool call alongside ask_choice — the question always wins', () => {
    const result = toInterpretResult(
      msg([
        { type: 'tool_use', id: 't1', name: 'save_planned_session', input: { sport: 'running' } },
        {
          type: 'tool_use',
          id: 't2',
          name: 'ask_choice',
          input: { question: 'Which time of day?', options: [{ label: 'Morning', value: 'morning' }] },
        },
      ]),
    );
    expect(result.tool_calls).toHaveLength(0);
    expect(result.clarifying_question).toBe('Which time of day?');
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

  it('gives compose the insight evidence + certainty needed to ground a "because" callback (M23.2)', async () => {
    const create = vi
      .fn<AnthropicLike['messages']['create']>()
      .mockResolvedValueOnce(
        msg([{ type: 'tool_use', id: 'a', name: 'save_recovery', input: { free_text: 'felt fine today' } }]),
      )
      .mockResolvedValueOnce(msg([{ type: 'text', text: 'Noted.' }]));

    const fake: AnthropicLike = { messages: { create } };
    const repo = await createSeededRepository();
    // two GI mentions -> a recurring-symptom FACT with quoted evidence
    await repo.saveRecoveryLog({ user_id: DEMO_USER_ID, free_text: 'stomach was off after that heavier breakfast' });
    await repo.saveRecoveryLog({ user_id: DEMO_USER_ID, free_text: 'GI trouble again this morning' });

    const deps: AgentDeps = { repo, llm: new AnthropicLlmClient({ client: fake }) };
    await handleMessage(deps, { userId: DEMO_USER_ID, conversationId: 'c4', message: 'Felt fine today' });

    const composeText = String(create.mock.calls[1]![0].messages[0]!.content);
    // the insight's own evidence line reaches the prompt — grounding, not just the headline text
    expect(composeText).toMatch(/heavier breakfast/);
    expect(composeText).toMatch(/"certainty": "high"/);
    expect(composeText).toMatch(/"basis": "reported"/);
  });

  it('ask_choice reaches the athlete as clarifying_options on the turn, no compose call', async () => {
    const create = vi.fn<AnthropicLike['messages']['create']>().mockResolvedValueOnce(
      msg([
        {
          type: 'tool_use',
          id: 't1',
          name: 'ask_choice',
          input: {
            question: 'Which sport?',
            options: [
              { label: 'Running', value: 'running' },
              { label: 'Cycling', value: 'cycling' },
            ],
          },
        },
      ]),
    );
    const fake: AnthropicLike = { messages: { create } };
    const repo = await createSeededRepository();
    const deps: AgentDeps = { repo, llm: new AnthropicLlmClient({ client: fake }) };

    const turn = await handleMessage(deps, {
      userId: DEMO_USER_ID,
      conversationId: 'c-choice',
      message: "Tomorrow I'm training in the morning",
    });

    expect(turn.reply).toBe('Which sport?');
    expect(turn.clarifying_options).toEqual([
      { label: 'Running', value: 'running' },
      { label: 'Cycling', value: 'cycling' },
    ]);
    expect(turn.tool_calls).toHaveLength(0);
    expect(create).toHaveBeenCalledTimes(1); // no compose — ask_choice short-circuits like any clarifying question
  });

  it('a multi-step ask_choice exchange carries earlier turns as real conversation history (2026-09-15 fix)', async () => {
    const create = vi
      .fn<AnthropicLike['messages']['create']>()
      // Turn 1: athlete gives a vague plan -> Kona asks for sport
      .mockResolvedValueOnce(
        msg([
          {
            type: 'tool_use',
            id: 't1',
            name: 'ask_choice',
            input: { question: 'Which sport?', options: [{ label: 'Running', value: 'running' }] },
          },
        ]),
      )
      // Turn 2: athlete taps "Running" -> Kona asks style, should already know it's tomorrow morning
      .mockResolvedValueOnce(
        msg([
          {
            type: 'tool_use',
            id: 't2',
            name: 'ask_choice',
            input: { question: 'What kind of run?', options: [{ label: 'Easy', value: 'easy run' }] },
          },
        ]),
      );
    const fake: AnthropicLike = { messages: { create } };
    const repo = await createSeededRepository();
    const deps: AgentDeps = { repo, llm: new AnthropicLlmClient({ client: fake }) };

    await handleMessage(deps, {
      userId: DEMO_USER_ID,
      conversationId: 'c-memory',
      message: "I'm training tomorrow morning.",
    });
    await handleMessage(deps, { userId: DEMO_USER_ID, conversationId: 'c-memory', message: 'running' });

    // The 2nd interpret() call must see turn 1's exchange as real messages —
    // not just the bare word "running" with no memory of "tomorrow morning".
    const secondCallMessages = create.mock.calls[1]![0].messages;
    expect(secondCallMessages.length).toBeGreaterThan(1);
    expect(secondCallMessages[0]).toMatchObject({ role: 'user', content: "I'm training tomorrow morning." });
    expect(secondCallMessages[1]).toMatchObject({ role: 'assistant', content: 'Which sport?' });
    expect(secondCallMessages[secondCallMessages.length - 1]).toMatchObject({
      role: 'user',
      content: expect.stringContaining('ATHLETE MESSAGE:\nrunning'),
    });
  });

  it('a fresh conversation sends no prior turns (empty recent_messages)', async () => {
    const create = vi.fn<AnthropicLike['messages']['create']>().mockResolvedValueOnce(msg([{ type: 'text', text: 'ok' }]));
    const fake: AnthropicLike = { messages: { create } };
    const repo = await createSeededRepository();
    const deps: AgentDeps = { repo, llm: new AnthropicLlmClient({ client: fake }) };

    await handleMessage(deps, { userId: DEMO_USER_ID, conversationId: 'c-fresh', message: 'hello' });

    expect(create.mock.calls[0]![0].messages).toHaveLength(1);
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

  it('now_iso in the interpret prompt is the athlete\'s local wall clock, not the server\'s UTC clock (real alpha bug, 2026-09-14)', async () => {
    const create = vi
      .fn<AnthropicLike['messages']['create']>()
      .mockResolvedValueOnce(msg([{ type: 'text', text: 'ok' }]));
    const fake: AnthropicLike = { messages: { create } };
    const repo = await createSeededRepository();
    const deps: AgentDeps = { repo, llm: new AnthropicLlmClient({ client: fake }) };

    // 2026-09-13T16:20:00Z is still the 13th in UTC, but already 2026-09-14
    // 00:20 for an Asia/Singapore athlete — the exact real-world instant the
    // bug (a "today" session saved under the wrong calendar day) was found at.
    const realInstant = new Date('2026-09-13T16:20:00.000Z');
    await handleMessage(deps, {
      userId: DEMO_USER_ID,
      conversationId: 'c-tz',
      message: 'What am I doing today?',
      now: athleteNow('Asia/Singapore', realInstant),
    });

    const interpretText = String(create.mock.calls[0]![0].messages[0]!.content);
    expect(interpretText).toContain('2026-09-14');
    expect(interpretText).not.toContain('2026-09-13');
  });
});
