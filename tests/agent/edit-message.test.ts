import { beforeEach, describe, expect, it } from 'vitest';
import { createSeededRepository, DEMO_USER_ID } from '../../src/data/index';
import { DeterministicLlmClient, handleMessage, type AgentDeps } from '../../src/agent/index';
import type { InMemoryRepository } from '../../src/data/in-memory-repository';

const NOW = new Date(2026, 8, 9, 9, 0, 0);

describe('edit-and-regenerate', () => {
  let repo: InMemoryRepository;
  let deps: AgentDeps;

  beforeEach(async () => {
    repo = await createSeededRepository({ now: () => NOW });
    deps = { repo, llm: new DeterministicLlmClient() };
  });

  const say = (message: string) =>
    handleMessage(deps, { userId: DEMO_USER_ID, conversationId: 'c', message, now: NOW });

  it('every turn returns the ids of the two messages it appended', async () => {
    const turn = await say('My legs feel tired but okay');
    expect(turn.user_message_id).toMatch(/^msg_/);
    expect(turn.assistant_message_id).toMatch(/^msg_/);
    const msgs = await repo.listMessages(DEMO_USER_ID, 'c');
    expect(msgs.map((m) => m.id)).toEqual([turn.user_message_id, turn.assistant_message_id]);
  });

  it('truncating from a user message then re-running replaces the transcript below it', async () => {
    const t1 = await say('I feel a bit sore');
    await say('legs mostly');

    // the recovery record turn 1 created is attributed to turn 1
    const recBefore = await repo.listRecoveryLogs(DEMO_USER_ID);
    expect(recBefore.length).toBeGreaterThan(0);
    expect(recBefore[0]!.origin_message_id).toBe(t1.user_message_id);

    // edit t1: reconcile its records, drop it + everything after, re-run
    const removedIds = await repo.listMessageIdsFrom(DEMO_USER_ID, 'c', t1.user_message_id);
    expect(removedIds).toHaveLength(4); // t1 user+assistant, t2 user+assistant
    const summary = await repo.deleteRecordsForMessages(DEMO_USER_ID, removedIds);
    expect(summary.recovery_logs).toBe(recBefore.length);
    const removed = await repo.deleteMessagesFrom(DEMO_USER_ID, 'c', t1.user_message_id);
    expect(removed).toBe(4);
    expect(await repo.listRecoveryLogs(DEMO_USER_ID)).toHaveLength(0);

    const edited = await say('Actually my legs feel great today');
    const msgs = await repo.listMessages(DEMO_USER_ID, 'c');
    expect(msgs.map((m) => m.content)).toEqual(['Actually my legs feel great today', edited.reply]);
    expect(msgs).toHaveLength(2);
    expect(edited.reply).not.toEqual(t1.reply);
  });
});
