import type { NewActivityEvent } from '../domain/types';
import type { Insight } from './insights';
import type { ToolResult } from './llm-client';

/**
 * Turn a completed turn (its tool results) + any newly-formed insights into
 * typed activity events. This is the raw material for the visible "how Kona's
 * been learning" timeline, and the seam a future XP layer would read.
 *
 * Pure and deterministic. Summaries are computed here so the timeline never has
 * to reconstruct them later.
 */

function find(results: ToolResult[], tool: string): ToolResult | undefined {
  return results.find((r) => r.tool === tool && r.ok);
}

function sessionPhrase(d: { distance_km?: number; duration_minutes?: number; sport?: string } | undefined): string {
  if (!d) return 'a session';
  const size = d.distance_km ? `${d.distance_km} km` : d.duration_minutes ? `${d.duration_minutes} min` : '';
  return `${size ? `${size} ` : ''}${d.sport ?? 'session'}`.trim();
}

/** Drop trailing non-diagnostic disclaimers from an insight line for the timeline. */
function trimInsight(text: string): string {
  return text.replace(/\s*Kona doesn'?t diagnose.*$/i, '').trim();
}

export function deriveTurnEvents(input: {
  userId: string;
  toolResults: ToolResult[];
  knownInsightTexts: Set<string>;
  insightsAfter: Insight[];
}): NewActivityEvent[] {
  const { userId, toolResults: r } = input;
  const out: NewActivityEvent[] = [];
  const ev = (type: NewActivityEvent['type'], summary: string, meta?: Record<string, unknown>): void => {
    out.push({ user_id: userId, type, summary, ...(meta ? { meta } : {}) });
  };

  const week = find(r, 'save_weekly_plan');
  if (week) {
    const sessions = (week.data as { sessions?: unknown[] } | undefined)?.sessions ?? [];
    ev('plan_saved', `You planned your week (${sessions.length} session${sessions.length === 1 ? '' : 's'})`);
  }
  const planned = find(r, 'save_planned_session');
  if (planned) ev('plan_saved', `You planned ${sessionPhrase(planned.data as never)}`);

  const updated = find(r, 'update_planned_sessions');
  if (updated) {
    const n = ((updated.data as { updated?: unknown[] } | undefined)?.updated ?? []).length;
    ev('plan_updated', `You updated ${n} planned session${n === 1 ? '' : 's'}`);
  }

  const actual = find(r, 'save_actual_session');
  if (actual) {
    const d = actual.data as { status?: string } | undefined;
    const tag = d?.status && d.status !== 'completed' ? ` (${d.status.replace('_', ' ')})` : '';
    ev('session_logged', `You logged ${sessionPhrase(actual.data as never)}${tag}`);
  }

  const fuel = find(r, 'log_fuel_intake');
  if (fuel) {
    const items = ((fuel.data as { items?: { description?: string }[] } | undefined)?.items ?? [])
      .map((i) => i.description)
      .filter(Boolean)
      .slice(0, 4)
      .join(', ');
    ev('fuel_logged', items ? `You logged fuel: ${items}` : 'You logged fuel');
  }

  const recovery = find(r, 'save_recovery');
  if (recovery) ev('recovery_logged', 'You logged how a session felt');

  const mem = find(r, 'propose_memory_update');
  if (mem) {
    const v = (mem.data as { value?: string } | undefined)?.value;
    ev('fact_learned', v ? `Kona remembered: ${v}` : 'Kona remembered something you said');
  }

  const fact = find(r, 'save_profile_fact');
  if (fact) {
    const d = fact.data as
      | { body_weight_kg?: number; usual_bottle_ml?: number; goal?: { text?: string; event_date?: string } }
      | undefined;
    const bits = [
      typeof d?.body_weight_kg === 'number' ? `${d.body_weight_kg} kg` : null,
      typeof d?.usual_bottle_ml === 'number' ? `a ${d.usual_bottle_ml} ml bottle` : null,
      d?.goal?.text
        ? `your goal — ${d.goal.text}${d.goal.event_date ? ` (${d.goal.event_date})` : ''}`
        : null,
    ].filter(Boolean);
    ev('fact_learned', `Kona noted ${bits.join(' and ') || 'a detail about you'}`);
  }

  // Newly-formed observations — "it became relevant" + "Kona changed future advice".
  // Only patterns and facts are "spotted"; recommendation-kind insights are
  // downstream advice, covered by recommendation_adapted below.
  for (const i of input.insightsAfter) {
    if (input.knownInsightTexts.has(trimInsight(i.text))) continue;
    if (i.kind !== 'pattern' && i.kind !== 'fact') continue;
    ev('insight_formed', `Kona spotted — ${trimInsight(i.text)}`, { kind: i.kind, topic: i.topic });
    if (i.kind === 'pattern' || i.topic === 'fuelling') {
      ev('recommendation_adapted', `Kona will factor this into your ${i.topic} advice from now on`, {
        from: trimInsight(i.text),
      });
    }
  }

  return out;
}
