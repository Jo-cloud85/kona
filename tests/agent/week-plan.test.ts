import { beforeEach, describe, expect, it } from 'vitest';
import { createSeededRepository, DEMO_USER_ID } from '../../src/data/index';
import { DeterministicLlmClient, handleMessage, type AgentDeps } from '../../src/agent/index';
import { parseWeeklyPlan, resolveWeekStart } from '../../src/agent/parse';
import type { InMemoryRepository } from '../../src/data/in-memory-repository';

// Mon 7 Sep 2026, 9am local.
const NOW = new Date(2026, 8, 7, 9, 0, 0);
const SPEC_WEEK = 'Monday gym, Tuesday 8km run, Wednesday swim, Thursday rest, Friday bike + run, Sunday long run.';

describe('parseWeeklyPlan', () => {
  it('parses the PRODUCT_VISION weekly example', () => {
    const days = parseWeeklyPlan(SPEC_WEEK);
    expect(days.map((d) => d.day_index)).toEqual([0, 1, 2, 3, 4, 6]);

    const [mon, tue, wed, thu, fri, sun] = days;
    expect(mon!.sessions).toEqual([expect.objectContaining({ sport: 'gym' })]);
    expect(tue!.sessions[0]).toMatchObject({ sport: 'running', distance_km: 8 });
    expect(wed!.sessions[0]).toMatchObject({ sport: 'swimming' });
    expect(thu!.rest).toBe(true);
    expect(fri!.sessions.map((s) => s.sport)).toEqual(['cycling', 'running']);
    expect(sun!.sessions[0]).toMatchObject({ sport: 'running', is_long: true });
  });

  it('returns [] when fewer than two weekdays are named', () => {
    expect(parseWeeklyPlan('Tuesday 8km run')).toEqual([]);
  });

  it('resolveWeekStart returns the Monday of the current week', () => {
    expect(resolveWeekStart(NOW.toISOString(), SPEC_WEEK)).toBe('2026-09-07');
    expect(resolveWeekStart(NOW.toISOString(), 'next week: Mon gym, Tue run')).toBe('2026-09-14');
  });
});

describe('weekly plan conversation slice', () => {
  let repo: InMemoryRepository;
  let deps: AgentDeps;

  beforeEach(async () => {
    repo = await createSeededRepository({ now: () => NOW });
    deps = { repo, llm: new DeterministicLlmClient() };
  });

  const say = (message: string) =>
    handleMessage(deps, { userId: DEMO_USER_ID, conversationId: 'wk', message, now: NOW });

  it('parses, saves, links, and flags the key days', async () => {
    const turn = await say(SPEC_WEEK);

    expect(turn.intent).toBe('plan_week');
    expect(turn.tool_calls.map((c) => c.tool)).toEqual(['save_weekly_plan']);

    // 6 planned sessions (gym, run, swim, bike, run, long run); Thursday is rest.
    const planned = await repo.listPlannedSessions(DEMO_USER_ID);
    expect(planned.map((p) => `${p.start_at.slice(0, 10)}:${p.sport}`)).toEqual([
      '2026-09-07:gym',
      '2026-09-08:running',
      '2026-09-09:swimming',
      '2026-09-11:cycling',
      '2026-09-11:running',
      '2026-09-13:running',
    ]);

    // Friday's two sessions share a session_group_id.
    const friday = planned.filter((p) => p.start_at.startsWith('2026-09-11'));
    expect(friday).toHaveLength(2);
    expect(friday[0]!.session_group_id).toBeDefined();
    expect(friday[0]!.session_group_id).toBe(friday[1]!.session_group_id);

    // All linked to one weekly plan; Thursday recorded as a rest day.
    const weeks = await repo.listWeeklyPlans(DEMO_USER_ID);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.week_start).toBe('2026-09-07');
    expect(weeks[0]!.rest_days).toEqual(['2026-09-10']);
    expect(planned.every((p) => p.weekly_plan_id === weeks[0]!.id)).toBe(true);

    // Reply names the double day and the long run, with day-before prep.
    expect(turn.reply).toMatch(/Fri: .*cycling \+ .*running — double session/);
    expect(turn.reply).toMatch(/Thu: rest/);
    expect(turn.reply).toMatch(/Sun: .*running/);
    expect(turn.reply).toMatch(/double-session day/i);
    expect(turn.reply).toMatch(/night before/i);
    expect(turn.reply).not.toMatch(/\bcaused by\b/i);
  });

  it('remembers the week so a later actual session links to the plan', async () => {
    await say(SPEC_WEEK);
    // On Tuesday the athlete reports what actually happened.
    const turn = await handleMessage(deps, {
      userId: DEMO_USER_ID,
      conversationId: 'wk',
      message: 'Actually I only ran 5km on Tuesday because I was short on time.',
      now: new Date(2026, 8, 8, 19, 0, 0),
    });
    expect(turn.intent).toBe('log_actual');
    const actuals = await repo.listActualSessions(DEMO_USER_ID);
    expect(actuals).toHaveLength(1);
    expect(actuals[0]).toMatchObject({ distance_km: 5, sport: 'running' });
    // linked to Tuesday's planned 8km run from the week
    const tuePlan = (await repo.listPlannedSessions(DEMO_USER_ID)).find((p) =>
      p.start_at.startsWith('2026-09-08'),
    )!;
    expect(actuals[0]!.planned_session_id).toBe(tuePlan.id);
    // the plan itself is untouched
    expect(tuePlan.distance_km).toBe(8);
  });
});
