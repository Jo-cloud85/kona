import { describe, expect, it } from 'vitest';
import { createSeededRepository, DEMO_USER_ID } from '../../src/data/index';
import { resolveProductByPhrase, getProduct } from '../../src/data/products';

describe('InMemoryRepository', () => {
  it('seeds the demo profile with no measured sweat data', async () => {
    const repo = await createSeededRepository();
    const profile = await repo.getProfile(DEMO_USER_ID);
    expect(profile?.body_weight_kg).toBe(64);
    expect(profile?.usual_bottle_ml).toBe(750);
    expect(profile?.known_sweat_data).toBeUndefined();
  });

  it('keeps planned and actual sessions as separate linked records', async () => {
    const repo = await createSeededRepository();
    const plan = await repo.savePlannedSession({
      user_id: DEMO_USER_ID,
      sport: 'running',
      start_at: '2026-09-04T06:00:00',
      distance_km: 18,
      intensity: 'easy',
    });
    const actual = await repo.saveActualSession({
      user_id: DEMO_USER_ID,
      sport: 'running',
      start_at: '2026-09-04T06:00:00',
      distance_km: 10,
      intensity: 'easy',
      planned_session_id: plan.id,
      status: 'stopped_early',
      reason: 'left hip discomfort',
    });

    // The plan is untouched.
    expect((await repo.getPlannedSession(plan.id))?.distance_km).toBe(18);
    // The actual is its own record with the reason stored separately.
    expect(actual.distance_km).toBe(10);
    expect(actual.reason).toBe('left hip discomfort');
    expect(actual.planned_session_id).toBe(plan.id);
  });

  it('finds the plan for a given date to link an actual session', async () => {
    const repo = await createSeededRepository();
    await repo.savePlannedSession({
      user_id: DEMO_USER_ID,
      sport: 'running',
      start_at: '2026-09-04T06:00:00',
      distance_km: 18,
      intensity: 'easy',
    });
    const found = await repo.findPlannedSessionForDate(DEMO_USER_ID, '2026-09-04', 'running');
    expect(found?.distance_km).toBe(18);
  });

  it('upserts memory candidates by key', async () => {
    const repo = await createSeededRepository();
    await repo.proposeMemory({
      user_id: DEMO_USER_ID,
      key: 'usual_bottle_ml',
      value: '750',
      certainty: 'user_reported',
      source: 'conversation',
      proposed_at: '2026-09-03T00:00:00Z',
    });
    await repo.proposeMemory({
      user_id: DEMO_USER_ID,
      key: 'usual_bottle_ml',
      value: '800',
      certainty: 'user_reported',
      source: 'conversation',
      proposed_at: '2026-09-03T01:00:00Z',
    });
    const memories = await repo.listMemories(DEMO_USER_ID);
    expect(memories).toHaveLength(1);
    expect(memories[0]?.value).toBe('800');
  });

  it('summarises conversations, newest activity first, titled from the first user message', async () => {
    let t = Date.UTC(2026, 8, 6, 12, 0, 0);
    const repo = await createSeededRepository({ now: () => new Date((t += 1000)) });
    await repo.appendMessage({ conversation_id: 'c-a', role: 'user', content: 'Tomorrow I run 10km' });
    await repo.appendMessage({ conversation_id: 'c-a', role: 'assistant', content: 'Saved.' });
    await repo.appendMessage({ conversation_id: 'c-b', role: 'user', content: 'My next race is Berlin' });

    const rows = await repo.listConversations('user_demo');
    expect(rows.map((r) => r.id)).toEqual(['c-b', 'c-a']); // c-b touched last
    expect(rows.find((r) => r.id === 'c-a')).toMatchObject({ title: 'Tomorrow I run 10km', message_count: 2 });
  });

  it('round-trips an onboarding profile', async () => {
    const repo = await createSeededRepository();
    const saved = await repo.upsertProfile({
      user_id: DEMO_USER_ID,
      username: 'joan',
      goal: { text: 'First half-marathon in March' },
      usual_sports: ['running', 'cycling'],
      recent_injuries_note: 'calf cramp on a hot day',
      onboarded_at: '2026-09-06T00:00:00Z',
    });
    expect(saved.username).toBe('joan');
    const back = await repo.getProfile(DEMO_USER_ID);
    expect(back).toMatchObject({
      usual_sports: ['running', 'cycling'],
      goal: { text: 'First half-marathon in March' },
      onboarded_at: '2026-09-06T00:00:00Z',
    });
    // weight is optional now — not part of onboarding
    expect(back?.body_weight_kg).toBeUndefined();
  });

  it('stores a weekly plan and links its sessions; re-saving the same week replaces it', async () => {
    const repo = await createSeededRepository();
    const week = await repo.saveWeeklyPlan({
      user_id: DEMO_USER_ID,
      week_start: '2026-09-07',
      source_text: 'Mon gym, Sun long run',
      rest_days: ['2026-09-10'],
    });
    await repo.savePlannedSession({
      user_id: DEMO_USER_ID,
      sport: 'gym',
      start_at: '2026-09-07T07:00:00',
      intensity: 'easy',
      weekly_plan_id: week.id,
    });

    expect(await repo.getWeeklyPlan(DEMO_USER_ID, '2026-09-07')).toMatchObject({
      rest_days: ['2026-09-10'],
    });
    expect(await repo.listPlannedSessionsForWeeklyPlan(week.id)).toHaveLength(1);

    const replaced = await repo.saveWeeklyPlan({
      user_id: DEMO_USER_ID,
      week_start: '2026-09-07',
      rest_days: [],
    });
    expect(replaced.id).not.toBe(week.id);
    expect(await repo.listWeeklyPlans(DEMO_USER_ID)).toHaveLength(1);
  });
});

describe('product catalog', () => {
  it('resolves branded phrases, preferring the most specific alias', () => {
    expect(resolveProductByPhrase('I had one SIS gel')?.id).toBe('sis-go-isotonic-gel');
    expect(resolveProductByPhrase('my 750ml bottle')?.id).toBe('bottle-750');
    expect(resolveProductByPhrase('had a protein shake')?.id).toBe('protein-shake-24g');
    expect(resolveProductByPhrase('a bowl of noodles')).toBeUndefined();
  });

  it('does not invent nutrition for products without label data', () => {
    const gel = getProduct('sis-go-isotonic-gel')!;
    expect(gel.nutrition_source).toBe('unknown');
    expect(gel.nutrition.carbohydrate_g).toBeNull();
    expect(gel.nutrition.sodium_mg).toBeNull();
  });

  it('preserves known label values', () => {
    expect(getProduct('protein-shake-24g')!.nutrition.protein_g).toBe(24);
    expect(getProduct('bottle-750')!.nutrition.fluid_ml).toBe(750);
  });
});
