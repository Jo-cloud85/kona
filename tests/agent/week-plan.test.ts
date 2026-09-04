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
    expect(turn.reply).toMatch(/Fri: .*cycling.*\+.*running.*— double session/);
    expect(turn.reply).toMatch(/Thu: rest/);
    expect(turn.reply).toMatch(/Sun: .*long running/);
    expect(turn.reply).toMatch(/double-session day/i);
    expect(turn.reply).toMatch(/night before/i);
    expect(turn.reply).not.toMatch(/\bcaused by\b/i);

    // It does NOT assert "easy" for sessions the user didn't rate, and asks.
    expect(turn.reply).toMatch(/Mon: gym \(effort & distance\/time not set\)/);
    expect(turn.reply).not.toMatch(/Mon: easy gym/);
    expect(turn.reply).toMatch(/pin down/i);
    expect(turn.reply).toMatch(/How hard .*gym/i);
    expect(turn.reply).toMatch(/How hard .*swimming/i);
    expect(turn.reply).toMatch(/how long .*\(or what distance\)/i);
  });

  it('asks about under-specified sessions, then fills them in from a plain-language answer', async () => {
    await say(SPEC_WEEK);

    // "I sweat and pant a lot 15 min in" => hard; "about an hour" => 60 min.
    const turn = await say('The gym sessions take about an hour and I sweat and pant a lot 15 minutes in.');
    expect(turn.intent).toBe('clarify_plan_detail');
    expect(turn.tool_calls[0]!.tool).toBe('update_planned_sessions');

    const gymSessions = (await repo.listPlannedSessions(DEMO_USER_ID)).filter((p) => p.sport === 'gym');
    expect(gymSessions).toHaveLength(1); // only Monday in the spec week
    expect(gymSessions[0]).toMatchObject({ intensity: 'hard', duration_minutes: 60 });
    expect(gymSessions[0]!.needs_detail ?? []).toEqual([]);

    expect(turn.reply).toMatch(/Updated: Mon gym → .*60 min.*hard/);
    // still open: swim, running, cycling
    expect(turn.reply).toMatch(/Still open:/);
    expect(turn.reply).toMatch(/swimming/i);
  });

  it('a multi-day answer fills each day and is NOT read as a new plan', async () => {
    await say('Monday gym, Wednesday swim, Friday gym, Sunday long run.');
    const before = (await repo.listWeeklyPlans(DEMO_USER_ID)).length;

    const turn = await say("Sunday's long run is usually 22km, and the Wednesday swim is about 2km.");
    expect(turn.intent).toBe('clarify_plan_detail');
    // no new weekly plan created
    expect(await repo.listWeeklyPlans(DEMO_USER_ID)).toHaveLength(before);

    const planned = await repo.listPlannedSessions(DEMO_USER_ID);
    const sun = planned.find((p) => p.sport === 'running')!;
    const wed = planned.find((p) => p.sport === 'swimming')!;
    expect(sun.distance_km).toBe(22);
    expect(wed.distance_km).toBe(2);
  });

  it('a compound answer containing "only"/"because" is NOT logged as a modified workout', async () => {
    await say(
      'Monday rest, Tuesday intervals run, Wednesday gym, Thursday bike + easy run, Friday gym, Saturday swim, Sunday long run.',
    );

    const turn = await say(
      'For Tue the intervals are about 5-7km, roughly an hour. Wednesday and Friday gym feel hard, about an hour. ' +
        'Thursday cycling feels easy because I only ride about 20km. Saturday swim is hard even though I only swim about 1km, because I am new to freestyle.',
    );

    // must not create an actual session
    expect(turn.intent).not.toBe('log_actual');
    expect(await repo.listActualSessions(DEMO_USER_ID)).toHaveLength(0);
    expect(turn.reply).not.toMatch(/Logged the actual/i);
    expect(turn.reply).not.toMatch(/new to freestyle/i);

    // it should have filled in some plan detail
    expect(turn.intent).toBe('clarify_plan_detail');
    const planned = await repo.listPlannedSessions(DEMO_USER_ID);
    const cycling = planned.find((p) => p.sport === 'cycling')!;
    expect(cycling.distance_km).toBe(20);
    expect(cycling.intensity).toBe('easy');
    const swim = planned.find((p) => p.sport === 'swimming')!;
    expect(swim.distance_km).toBe(1);
    expect(swim.intensity).toBe('hard');
  });

  it('"Wed and Fri sessions feel hard" fills both days', async () => {
    await say('Monday gym, Wednesday gym, Friday gym, Sunday long run.');
    const turn = await say('Wed and Fri sessions usually feel hard and take about an hour.');
    expect(turn.intent).toBe('clarify_plan_detail');

    const gyms = (await repo.listPlannedSessions(DEMO_USER_ID)).filter((p) => p.sport === 'gym');
    const wed = gyms.find((p) => p.start_at.startsWith('2026-09-09'))!;
    const fri = gyms.find((p) => p.start_at.startsWith('2026-09-11'))!;
    expect(wed).toMatchObject({ intensity: 'hard', duration_minutes: 60 });
    expect(fri).toMatchObject({ intensity: 'hard', duration_minutes: 60 });
    // Monday gym (not mentioned) is untouched
    const mon = gyms.find((p) => p.start_at.startsWith('2026-09-07'))!;
    expect(mon.needs_detail).toContain('intensity');
  });

  it('keeps a comma-joined effort+duration together, and different efforts per clause', async () => {
    await say('Monday gym, Wednesday gym, Thursday bike + easy run, Friday gym, Sunday long run.');
    const turn = await say('Wed and Fri gym are hard, about an hour. Thursday bike is easy.');
    expect(turn.intent).toBe('clarify_plan_detail');

    const planned = await repo.listPlannedSessions(DEMO_USER_ID);
    const wed = planned.find((p) => p.sport === 'gym' && p.start_at.startsWith('2026-09-09'))!;
    const fri = planned.find((p) => p.sport === 'gym' && p.start_at.startsWith('2026-09-11'))!;
    const bike = planned.find((p) => p.sport === 'cycling')!;
    expect(wed).toMatchObject({ intensity: 'hard', duration_minutes: 60 }); // "hard, about an hour" kept whole
    expect(fri).toMatchObject({ intensity: 'hard', duration_minutes: 60 });
    expect(bike.intensity).toBe('easy'); // not smeared with the gym's "hard"
  });

  it('fills a single day from "Saturday swim is usually 1.5km"', async () => {
    await say('Monday gym, Wednesday swim, Saturday swim, Sunday long run.');
    const turn = await say('Saturday swim is usually about 1.5km.');
    expect(turn.intent).toBe('clarify_plan_detail');

    const swims = (await repo.listPlannedSessions(DEMO_USER_ID)).filter((p) => p.sport === 'swimming');
    const sat = swims.find((p) => p.start_at.startsWith('2026-09-12'))!;
    const wed = swims.find((p) => p.start_at.startsWith('2026-09-09'))!;
    expect(sat.distance_km).toBe(1.5);
    expect(sat.needs_detail).toEqual(['intensity']); // distance filled, effort still open
    expect(wed.distance_km).toBeUndefined(); // Wednesday untouched
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
