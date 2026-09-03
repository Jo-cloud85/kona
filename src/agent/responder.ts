import type { ActualSession, PlannedSession } from '../domain/types';
import type { FuelLog } from '../domain/types';
import type { FuelingCalculation, RecommendationInput } from '../engine/index';
import { getProduct } from '../data/products';
import type { ComposeRequest, ToolResult } from './llm-client';

/**
 * Deterministic natural-language composer. Turns structured tool results into a
 * concise reply in Kona's voice (AGENT_SPEC.md "Response structure").
 *
 * Every number it prints comes from a `calculate_fueling_targets` result or a
 * known product label — never invented here.
 */

const STATUS_TEXT: Record<ActualSession['status'], string> = {
  completed: 'completed',
  modified: 'modified',
  skipped: 'skipped',
  stopped_early: 'stopped early',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  let hh = d.getHours();
  const ampm = hh >= 12 ? 'pm' : 'am';
  hh = hh % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${hh}:${mm} ${ampm}`;
}

function find(results: ToolResult[], tool: string): ToolResult | undefined {
  return results.find((r) => r.tool === tool);
}

function priorityRank(p: RecommendationInput['priority']): number {
  return p === 'high' ? 0 : p === 'medium' ? 1 : 2;
}

function topRecommendations(calc: FuelingCalculation, limit: number): RecommendationInput[] {
  return [...calc.recommendation_inputs].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)).slice(0, limit);
}

function caveat(calc: FuelingCalculation): string {
  const bits: string[] = [];
  if (calc.session_classification.duration_estimated) {
    bits.push(`I estimated ~${calc.session_classification.resolved_duration_minutes} min for it`);
  }
  bits.push(`these are starting ranges, not exact targets (confidence: ${calc.confidence})`);
  return bits.join('; ') + '.';
}

// --- per-intent composers -------------------------------------------------

function composePlan(results: ToolResult[]): string {
  const planned = find(results, 'save_planned_session')?.data as PlannedSession | undefined;
  const calc = find(results, 'calculate_fueling_targets')?.data as FuelingCalculation | undefined;
  if (!planned) return "I couldn't save that plan — could you repeat the session details?";

  const dist = planned.distance_km ? `${planned.distance_km} km ` : '';
  const lines = [`Saved as planned: ${dist}${planned.intensity} ${planned.sport}, ${fmtDateTime(planned.start_at)}.`];

  if (calc) {
    const recs = topRecommendations(calc, 3);
    if (recs.length) {
      lines.push('');
      for (const r of recs) lines.push(`- ${r.action}`);
    }
    lines.push('');
    lines.push(caveat(calc));
  }
  return lines.join('\n');
}

function bodyPartFromReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  const m = /\b(left hip|right hip|hip|knee|calf|hamstring|back|quad|achilles|ankle|foot|shin)\b/i.exec(reason);
  return m ? m[1]!.toLowerCase() : undefined;
}

function composeActual(req: ComposeRequest): string {
  const results = req.tool_results;
  const actual = find(results, 'save_actual_session')?.data as ActualSession | undefined;
  const calc = find(results, 'calculate_fueling_targets')?.data as FuelingCalculation | undefined;
  if (!actual) return "I couldn't log that session — how far did you actually go, and why did it change?";

  const plan = req.context.current_plan;
  const planKept =
    plan && plan.distance_km && plan.id === actual.planned_session_id
      ? `Kept your planned ${plan.distance_km} km. `
      : '';
  const actualDist = actual.distance_km ? `${actual.distance_km} km` : 'the session';
  const reasonText = actual.reason ? `, reason: ${actual.reason}` : '';
  const lines = [`${planKept}Logged the actual as ${actualDist} (${STATUS_TEXT[actual.status]})${reasonText}.`];

  const safety = calc?.recommendation_inputs.find((r) => r.category === 'safety');
  if (safety) {
    lines.push('');
    lines.push(safety.action);
    const part = bodyPartFromReason(actual.reason);
    if (part) lines.push(`Is the ${part} still bothering you now?`);
  } else {
    const recovery = calc?.recommendation_inputs.find((r) => r.category === 'recovery');
    if (recovery) {
      lines.push('');
      lines.push(recovery.action);
    }
  }
  return lines.join('\n');
}

function composeFuel(results: ToolResult[]): string {
  const log = find(results, 'log_fuel_intake')?.data as FuelLog | undefined;
  if (!log || log.items.length === 0) return "I didn't catch what you had — could you list it again?";

  const lines = ['Logged:'];
  for (const item of log.items) {
    const qty = item.quantity && item.quantity !== 1 ? `${item.quantity}× ` : '';
    const label = (item.product_id && getProduct(item.product_id)?.name) || item.description.replace(/[.!]+$/, '');
    const knownBits: string[] = [];
    if (typeof item.fluid_ml === 'number') knownBits.push(`${item.fluid_ml} ml fluid`);
    if (typeof item.carbohydrate_g === 'number') knownBits.push(`${item.carbohydrate_g} g carb`);
    if (typeof item.sodium_mg === 'number') knownBits.push(`${item.sodium_mg} mg sodium`);
    if (typeof item.protein_g === 'number') knownBits.push(`${item.protein_g} g protein`);

    if (item.certainty === 'known' && knownBits.length) {
      lines.push(`- ${qty}${label} — ${knownBits.join(', ')} (known).`);
    } else if (item.product_id) {
      lines.push(`- ${qty}${label} — quantity recorded; nutrition not on file, so I won't guess the numbers.`);
    } else {
      lines.push(`- ${qty}${label} — recorded as you described (treated as an estimate, not exact).`);
    }
  }
  return lines.join('\n');
}

