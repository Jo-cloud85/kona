import { beforeEach, describe, expect, it } from 'vitest';
import { createSeededRepository, DEMO_USER_ID } from '../../src/data/index';
import { DeterministicLlmClient, handleMessage, type AgentDeps } from '../../src/agent/index';
import type { InMemoryRepository } from '../../src/data/in-memory-repository';

const NOW = new Date(2026, 8, 9, 9, 0, 0);

describe('save_profile_fact — contextual profile facts', () => {
  let repo: InMemoryRepository;
  let deps: AgentDeps;

  beforeEach(async () => {
    repo = await createSeededRepository({ now: () => NOW });
    // start from a profile with no weight on file
    await repo.upsertProfile({ user_id: DEMO_USER_ID, username: 'sam', usual_sports: ['running'] });
    deps = { repo, llm: new DeterministicLlmClient() };
  });

  const say = (message: string) =>
    handleMessage(deps, { userId: DEMO_USER_ID, conversationId: 'c', message, now: NOW });

  it('captures body weight stated in passing', async () => {
    const turn = await say("I'm 68 kg");
    expect(turn.intent).toBe('note_profile_fact');
    expect((await repo.getProfile(DEMO_USER_ID))?.body_weight_kg).toBe(68);
    expect(turn.reply).toMatch(/68 kg/);
  });

  it('captures a usual bottle size', async () => {
    const turn = await say('My usual bottle is 750 ml');
    expect(turn.intent).toBe('note_profile_fact');
    expect((await repo.getProfile(DEMO_USER_ID))?.usual_bottle_ml).toBe(750);
  });

  it('does NOT treat an intake log as a profile fact', async () => {
    const turn = await say('I had a gel and my 750ml bottle during the run');
    expect(turn.intent).toBe('log_fuel');
  });

  it('asks for weight when a plan is saved and weight is unknown', async () => {
    const turn = await say("Tomorrow I'm doing a 12km run at 6am");
    expect(turn.reply).toMatch(/what do you weigh/i);
  });

  it('stops asking once weight is on file', async () => {
    await say("I'm 70 kg");
    const turn = await say("Tomorrow I'm doing a 12km run at 6am");
    expect(turn.reply).not.toMatch(/what do you weigh/i);
  });
});
