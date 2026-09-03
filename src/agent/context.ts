import type { Repository } from '../data/repository.js';
import type { ContextPackage } from './llm-client.js';

/**
 * Build the compact context package (ARCHITECTURE.md "Important design rule":
 * never pass the whole history to the LLM). Only the facts a turn plausibly
 * needs: profile, the current plan, the last actual session, a little history,
 * durable memories.
 */
export async function buildContext(
  repo: Repository,
  userId: string,
  nowIso: string,
): Promise<ContextPackage> {
  const [profile, planned, actuals, memories] = await Promise.all([
    repo.getProfile(userId),
    repo.listPlannedSessions(userId),
    repo.listActualSessions(userId),
    repo.listMemories(userId),
  ]);

  const today = nowIso.slice(0, 10);
  const current_plan =
    planned.filter((p) => p.start_at.slice(0, 10) >= today)[0] ?? planned[planned.length - 1];
  const last_actual_session = actuals[actuals.length - 1];

  const history = await repo.getRelevantHistory(userId, {
    sport: current_plan?.sport ?? last_actual_session?.sport,
    limit: 5,
  });

  return { now_iso: nowIso, profile, current_plan, last_actual_session, history, memories };
}
