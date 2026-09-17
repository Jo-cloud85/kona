import { beforeEach, describe, expect, it } from 'vitest';
import { createSeededRepository, DEMO_USER_ID } from '../../src/data/index';
import { runTool } from '../../src/agent/index';
import type { InMemoryRepository } from '../../src/data/in-memory-repository';
import type { PlannedSession } from '../../src/domain/types';

const NOW = new Date(2026, 8, 9, 9, 0, 0);

describe('save_actual_session — notes (M27.8)', () => {
  let repo: InMemoryRepository;

  beforeEach(async () => {
    repo = await createSeededRepository({ now: () => NOW });
  });

  it('inherits the linked plan\'s notes when the athlete gives no new description', async () => {
    const plan: PlannedSession = await repo.savePlannedSession({
      user_id: DEMO_USER_ID,
      sport: 'running',
      intensity: 'moderate',
      start_at: '2026-09-09T06:00:00',
      notes: 'interval',
    });
    const result = await runTool('save_actual_session', { status: 'completed', planned_session_id: plan.id }, { repo, userId: DEMO_USER_ID });
    expect((result.data as { notes?: string }).notes).toBe('interval');
  });

  it('uses the athlete\'s own new notes over the plan\'s when both are given', async () => {
    const plan: PlannedSession = await repo.savePlannedSession({
      user_id: DEMO_USER_ID,
      sport: 'running',
      intensity: 'moderate',
      start_at: '2026-09-09T06:00:00',
      notes: 'interval',
    });
    const result = await runTool(
      'save_actual_session',
      { status: 'modified', planned_session_id: plan.id, notes: 'easy jog instead' },
      { repo, userId: DEMO_USER_ID },
    );
    expect((result.data as { notes?: string }).notes).toBe('easy jog instead');
  });

  it('leaves notes unset with no plan and no given notes', async () => {
    const result = await runTool(
      'save_actual_session',
      { status: 'completed', sport: 'running', start_at: '2026-09-09T06:00:00' },
      { repo, userId: DEMO_USER_ID },
    );
    expect((result.data as { notes?: string }).notes).toBeUndefined();
  });
});
