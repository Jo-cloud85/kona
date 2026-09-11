import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryRepository } from '../../src/data/index';
import { DeterministicLlmClient } from '../../src/agent/index';
import { editMessage, sendMessage } from '../../lib/kona-server';
import type { KonaContext } from '../../lib/server-context';

/**
 * M23.1 — structured records created by a chat turn are attributed to that turn
 * and reconciled when the turn is edited. Earlier turns' records are preserved.
 */

const USER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CONV = 'reconcile';

describe('edit reconciliation', () => {
  let repo: InMemoryRepository;
  let ctx: KonaContext;

  beforeEach(() => {
    repo = new InMemoryRepository();
    ctx = { repo, userId: USER, llm: new DeterministicLlmClient(), persistent: false };
  });

  const say = (message: string) => sendMessage(ctx, CONV, message);

  it('stamps every record a turn creates with that turn\'s user message id', async () => {
    const turn = await say("Tomorrow I'm doing an 18km run at 6am.");
    const planned = await repo.listPlannedSessions(USER);
    expect(planned).toHaveLength(1);
    expect(planned[0]!.origin_message_id).toBe(turn.turn.user_message_id);

    const events = await repo.listActivityEvents(USER);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.origin_message_id === turn.turn.user_message_id)).toBe(true);
  });

  it('editing a turn deletes its records, keeps earlier turns, and re-stamps the regenerated ones', async () => {
    const t1 = await say("Tomorrow I'm doing an 18km run at 6am."); // plan P  (turn 1)
    await say('Actually I only ran 10km because my left hip hurt.'); // actual A (turn 2)
    await say('I had one SIS gel and my 750ml bottle.'); // fuel F   (turn 2's sibling info -> turn 3)

    expect(await repo.listPlannedSessions(USER)).toHaveLength(1);
    expect(await repo.listActualSessions(USER)).toHaveLength(1);
    expect(await repo.listFuelLogs(USER)).toHaveLength(1);

    // find turn 2's user message to edit
    const msgs = await repo.listMessages(USER, CONV);
    const t2User = msgs.filter((m) => m.role === 'user')[1]!;

    const res = await editMessage(ctx, CONV, t2User.id, 'Actually I ran the full 18km and the hip was fine.');

    // turn 1's plan is preserved…
    const plannedAfter = await repo.listPlannedSessions(USER);
    expect(plannedAfter).toHaveLength(1);
    expect(plannedAfter[0]!.origin_message_id).toBe(t1.turn.user_message_id);

    // …turn 2 + 3 records were reconciled away…
    expect(res.reconciled).toBeDefined();
    expect(res.reconciled!.sessions).toBeGreaterThanOrEqual(1);
    expect(res.reconciled!.fuel_logs).toBeGreaterThanOrEqual(1);
    expect(await repo.listFuelLogs(USER)).toHaveLength(0);

    // …and the regenerated turn's new actual session carries the NEW origin.
    const actualAfter = await repo.listActualSessions(USER);
    expect(actualAfter).toHaveLength(1);
    expect(actualAfter[0]!.origin_message_id).toBe(res.turn.user_message_id);
    expect(actualAfter[0]!.origin_message_id).not.toBe(t2User.id);

    // transcript ends at the edited (regenerated) turn
    const finalMsgs = await repo.listMessages(USER, CONV);
    expect(finalMsgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(finalMsgs[2]!.content).toBe('Actually I ran the full 18km and the hip was fine.');
  });

  it('a memory the edited turn created is removed, then re-created on regeneration', async () => {
    const t = await say('My next race is the Boston Marathon on April 20.');
    let mems = await repo.listMemories(USER);
    expect(mems).toHaveLength(1);
    expect(mems[0]!.key).toBe('next_race');
    expect(mems[0]!.origin_message_id).toBe(t.turn.user_message_id);

    const msgs = await repo.listMessages(USER, CONV);
    const tUser = msgs.find((m) => m.role === 'user')!;
    const res = await editMessage(ctx, CONV, tUser.id, 'My next race is the Chicago Marathon.');

    expect(res.reconciled!.memories).toBe(1);
    mems = await repo.listMemories(USER);
    expect(mems).toHaveLength(1);
    expect(mems[0]!.value).toMatch(/Chicago/i);
    expect(mems[0]!.origin_message_id).toBe(res.turn.user_message_id);
  });

  it('editing to the same effect is idempotent on structured state', async () => {
    await say("Tomorrow I'm doing an 18km run at 6am.");
    const msgs = await repo.listMessages(USER, CONV);
    const u = msgs.find((m) => m.role === 'user')!;

    await editMessage(ctx, CONV, u.id, "Tomorrow I'm doing a 20km run at 6am.");
    const after1 = await repo.listPlannedSessions(USER);
    expect(after1).toHaveLength(1);

    const msgs2 = await repo.listMessages(USER, CONV);
    const u2 = msgs2.find((m) => m.role === 'user')!;
    await editMessage(ctx, CONV, u2.id, "Tomorrow I'm doing a 22km run at 6am.");
    const after2 = await repo.listPlannedSessions(USER);
    expect(after2).toHaveLength(1); // still exactly one — no accumulation
    expect(after2[0]!.distance_km).toBe(22);
  });
});
