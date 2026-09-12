import { describe, expect, it } from 'vitest';
import { InMemoryRepository } from '../../src/data/index';
import { DeterministicLlmClient } from '../../src/agent/index';
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

function isoTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T18:00:00`;
}

describe('standalone planned sessions (no weekly_plan_id) reach Home/Week/starter', () => {
  it('getHome shows a standalone session on its date, with no weekly plan on record', async () => {
    const repo = new InMemoryRepository();
    const ctx = await ctxWith(repo);
    const start_at = isoTomorrow();

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
    const start_at = isoTomorrow();

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
      start_at: isoTomorrow(),
      distance_km: 14,
      intensity: 'easy',
    });

    await expect(getStarter(ctx)).resolves.not.toBeNull();
  });
});
