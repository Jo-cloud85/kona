import type { MissingDetail, Sport } from '../domain/types';
import type { Repository } from '../data/repository';
import type { ContextPackage, PendingPlanDetail } from './llm-client';

/**
 * Build the compact context package (ARCHITECTURE.md "Important design rule":
 * never pass the whole history to the LLM). Only the facts a turn plausibly
 * needs: profile, the current plan, the last actual session, the current weekly
 * plan (+ any of its sessions still missing detail), a little history, memories.
 */
export async function buildContext(
  repo: Repository,
  userId: string,
  nowIso: string,
): Promise<ContextPackage> {
  const [profile, planned, actuals, memories, weeks] = await Promise.all([
    repo.getProfile(userId),
    repo.listPlannedSessions(userId),
    repo.listActualSessions(userId),
    repo.listMemories(userId),
    repo.listWeeklyPlans(userId),
  ]);

  const today = nowIso.slice(0, 10);
  const current_plan =
    planned.filter((p) => p.start_at.slice(0, 10) >= today)[0] ?? planned[planned.length - 1];
  const last_actual_session = actuals[actuals.length - 1];
  const current_week_plan = weeks[weeks.length - 1];

  let pending_plan_details: PendingPlanDetail | undefined;
  if (current_week_plan) {
    const weekSessions = await repo.listPlannedSessionsForWeeklyPlan(current_week_plan.id);
    const [wy, wm, wdd] = current_week_plan.week_start.split('-').map(Number) as [number, number, number];
    const groups = new Map<
      Sport,
      { sport: Sport; day_indexes: number[]; weekday_labels: string[]; missing: Set<MissingDetail> }
    >();
    for (const s of weekSessions) {
      if (!s.needs_detail?.length) continue;
      const [sy, sm, sd] = s.start_at.slice(0, 10).split('-').map(Number) as [number, number, number];
      const dayIndex = Math.round(
        (Date.UTC(sy, sm - 1, sd) - Date.UTC(wy, wm - 1, wdd)) / 86_400_000,
      );
      const label = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][((dayIndex % 7) + 7) % 7]!;
      const g =
        groups.get(s.sport) ??
        { sport: s.sport, day_indexes: [] as number[], weekday_labels: [] as string[], missing: new Set<MissingDetail>() };
      g.day_indexes.push(dayIndex);
      g.weekday_labels.push(label);
      for (const m of s.needs_detail) g.missing.add(m);
      groups.set(s.sport, g);
    }
    if (groups.size > 0) {
      pending_plan_details = {
        week_start: current_week_plan.week_start,
        groups: [...groups.values()].map((g) => ({
          sport: g.sport,
          day_indexes: g.day_indexes,
          weekday_labels: g.weekday_labels,
          missing: [...g.missing],
        })),
      };
    }
  }

  // Recent activity across all sports — "what have you been doing" — so the
  // model can reference it. Deeper sport-specific lookups use the
  // get_relevant_history tool.
  const history = await repo.getRelevantHistory(userId, { limit: 6 });

  return {
    now_iso: nowIso,
    profile,
    current_plan,
    last_actual_session,
    current_week_plan,
    pending_plan_details,
    history,
    memories,
  };
}
