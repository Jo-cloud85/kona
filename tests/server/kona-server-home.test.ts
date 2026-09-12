import { describe, expect, it } from 'vitest';
import { InMemoryRepository } from '../../src/data/index';
import { DeterministicLlmClient, runTool } from '../../src/agent/index';
import { getHome, getWeek, getStarter } from '../../lib/kona-server';
import type { KonaContext } from '../../lib/server-context';

/**
 * Regression coverage for a real alpha bug (2026-09-12): a standalone
 * "tomorrow I'm running 14km" session — saved via save_planned_session, which
 * never sets weekly_plan_id — was invisible on Home/Week/the chat starter
 * because getHome/getWeek/getStarter only fetched the latest weekly plan's
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

// Today, not tomorrow: today is always inside both buildHome's 14-day window
// and buildWeek's single 7-day window, whichever weekday "now" happens to be
// (tomorrow isn't — it can fall in the next Mon-Sun week, which buildWeek
// doesn't show, flakily failing this file when a run lands on a Sunday).
function isoSessionDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T18:00:00`;
}

describe('standalone planned sessions (no weekly_plan_id) reach Home/Week/starter', () => {
  it('getHome shows a standalone session on its date, with no weekly plan on record', async () => {
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

    const home = await getHome(ctx, start_at.slice(0, 10));
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
    expect(day?.title).toMatch(/run/i);
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

    const home = await getHome(ctx, start_at.slice(0, 10));
    expect(home!.briefing.your_day.headline).toContain('13-14km');
    expect(home!.briefing.your_day.headline).not.toContain('13.5');
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

    const home = await getHome(ctx, start_at.slice(0, 10));
    expect(home!.selected.sessions).toHaveLength(1);
    expect(home!.briefing.your_day.headline).toContain('13-14km');
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

    const home = await getHome(ctx, start_at.slice(0, 10));
    expect(home!.selected.sessions).toHaveLength(2);
  });
});
