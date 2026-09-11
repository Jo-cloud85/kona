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
  /** Insight texts (pattern/fact/recommendation) Kona had already recorded BEFORE this turn. */
  knownInsightTexts: Set<string>;
  insightsAfter: Insight[];
  /** This turn produced a fresh piece of advice (a fuelling calc or a week plan). */
  adviceProducedThisTurn?: boolean;
  /** Recommendation-insight texts Kona has already reported as `recommendation_adapted`. */
  alreadyAdaptedFrom?: Set<string>;
  /** The chat message (turn) these events belong to (M23.1). */
  originMessageId?: string;
}): NewActivityEvent[] {
  const { userId, toolResults: r, originMessageId } = input;
  const out: NewActivityEvent[] = [];
  const ev = (type: NewActivityEvent['type'], summary: string, meta?: Record<string, unknown>): void => {
    out.push({
      user_id: userId,
      type,
      summary,
      ...(meta ? { meta } : {}),
      ...(originMessageId ? { origin_message_id: originMessageId } : {}),
    });
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

  // The learning chain, kept honest about what has actually happened:
  //  - a NEW pattern/fact that just crossed its threshold → `insight_formed`
  //    ("Kona spotted — …"). This is "it became relevant", nothing more.
  //  - a NEW outcome-based recommendation → `insight_formed` ("Kona's take — …").
  //    Recorded so a later turn can tell it was already on file — but NOT yet a
  //    claim that any recommendation changed.
  //  - `recommendation_adapted` fires ONLY on a LATER turn: the standing
  //    recommendation insight was already known, and this turn actually produced
  //    a piece of advice that had it available. Once per insight.
  const adviceThisTurn = Boolean(input.adviceProducedThisTurn);
  const alreadyAdapted = input.alreadyAdaptedFrom ?? new Set<string>();
  for (const i of input.insightsAfter) {
    const t = trimInsight(i.text);
    const known = input.knownInsightTexts.has(t);

    if (i.kind === 'pattern' || i.kind === 'fact') {
      if (!known) ev('insight_formed', `Kona spotted — ${t}`, { kind: i.kind, basis: i.basis, topic: i.topic });
      continue;
    }

    if (i.kind === 'recommendation' && i.basis === 'outcome') {
      if (!known) {
        ev('insight_formed', `Kona's take — ${t}`, { kind: 'recommendation', basis: i.basis, topic: i.topic });
      } else if (adviceThisTurn && !alreadyAdapted.has(t)) {
        ev('recommendation_adapted', `Kona applied what it's learned to today's ${i.topic} advice — ${t}`, {
          from: t,
          topic: i.topic,
        });
      }
    }
  }

  return out;
}
