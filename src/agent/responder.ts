import type { ActualSession, PlannedSession, WeeklyPlan } from '../domain/types';
import type { FuelLog } from '../domain/types';
import type { FuelingCalculation, RecommendationInput, WeekAnalysis } from '../engine/index';
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

/** "Mon 8 Sep" from a YYYY-MM-DD date. */
function fmtDate(dateIso: string): string {
  const [y, m, day] = dateIso.split('-').map(Number) as [number, number, number];
  const d = new Date(y, m - 1, day);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function weekdayShort(dateIso: string): string {
  const [y, m, day] = dateIso.split('-').map(Number) as [number, number, number];
  return DAYS[new Date(y, m - 1, day).getDay()]!;
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

interface WeekPlanResult {
  weekly_plan: WeeklyPlan;
  sessions: PlannedSession[];
  rest_days: string[];
  analysis: WeekAnalysis;
}

interface UpdatePlanResult extends WeekPlanResult {
  updated: PlannedSession[];
  applied_fields: ('intensity' | 'duration_minutes' | 'distance_km')[];
}

function describeWeekSession(s: WeekAnalysis['days'][number]['sessions'][number]): string {
  const dist = s.distance_km ? `${s.distance_km} km ` : '';
  // Show a stated effort only. A defaulted "easy" (or an unstated long run) is
  // not asserted — Kona asks instead.
  const effort = s.needs_detail.includes('intensity') || s.is_long ? '' : `${s.intensity} `;
  let base = `${dist}${effort}${s.is_long ? 'long ' : ''}${s.sport}`.trim();
  const gaps: string[] = [];
  if (s.needs_detail.includes('intensity')) gaps.push('effort');
  if (s.needs_detail.includes('duration_or_distance')) gaps.push('distance/time');
  if (gaps.length) base += ` (${gaps.join(' & ')} not set)`;
  return base;
}

function weekDayRows(analysis: WeekAnalysis, restDays: string[]): string[] {
  const rows = [
    ...analysis.days.map((d) => ({
      date: d.date,
      text: `${d.weekday_label}: ${d.sessions.map(describeWeekSession).join(' + ')}${
        d.multi_session ? ' — double session' : ''
      }`,
    })),
    ...restDays.map((date) => ({ date, text: `${weekdayShort(date)}: rest` })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return rows.map((r) => `- ${r.text}`);
}

function weekEndIso(weekStart: string): string {
  const [wy, wm, wd] = weekStart.split('-').map(Number) as [number, number, number];
  const end = new Date(wy, wm - 1, wd + 6);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
}

function composeWeekPlan(results: ToolResult[]): string {
  const data = find(results, 'save_weekly_plan')?.data as WeekPlanResult | undefined;
  if (!data) return "I couldn't save that week — could you list the days again?";
  const { analysis, rest_days } = data;

  const sessionCount = analysis.days.reduce((n, d) => n + d.sessions.length, 0);
  const lines = [
    `Saved your week (${fmtDate(analysis.week_start)}–${fmtDate(weekEndIso(analysis.week_start))}): ${sessionCount} session${
      sessionCount === 1 ? '' : 's'
    } across ${analysis.days.length} day${analysis.days.length === 1 ? '' : 's'}.`,
    '',
    ...weekDayRows(analysis, rest_days),
  ];

  if (analysis.recommendation_inputs.length) {
    lines.push('');
    for (const rec of analysis.recommendation_inputs.slice(0, 3)) lines.push(rec.action);
  }

  if (analysis.open_questions.length) {
    lines.push('');
    lines.push("A few things I'd pin down so the fueling advice is right:");
    for (const q of analysis.open_questions.slice(0, 4)) lines.push(`- ${q.text}`);
  } else {
    lines.push('');
    lines.push("I've remembered this — tell me what actually happens each day and I'll compare against the plan.");
  }
  return lines.join('\n');
}

function composeClarifyPlanDetail(results: ToolResult[]): string {
  const all = results.filter((r) => r.tool === 'update_planned_sessions' && r.ok).map((r) => r.data as UpdatePlanResult);
  if (all.length === 0) return "I couldn't match that to a session in your plan — which day or sport did you mean?";
  const data = all[all.length - 1]!; // last call has the fully-updated analysis
  const { analysis, rest_days } = data;
  // Report only what each call actually changed — don't re-assert defaulted fields.
  const changed = all
    .flatMap((d) =>
      d.updated.map((s) => {
        const bits: string[] = [];
        if (d.applied_fields.includes('distance_km') && s.distance_km) bits.push(`${s.distance_km} km`);
        if (d.applied_fields.includes('duration_minutes') && s.duration_minutes) bits.push(`~${s.duration_minutes} min`);
        if (d.applied_fields.includes('intensity')) bits.push(s.intensity);
        return `${weekdayShort(s.start_at.slice(0, 10))} ${s.sport} → ${bits.join(', ') || 'updated'}`;
      }),
    )
    .join('; ');

  const lines = [`Updated: ${changed}.`, '', ...weekDayRows(analysis, rest_days)];

  if (analysis.recommendation_inputs.length) {
    lines.push('');
    for (const rec of analysis.recommendation_inputs.slice(0, 3)) lines.push(rec.action);
  }
  if (analysis.open_questions.length) {
    lines.push('');
    lines.push('Still open:');
    for (const q of analysis.open_questions.slice(0, 4)) lines.push(`- ${q.text}`);
  }
  return lines.join('\n');
}

export function composeResponse(req: ComposeRequest): string {
  switch (req.intent) {
    case 'plan_session':
      return composePlan(req.tool_results);
    case 'plan_week':
      return composeWeekPlan(req.tool_results);
    case 'clarify_plan_detail':
      return composeClarifyPlanDetail(req.tool_results);
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
