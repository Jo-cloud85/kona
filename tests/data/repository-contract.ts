import { expect, it } from 'vitest';
import type { Repository } from '../../src/data/repository';

/**
 * The behaviour every {@link Repository} implementation must satisfy — run
 * against the in-memory repo here, and against a real Supabase project by
 * `supabase-repository.live.test.ts` when `KONA_TEST_SUPABASE_URL` is set.
 *
 * `userA` / `userB` are two distinct owner ids. The suite proves round-trip
 * persistence AND that nothing leaks between the two users.
 */
export function repositoryContract(
  makeRepo: () => Promise<Repository>,
  userA: string,
  userB: string,
): void {
  const base = { sport: 'running' as const, intensity: 'easy' as const };

  it('profile: upsert then read back, per user', async () => {
    const repo = await makeRepo();
    await repo.upsertProfile({ user_id: userA, usual_sports: ['running'], body_weight_kg: 61, onboarded_at: '2026-01-01T00:00:00Z' });
    await repo.upsertProfile({ user_id: userB, usual_sports: ['cycling'], body_weight_kg: 80 });

    expect((await repo.getProfile(userA))?.body_weight_kg).toBe(61);
    expect((await repo.getProfile(userB))?.body_weight_kg).toBe(80);
    expect((await repo.getProfile(userA))?.usual_sports).toEqual(['running']);

    // update is an upsert, not a duplicate
    await repo.upsertProfile({ user_id: userA, usual_sports: ['running', 'swimming'], body_weight_kg: 62 });
    expect((await repo.getProfile(userA))?.body_weight_kg).toBe(62);
    expect((await repo.getProfile(userA))?.usual_sports).toEqual(['running', 'swimming']);
  });

  it('planned + actual sessions round-trip and stay per user', async () => {
    const repo = await makeRepo();
    const planned = await repo.savePlannedSession({ ...base, user_id: userA, start_at: '2026-02-01T06:00:00', distance_km: 18 });
    expect(planned.id).toBeTruthy();
    expect((await repo.getPlannedSession(planned.id))?.distance_km).toBe(18);

    const actual = await repo.saveActualSession({
      ...base,
      user_id: userA,
      start_at: '2026-02-01T06:00:00',
      distance_km: 12,
      status: 'stopped_early',
      reason: 'left hip',
      planned_session_id: planned.id,
    });
    // plan untouched, actual separate
    expect((await repo.getPlannedSession(planned.id))?.distance_km).toBe(18);
    expect((await repo.getActualSession(actual.id))?.status).toBe('stopped_early');
    expect((await repo.getActualSession(actual.id))?.planned_session_id).toBe(planned.id);

    await repo.saveActualSession({ ...base, user_id: userB, start_at: '2026-02-02T06:00:00', status: 'completed' });
    expect(await repo.listActualSessions(userA)).toHaveLength(1);
    expect(await repo.listActualSessions(userB)).toHaveLength(1);
  });

  it('updatePlannedSession patches only the given fields', async () => {
    const repo = await makeRepo();
    const p = await repo.savePlannedSession({ ...base, user_id: userA, start_at: '2026-03-01T06:00:00', needs_detail: ['intensity'] });
    const updated = await repo.updatePlannedSession(p.id, { intensity: 'hard', duration_minutes: 60 });
    expect(updated?.intensity).toBe('hard');
    expect(updated?.duration_minutes).toBe(60);
    expect(updated?.start_at).toBe('2026-03-01T06:00:00');
  });

  it('weekly plan replaces the plan for the same (user, week_start)', async () => {
    const repo = await makeRepo();
    const w1 = await repo.saveWeeklyPlan({ user_id: userA, week_start: '2026-03-02', rest_days: ['2026-03-02'] });
    await repo.savePlannedSession({ ...base, user_id: userA, start_at: '2026-03-03T06:00:00', weekly_plan_id: w1.id });
    const w2 = await repo.saveWeeklyPlan({ user_id: userA, week_start: '2026-03-02', rest_days: [] });
    expect(w2.id).not.toBe(w1.id);
    expect(await repo.listWeeklyPlans(userA)).toHaveLength(1);
    expect((await repo.getWeeklyPlan(userA, '2026-03-02'))?.id).toBe(w2.id);
    // userB has none
    expect(await repo.listWeeklyPlans(userB)).toHaveLength(0);
  });

  it('fuel + recovery logs round-trip, scoped', async () => {
    const repo = await makeRepo();
    await repo.saveFuelLog({ user_id: userA, items: [{ description: 'gel', certainty: 'user_reported' }] });
    await repo.saveRecoveryLog({ user_id: userA, free_text: 'legs heavy', overall_severity: 'low' });
    await repo.saveRecoveryLog({ user_id: userB, free_text: 'not mine' });

    expect(await repo.listFuelLogs(userA)).toHaveLength(1);
    expect((await repo.listRecoveryLogs(userA))[0]?.free_text).toBe('legs heavy');
    expect(await repo.listRecoveryLogs(userB)).toHaveLength(1);
    expect(await repo.listFuelLogs(userB)).toHaveLength(0);
  });

  it('memory: propose is an upsert on (user, key) and is per user', async () => {
    const repo = await makeRepo();
    const cand = (user_id: string, value: string) => ({
      user_id,
      key: 'usual_long_ride_fuel',
      value,
      certainty: 'user_reported' as const,
      source: 'conversation' as const,
      proposed_at: '2026-01-01T00:00:00Z',
    });
    await repo.proposeMemory(cand(userA, 'oats + 2 gels'));
    await repo.proposeMemory(cand(userA, 'oats + 3 gels')); // same key → replace
    await repo.proposeMemory(cand(userB, 'toast'));

    const a = await repo.listMemories(userA);
    expect(a).toHaveLength(1);
    expect(a[0]?.value).toBe('oats + 3 gels');
    expect((await repo.listMemories(userB))[0]?.value).toBe('toast');
  });

  it('messages: appended, listed per (user, conversation), and edit-truncation works', async () => {
    const repo = await makeRepo();
    const m1 = await repo.appendMessage({ user_id: userA, conversation_id: 'c1', role: 'user', content: 'first' });
    await repo.appendMessage({ user_id: userA, conversation_id: 'c1', role: 'assistant', content: 'reply 1' });
    const m3 = await repo.appendMessage({ user_id: userA, conversation_id: 'c1', role: 'user', content: 'second' });
    await repo.appendMessage({ user_id: userA, conversation_id: 'c1', role: 'assistant', content: 'reply 2' });
    // a different user re-using the SAME conversation id must stay separate
    await repo.appendMessage({ user_id: userB, conversation_id: 'c1', role: 'user', content: 'B private' });

    expect((await repo.listMessages(userA, 'c1')).map((m) => m.content)).toEqual(['first', 'reply 1', 'second', 'reply 2']);
    expect((await repo.listMessages(userB, 'c1')).map((m) => m.content)).toEqual(['B private']);

    const removed = await repo.deleteMessagesFrom(userA, 'c1', m3.id);
    expect(removed).toBe(2);
    expect((await repo.listMessages(userA, 'c1')).map((m) => m.content)).toEqual(['first', 'reply 1']);
    // B untouched
    expect((await repo.listMessages(userB, 'c1')).map((m) => m.content)).toEqual(['B private']);

    // deleting from another user's message id is a no-op for A
    expect(await repo.deleteMessagesFrom(userB, 'c1', m1.id)).toBe(0);
  });

  it('conversation summaries are derived, newest-activity first, per user', async () => {
    const repo = await makeRepo();
    await repo.appendMessage({ user_id: userA, conversation_id: 'c-a', role: 'user', content: 'Tomorrow I run 10km' });
    await repo.appendMessage({ user_id: userA, conversation_id: 'c-a', role: 'assistant', content: 'Saved.' });
    await repo.appendMessage({ user_id: userA, conversation_id: 'c-b', role: 'user', content: 'My next race is Berlin' });
    await repo.appendMessage({ user_id: userB, conversation_id: 'c-a', role: 'user', content: 'different owner' });

    const rows = await repo.listConversations(userA);
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(['c-a', 'c-b']));
    expect(rows.find((r) => r.id === 'c-a')).toMatchObject({ title: 'Tomorrow I run 10km', message_count: 2 });
    expect(rows.find((r) => r.id === 'c-b')).toMatchObject({ title: 'My next race is Berlin', message_count: 1 });
    // userB re-used conversation id 'c-a' but sees only their own row
    expect((await repo.listConversations(userB)).map((r) => r.id)).toEqual(['c-a']);
    expect((await repo.listConversations(userB))[0]).toMatchObject({ title: 'different owner', message_count: 1 });
  });

  it('activity events: append-only stream, scoped, limitable, meta preserved', async () => {
    const repo = await makeRepo();
    await repo.appendActivityEvent({ user_id: userA, type: 'session_logged', summary: 'You logged a ride' });
    await repo.appendActivityEvent({ user_id: userA, type: 'insight_formed', summary: 'Kona spotted — a pattern' });
    await repo.appendActivityEvent({
      user_id: userA,
      type: 'recommendation_adapted',
      summary: "Kona applied what it's learned",
      meta: { from: 'a pattern' },
    });
    await repo.appendActivityEvent({ user_id: userB, type: 'checkin_done', summary: 'not mine' });

    const a = await repo.listActivityEvents(userA);
    expect(a).toHaveLength(3);
    expect(new Set(a.map((e) => e.type))).toEqual(new Set(['session_logged', 'insight_formed', 'recommendation_adapted']));
    expect(a.find((e) => e.type === 'recommendation_adapted')?.meta).toMatchObject({ from: 'a pattern' });
    expect(await repo.listActivityEvents(userA, 1)).toHaveLength(1);
    expect(await repo.listActivityEvents(userB)).toHaveLength(1);
    // the Repository interface exposes no update/delete for activity events
    expect('deleteActivityEvent' in repo).toBe(false);
    expect('updateActivityEvent' in repo).toBe(false);
  });

  it('getRelevantHistory returns recent rows newest-first, sport-filtered, per user', async () => {
    const repo = await makeRepo();
    for (const d of ['2026-04-01', '2026-04-03', '2026-04-05']) {
      await repo.saveActualSession({ ...base, user_id: userA, start_at: `${d}T06:00:00`, sport: 'running', status: 'completed' });
    }
    await repo.saveActualSession({ ...base, user_id: userA, start_at: '2026-04-06T06:00:00', sport: 'cycling', status: 'completed' });
    await repo.saveActualSession({ ...base, user_id: userB, start_at: '2026-04-07T06:00:00', status: 'completed' });

    const hist = await repo.getRelevantHistory(userA, { sport: 'running', limit: 2 });
    expect(hist.recent_actual_sessions).toHaveLength(2);
    expect(hist.recent_actual_sessions.every((s) => s.sport === 'running')).toBe(true);
    expect(hist.recent_actual_sessions[0]!.start_at > hist.recent_actual_sessions[1]!.start_at).toBe(true);

    const bHist = await repo.getRelevantHistory(userB, {});
    expect(bHist.recent_actual_sessions).toHaveLength(1);
  });

  // --- M23.1: turn attribution + edit reconciliation --------------------

  it('origin_message_id round-trips on every turn-created record', async () => {
    const repo = await makeRepo();
    const m = await repo.appendMessage({ user_id: userA, conversation_id: 'edit1', role: 'user', content: 'log stuff' });

    const p = await repo.savePlannedSession({ ...base, user_id: userA, start_at: '2026-06-01T06:00:00', origin_message_id: m.id });
    const s = await repo.saveActualSession({ ...base, user_id: userA, start_at: '2026-06-01T06:00:00', status: 'completed', origin_message_id: m.id });
    const w = await repo.saveWeeklyPlan({ user_id: userA, week_start: '2026-06-01', origin_message_id: m.id });
    const f = await repo.saveFuelLog({ user_id: userA, items: [{ description: 'gel', certainty: 'user_reported' }], origin_message_id: m.id });
    const r = await repo.saveRecoveryLog({ user_id: userA, free_text: 'ok', origin_message_id: m.id });
    await repo.proposeMemory({ user_id: userA, key: 'k', value: 'v', certainty: 'user_reported', source: 'conversation', proposed_at: '2026-01-01T00:00:00Z', origin_message_id: m.id });
    await repo.appendActivityEvent({ user_id: userA, type: 'session_logged', summary: 'logged', origin_message_id: m.id });

    expect((await repo.getPlannedSession(p.id))?.origin_message_id).toBe(m.id);
    expect((await repo.getActualSession(s.id))?.origin_message_id).toBe(m.id);
    expect((await repo.listWeeklyPlans(userA)).find((x) => x.id === w.id)?.origin_message_id).toBe(m.id);
    expect((await repo.listFuelLogs(userA)).find((x) => x.id === f.id)?.origin_message_id).toBe(m.id);
    expect((await repo.listRecoveryLogs(userA)).find((x) => x.id === r.id)?.origin_message_id).toBe(m.id);
    expect((await repo.listMemories(userA))[0]?.origin_message_id).toBe(m.id);
    expect((await repo.listActivityEvents(userA))[0]?.origin_message_id).toBe(m.id);
  });

  it('listMessageIdsFrom returns a message + all later, scoped to the user', async () => {
    const repo = await makeRepo();
    const m1 = await repo.appendMessage({ user_id: userA, conversation_id: 'e', role: 'user', content: '1' });
    const m2 = await repo.appendMessage({ user_id: userA, conversation_id: 'e', role: 'assistant', content: '2' });
    const m3 = await repo.appendMessage({ user_id: userA, conversation_id: 'e', role: 'user', content: '3' });
    await repo.appendMessage({ user_id: userB, conversation_id: 'e', role: 'user', content: 'B' });

    expect(await repo.listMessageIdsFrom(userA, 'e', m2.id)).toEqual([m2.id, m3.id]);
    expect(await repo.listMessageIdsFrom(userA, 'e', m1.id)).toEqual([m1.id, m2.id, m3.id]);
    expect(await repo.listMessageIdsFrom(userA, 'e', 'nope')).toEqual([]);
    // a different user's message id is invisible here
    expect(await repo.listMessageIdsFrom(userB, 'e', m1.id)).toEqual([]);
  });

  it('deleteRecordsForMessages removes turn records and repairs a surviving link', async () => {
    const repo = await makeRepo();
    const mSession = await repo.appendMessage({ user_id: userA, conversation_id: 'e', role: 'user', content: 'ran 18k' });
    const mFuel = await repo.appendMessage({ user_id: userA, conversation_id: 'e', role: 'user', content: 'had 3 gels' });

    const s = await repo.saveActualSession({ ...base, user_id: userA, start_at: '2026-07-01T06:00:00', status: 'completed', origin_message_id: mSession.id });
    const f = await repo.saveFuelLog({
      user_id: userA,
      session_id: s.id,
      items: [{ description: 'gel', certainty: 'user_reported' }],
      origin_message_id: mFuel.id,
    });

    // edit the SESSION turn: only its message is reconciled
    const summary = await repo.deleteRecordsForMessages(userA, [mSession.id]);
    expect(summary.sessions).toBe(1);
    expect(summary.fuel_logs).toBe(0); // the fuel log is from a different turn — kept
    expect(summary.nulled_links).toBe(1); // …but its link to the deleted session is cut

    expect(await repo.getActualSession(s.id)).toBeUndefined();
    const keptFuel = (await repo.listFuelLogs(userA)).find((x) => x.id === f.id);
    expect(keptFuel).toBeDefined();
    expect(keptFuel?.session_id).toBeUndefined();

    // idempotent
    const again = await repo.deleteRecordsForMessages(userA, [mSession.id]);
    expect(again).toMatchObject({ sessions: 0, fuel_logs: 0, nulled_links: 0 });
  });

  it('deleting a weekly-plan turn takes its planned sessions with it', async () => {
    const repo = await makeRepo();
    const m = await repo.appendMessage({ user_id: userA, conversation_id: 'e', role: 'user', content: 'my week' });
    const w = await repo.saveWeeklyPlan({ user_id: userA, week_start: '2026-08-03', origin_message_id: m.id });
    await repo.savePlannedSession({ ...base, user_id: userA, start_at: '2026-08-04T06:00:00', weekly_plan_id: w.id, origin_message_id: m.id });
    await repo.savePlannedSession({ ...base, user_id: userA, start_at: '2026-08-05T06:00:00', weekly_plan_id: w.id, origin_message_id: m.id });

    const summary = await repo.deleteRecordsForMessages(userA, [m.id]);
    expect(summary.weekly_plans).toBe(1);
    expect(summary.planned_sessions).toBe(2);
    expect(await repo.listWeeklyPlans(userA)).toHaveLength(0);
    expect(await repo.listPlannedSessions(userA)).toHaveLength(0);
  });

  it('deleteRecordsForMessages never touches another user or unrelated turns', async () => {
    const repo = await makeRepo();
    const mA = await repo.appendMessage({ user_id: userA, conversation_id: 'e', role: 'user', content: 'A turn 1' });
    const mA2 = await repo.appendMessage({ user_id: userA, conversation_id: 'e', role: 'user', content: 'A turn 2' });
    const mB = await repo.appendMessage({ user_id: userB, conversation_id: 'e', role: 'user', content: 'B turn' });

    await repo.saveActualSession({ ...base, user_id: userA, start_at: '2026-09-01T06:00:00', status: 'completed', origin_message_id: mA.id });
    await repo.saveActualSession({ ...base, user_id: userA, start_at: '2026-09-02T06:00:00', status: 'completed', origin_message_id: mA2.id });
    await repo.saveActualSession({ ...base, user_id: userB, start_at: '2026-09-03T06:00:00', status: 'completed', origin_message_id: mB.id });

    // reconcile only A's first turn
    await repo.deleteRecordsForMessages(userA, [mA.id]);
    expect(await repo.listActualSessions(userA)).toHaveLength(1); // A's second turn kept
    expect(await repo.listActualSessions(userB)).toHaveLength(1); // B untouched
    // passing B's message id under A's identity is a no-op
    expect((await repo.deleteRecordsForMessages(userA, [mB.id])).sessions).toBe(0);
    expect(await repo.listActualSessions(userB)).toHaveLength(1);
  });
}