function composeRecovery(req: ComposeRequest): string {
  const results = req.tool_results;
  const saved = find(results, 'save_recovery')?.ok;
  if (!saved) return "I couldn't save that check-in — how are you feeling after the session?";

  const last = req.context.last_actual_session;
  const painReason = last && (last.status === 'stopped_early' || last.status === 'modified') ? last.reason : undefined;
  const part = bodyPartFromReason(painReason);

  const text = req.message.toLowerCase();
  let reflection: string;
  if (/\b(fine|good|great|fresh|no issues|all good)\b/.test(text) && !/\btired|sore\b/.test(text)) {
    reflection = "sounds like you're recovering well.";
  } else if (/\b(limping|can'?t walk|severe|worst)\b/.test(text)) {
    reflection = 'that sounds rough — worth keeping an eye on.';
  } else if (/\b(really|very|super)\s+(sore|tired)|bad|badly|terrible|rough|wrecked\b/.test(text)) {
    reflection = 'sounds like that one took a lot out of you.';
  } else {
    reflection = 'a bit of tiredness but nothing alarming.';
  }

  const lines = [`Thanks — ${reflection}`];
  lines.push('');
  if (part) {
    lines.push(
      `Since the ${part} cut your last run short, I'd keep the next session easy and short — or swap in an easy swim or bike — and see how it responds. If it's still sore, painful to load, or not improving, get it checked before pushing on.`,
    );
    lines.push(`How's the ${part} today?`);
  } else {
    lines.push(
      "If your next session is easy, you're likely fine to go as planned. If it's a hard or long one, another easy day first wouldn't hurt.",
    );
  }
  return lines.join('\n');
}

export function composeResponse(req: ComposeRequest): string {
  switch (req.intent) {
    case 'plan_session':
      return composePlan(req.tool_results);
    case 'log_actual':
      return composeActual(req);
    case 'log_fuel':
      return composeFuel(req.tool_results);
    case 'recovery_check_in':
      return composeRecovery(req);
    default:
      return "Tell me a bit more and I'll help — a planned session, what you actually did, what you ate, or how recovery feels.";
  }
}
