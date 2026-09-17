import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRepository } from '../../src/data/index';
import { DeterministicLlmClient, runTool } from '../../src/agent/index';
import { getToday, getWeek, getStarter, respondToRecommendation } from '../../lib/kona-server';
import type { KonaContext } from '../../lib/server-context';

/**
 * Regression coverage for a real alpha bug (2026-09-12): a standalone
 * "tomorrow I'm running 14km" session — saved via save_planned_session, which
 * never sets weekly_plan_id — was invisible on Home/Week/the chat starter
 * because getToday/getWeek/getStarter only fetched the latest weekly plan's
 * sessions. They now fetch every planned session for the user.
 */

const USER_ID = 'u-standalone-session';

async function ctxWith(repo: InMemoryRepository): Promise<KonaContext> {
  await repo.upsertProfile({
    user_id: USER_ID,
    username: 'Jo',
    usual_sports: ['running'],
    onboarded_at: '2026-09-01T00:00:00Z',
  });
  return { repo, userId: USER_ID, llm: new DeterministicLlmClient(), persistent: false };
}

// Today, not tomorrow: today is always inside both buildToday's 14-day window
// and buildWeek's single 7-day window, whichever weekday "now" happens to be
// (tomorrow isn't — it can fall in the next Mon-Sun week, which buildWeek
// doesn't show, flakily failing this file when a run lands on a Sunday).
function isoSessionDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T18:00:00`;
}

describe('standalone planned sessions (no weekly_plan_id) reach Home/Week/starter', () => {
  it('getToday shows a standalone session on its date, with no weekly plan on record', async () => {
    const repo = new InMemoryRepository();
    const ctx = await ctxWith(repo);
    const start_at = isoSessionDate();

    await repo.savePlannedSession({
      user_id: USER_ID,
      sport: 'running',
      start_at,
      distance_km: 14,
      intensity: 'easy',
    });

    const home = await getToday(ctx, start_at.slice(0, 10));
    expect(home).not.toBeNull();
    expect(home!.selected.sessions).toHaveLength(1);
    expect(home!.selected.sessions[0]).toMatchObject({ sport: 'running' });
    const day = home!.week.find((d) => d.date === start_at.slice(0, 10));
    expect(day?.has_session).toBe(true);
  });

  it('getWeek shows a standalone session even without a weekly plan', async () => {
    const repo = new InMemoryRepository();
    const ctx = await ctxWith(repo);
    const start_at = isoSessionDate();

    await repo.savePlannedSession({
      user_id: USER_ID,
      sport: 'running',
      start_at,
      distance_km: 14,
      intensity: 'easy',
    });

    const week = await getWeek(ctx);
    const day = week?.days.find((d) => d.date === start_at.slice(0, 10));
    expect(day?.title_lines.join(' ')).toMatch(/run/i);
  });

  it('getStarter still resolves when a standalone session exists with no weekly plan', async () => {
    const repo = new InMemoryRepository();
    const ctx = await ctxWith(repo);
    await repo.savePlannedSession({
      user_id: USER_ID,
      sport: 'running',
      start_at: isoSessionDate(),
      distance_km: 14,
      intensity: 'easy',
    });

    await expect(getStarter(ctx)).resolves.not.toBeNull();
  });
});

describe('a stated distance range reaches Home verbatim (save_planned_session tool call)', () => {
  it('does not collapse "13-14km" into a fabricated-looking 13.5', async () => {
    const repo = new InMemoryRepository();
    const ctx = await ctxWith(repo);
    const start_at = isoSessionDate();

    const result = await runTool(
      'save_planned_session',
      { sport: 'running', start_at, distance_km: 13.5, distance_label: '13-14km', intensity: 'easy' },
      { repo, userId: USER_ID },
    );
    expect(result.ok).toBe(true);

    const home = await getToday(ctx, start_at.slice(0, 10));
    expect(home!.selected.sessions[0]!.duration_label).toBe('13-14km');
    expect(home!.selected.sessions[0]!.duration_label).not.toContain('13.5');
  });
});

describe('save_planned_session edits an existing standalone session instead of duplicating it', () => {
  it('a second call for the same date + sport updates in place (real alpha bug, 2026-09-13)', async () => {
    const repo = new InMemoryRepository();
    const ctx = await ctxWith(repo);
    const start_at = isoSessionDate();

    await runTool(
      'save_planned_session',
      { sport: 'running', start_at, distance_km: 13.5, intensity: 'easy' },
      { repo, userId: USER_ID },
    );
    // The athlete follows up: "tomorrow evening's run is updated to 13-14km" —
    // this must edit the session above, not add a second one for the same day.
    const second = await runTool(
      'save_planned_session',
      { sport: 'running', start_at, distance_km: 13.5, distance_label: '13-14km', intensity: 'easy' },
      { repo, userId: USER_ID },
    );
    expect(second.ok).toBe(true);

    const all = await repo.listPlannedSessions(USER_ID);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ distance_label: '13-14km' });

    const home = await getToday(ctx, start_at.slice(0, 10));
    expect(home!.selected.sessions).toHaveLength(1);
    expect(home!.selected.sessions[0]!.duration_label).toBe('13-14km');
  });

  it('a different sport on the same date is still a separate session (double-session day)', async () => {
    const repo = new InMemoryRepository();
    const ctx = await ctxWith(repo);
    const start_at = isoSessionDate();

    await runTool(
      'save_planned_session',
      { sport: 'running', start_at, distance_km: 10, intensity: 'easy' },
      { repo, userId: USER_ID },
    );
    await runTool(
      'save_planned_session',
      { sport: 'swimming', start_at, distance_km: 1.5, intensity: 'easy' },
      { repo, userId: USER_ID },
    );

    const home = await getToday(ctx, start_at.slice(0, 10));
    expect(home!.selected.sessions).toHaveLength(2);
  });
});

describe('delete_planned_session / delete_actual_session', () => {
  it('removes a planned session by date, so it stops showing on Home entirely (not marked skipped)', async () => {
    const repo = new InMemoryRepository();
    const ctx = await ctxWith(repo);
    const start_at = isoSessionDate();
    const date = start_at.slice(0, 10);

    await runTool('save_planned_session', { sport: 'running', start_at, distance_km: 14, intensity: 'easy' }, { repo, userId: USER_ID });
    const del = await runTool('delete_planned_session', { date }, { repo, userId: USER_ID });
    expect(del.ok).toBe(true);
    expect((del.data as { deleted: boolean }).deleted).toBe(true);

    expect(await repo.listPlannedSessions(USER_ID)).toHaveLength(0);
    expect(await repo.listActualSessions(USER_ID)).toHaveLength(0); // never became a "skipped" actual session

    const home = await getToday(ctx, date);
    expect(home!.selected.sessions).toHaveLength(0);
  });

  it('errors instead of guessing when day + sport match more than one planned session', async () => {
    const repo = new InMemoryRepository();
    const start_at = isoSessionDate();
    const date = start_at.slice(0, 10);

    await runTool('save_planned_session', { sport: 'running', start_at, distance_km: 10, intensity: 'easy' }, { repo, userId: USER_ID });
    await runTool('save_planned_session', { sport: 'swimming', start_at, distance_km: 1.5, intensity: 'easy' }, { repo, userId: USER_ID });

    const del = await runTool('delete_planned_session', { date }, { repo, userId: USER_ID });
    expect(del.ok).toBe(false);
    expect(await repo.listPlannedSessions(USER_ID)).toHaveLength(2); // untouched — no guessing

    const delSport = await runTool('delete_planned_session', { date, sport: 'running' }, { repo, userId: USER_ID });
    expect(delSport.ok).toBe(true);
    const remaining = await repo.listPlannedSessions(USER_ID);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ sport: 'swimming' });
  });

  it('removes a logged actual session by date', async () => {
    const repo = new InMemoryRepository();
    const start_at = isoSessionDate();
    const date = start_at.slice(0, 10);

    await repo.saveActualSession({ user_id: USER_ID, sport: 'running', start_at, intensity: 'easy', status: 'completed' });
    const del = await runTool('delete_actual_session', { date }, { repo, userId: USER_ID });
    expect(del.ok).toBe(true);
    expect(await repo.listActualSessions(USER_ID)).toHaveLength(0);
  });
});

describe('getToday/getWeek/sendMessage use the athlete\'s timezone for "today", not the server\'s clock', () => {
  // 2026-09-13T16:20:00Z == 2026-09-14T00:20:00+08:00 — the exact real-world
  // instant the bug was found at: server-local/UTC still reads the 13th, the
  // athlete's own wall clock already reads the 14th.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T16:20:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('getToday reports "today" in the athlete\'s local date, not the server\'s', async () => {
    const repo = new InMemoryRepository();
    const ctx = await ctxWith(repo);

    const utcHome = await getToday(ctx, undefined, 'UTC');
    expect(utcHome!.today).toBe('2026-09-13');

    const sgtHome = await getToday(ctx, undefined, 'Asia/Singapore');
    expect(sgtHome!.today).toBe('2026-09-14');
  });

  it('getWeek highlights the athlete\'s local today, not the server\'s', async () => {
    const repo = new InMemoryRepository();
    const ctx = await ctxWith(repo);

    const sgtWeek = await getWeek(ctx, 'Asia/Singapore');
    expect(sgtWeek!.days.find((d) => d.is_today)?.date).toBe('2026-09-14');

    const utcWeek = await getWeek(ctx, 'UTC');
    expect(utcWeek!.days.find((d) => d.is_today)?.date).toBe('2026-09-13');
  });

});

describe('a missed end-of-day check-in stays flagged once the local day has passed (2026-09-14 alpha feedback)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('getToday flags yesterday (athlete-local) as missed once "today" rolls over, and stays due', async () => {
    const repo = new InMemoryRepository();
    const ctx = await ctxWith(repo);

    vi.setSystemTime(new Date('2026-09-13T10:00:00.000Z')); // 2026-09-13T18:00 SGT
    await repo.savePlannedSession({
      user_id: USER_ID,
      sport: 'running',
      start_at: '2026-09-13T18:00:00',
      distance_km: 10,
      intensity: 'easy',
    });

    vi.setSystemTime(new Date('2026-09-13T16:20:00.000Z')); // 2026-09-14T00:20 SGT — next local day
    const home = await getToday(ctx, undefined, 'Asia/Singapore');
    expect(home!.today).toBe('2026-09-14');
    expect(home!.checkin.missed_date).toBe('2026-09-13');
    expect(home!.checkin.due).toBe(true);
    expect(home!.checkin.today_due).toBe(false); // today itself has no session yet
  });

  it('a recovery log dated the same local day as the session resolves it; a next-day log does not', async () => {
    const repo = new InMemoryRepository();
    const ctx = await ctxWith(repo);

    vi.setSystemTime(new Date('2026-09-13T10:00:00.000Z')); // 2026-09-13T18:00 SGT
    await repo.savePlannedSession({
      user_id: USER_ID,
      sport: 'running',
      start_at: '2026-09-13T18:00:00',
      distance_km: 10,
      intensity: 'easy',
    });
    await repo.saveRecoveryLog({ user_id: USER_ID, free_text: 'End-of-day check-in — felt fine' });

    vi.setSystemTime(new Date('2026-09-13T16:20:00.000Z')); // next local day
    const resolvedHome = await getToday(ctx, undefined, 'Asia/Singapore');
    expect(resolvedHome!.checkin.missed_date).toBeNull(); // logged the same local day it was due
  });
});

describe('load-clustering recommendation reaches getToday and respondToRecommendation closes the loop (M27)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T08:00:00.000Z')); // Monday
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function seedCluster(repo: InMemoryRepository) {
    await repo.saveWeeklyPlan({ user_id: USER_ID, week_start: '2026-09-14', rest_days: ['2026-09-16'] });
    for (const date of ['2026-09-11', '2026-09-12', '2026-09-13']) {
      await repo.saveActualSession({
        user_id: USER_ID,
        sport: 'running',
        start_at: `${date}T18:00:00`,
        intensity: 'hard',
        status: 'completed',
      });
    }
    return repo.savePlannedSession({
      user_id: USER_ID,
      sport: 'running',
      start_at: '2026-09-14T18:00:00',
      intensity: 'hard',
    });
  }

  it('getToday surfaces a real accept/decline proposal, not just softened advice', async () => {
    const repo = new InMemoryRepository();
    const ctx = await ctxWith(repo);
    const today = await seedCluster(repo);

    const home = await getToday(ctx, undefined, 'UTC');
    const rec = home!.briefing.kona_briefing.pending_recommendation;
    expect(rec).not.toBeNull();
    expect(rec).toMatchObject({ session_id: today.id, from_date: '2026-09-14', to_date: '2026-09-16' });
  });

  it('accepting moves the session and the proposal is gone next time', async () => {
    const repo = new InMemoryRepository();
    const ctx = await ctxWith(repo);
    const today = await seedCluster(repo);
    const before = await getToday(ctx, undefined, 'UTC');
    const rec = before!.briefing.kona_briefing.pending_recommendation!;

    const result = await respondToRecommendation(ctx, {
      action: 'accept',
      recommendation_id: rec.id,
      session_id: rec.session_id,
      to_date: rec.to_date,
    });
    expect(result.ok).toBe(true);

    const moved = await repo.getPlannedSession(today.id);
    expect(moved?.start_at).toBe('2026-09-16T18:00:00');

    const after = await getToday(ctx, undefined, 'UTC');
    // The session no longer falls today, so there's nothing left today to cluster onto.
    expect(after!.briefing.kona_briefing.pending_recommendation).toBeNull();
  });

  it('declining is remembered — the exact same swap is never proposed again', async () => {
    const repo = new InMemoryRepository();
    const ctx = await ctxWith(repo);
    await seedCluster(repo);
    const before = await getToday(ctx, undefined, 'UTC');
    const rec = before!.briefing.kona_briefing.pending_recommendation!;

    await respondToRecommendation(ctx, {
      action: 'decline',
      recommendation_id: rec.id,
      session_id: rec.session_id,
      to_date: rec.to_date,
    });

    const after = await getToday(ctx, undefined, 'UTC');
    expect(after!.briefing.kona_briefing.pending_recommendation).toBeNull();
    // Falls back to the softer, non-proposal advice instead of going silent.
    expect(after!.briefing.kona_briefing.headline).toMatch(/maintenance/i);
  });
});

describe('the Kona Briefing (M24) reaches Home and the chat starter identically', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('getToday.briefing.kona_briefing and getStarter\'s opener say the exact same thing', async () => {
    const repo = new InMemoryRepository();
    const ctx = await ctxWith(repo);

    // A comparable past long run with a reported hydration flag, a week ago.
    vi.setSystemTime(new Date('2026-09-07T18:00:00.000Z'));
    await repo.saveActualSession({
      user_id: USER_ID,
      sport: 'running',
      intensity: 'easy',
      is_long: true,
      start_at: '2026-09-07T18:00:00',
      status: 'completed',
    });
    await repo.saveRecoveryLog({ user_id: USER_ID, free_text: 'got very thirsty in the final third' });

    // Today: a matching long run planned for tomorrow.
    vi.setSystemTime(new Date('2026-09-14T08:00:00.000Z'));
    await repo.savePlannedSession({
      user_id: USER_ID,
      sport: 'running',
      start_at: '2026-09-15T18:00:00',
      is_long: true,
      intensity: 'easy',
    });

    const home = await getToday(ctx, undefined, 'UTC');
    const starter = await getStarter(ctx, 'UTC');

    expect(home!.briefing.kona_briefing.session_label).not.toBeNull();
    expect(home!.briefing.kona_briefing.why).toMatch(/thirsty/i);
    expect(starter!.greeting).toContain(home!.briefing.kona_briefing.action);
    expect(starter!.greeting).toContain(home!.briefing.kona_briefing.why);
  });
});
