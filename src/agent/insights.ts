import type { ActualSession, FuelLog, PersistedMemory, RecoveryLog } from '../domain/types';

/**
 * The pattern layer. Turns the athlete's accumulated history into a small set of
 * plain-language observations — this is what makes Kona feel like it knows the
 * athlete rather than recalculating from scratch each turn.
 *
 * DETERMINISTIC and conservative by design (the foundation model may *phrase*
 * these, it does not invent them). Every observation carries an honest label:
 *
 *   FACT           — something the athlete literally reported / a plain count.
 *   PATTERN        — a regularity across several similar events.
 *   HYPOTHESIS     — a tentative guess at a cause. Never stated as certainty.
 *   RECOMMENDATION — an action that follows from a pattern.
 *
 * HYPOTHESIS is intentionally not detected here — a real one needs a plausible
 * single differing variable, which is premature with little data and risks
 * implying causation. Hypotheses are the model's job in conversation, guided by
 * the compose system prompt. The `kind` is kept for future use.
 *
 * PRODUCT-TRUTH DISCIPLINE (M22). `kind` says the grammatical form; `basis` says
 * what the claim is *grounded in*, and the two must not blur:
 *
 *   reported   — the athlete literally said it (a count of mentions/logs).
 *   repeated   — a thing has happened N times. FREQUENCY ONLY. Never an
 *                effectiveness claim — "you've done this 3 times" is not
 *                "this works".
 *   outcome    — repetition *plus* a consistent good/bad result signal
 *                (completed as planned AND felt good / no GI / no bonk, or the
 *                mirror image). Only `basis: 'outcome'` may say a setup is
 *                "working" or "repeatedly having problems", and even then it
 *                names no cause.
 *   adaptation — a *later* recommendation actually used earlier evidence. This
 *                basis is never produced here; it belongs to the activity log
 *                (`recommendation_adapted`), which only fires once a subsequent
 *                turn's advice has drawn on a standing recommendation insight.
 *
 * When results are mixed or thin, the honest output is "too early / not enough
 * to change anything on" — with NO recommendation — not a confident guess.
 */

export type InsightKind = 'fact' | 'pattern' | 'hypothesis' | 'recommendation';

/** What the claim is grounded in — see the PRODUCT-TRUTH DISCIPLINE note above. */
export type InsightBasis = 'reported' | 'repeated' | 'outcome' | 'adaptation';

export interface Insight {
  kind: InsightKind;
  basis: InsightBasis;
  /** Plain language, ready to show. */
  text: string;
  certainty: 'high' | 'moderate' | 'low';
  /** How many observations back it. */
  evidence_count: number;
  topic: 'training' | 'fuelling' | 'recovery' | 'preference';
  /** Most recent supporting date (YYYY-MM-DD), when relevant. */
  as_of?: string;
  /** Short human lines naming the observations behind it — "why Kona believes this". */
  evidence: string[];
}

export interface InsightInput {
  actualSessions: ActualSession[];
  recoveryLogs: RecoveryLog[];
  fuelLogs: FuelLog[];
  memories: PersistedMemory[];
}

const OFF_PLAN = new Set(['modified', 'skipped', 'stopped_early']);

const SYMPTOMS: { token: string; label: string; re: RegExp }[] = [
  { token: 'hip', label: 'hip', re: /\bhips?\b/i },
  { token: 'knee', label: 'knee', re: /\bknees?\b/i },
  { token: 'calf', label: 'calf', re: /\bcalves?\b|\bcalf\b/i },
  { token: 'hamstring', label: 'hamstring', re: /\bhamstrings?\b/i },
  { token: 'quad', label: 'quad', re: /\bquads?\b/i },
  { token: 'achilles', label: 'Achilles', re: /\bachilles\b/i },
  { token: 'ankle', label: 'ankle', re: /\bankles?\b/i },
  { token: 'foot', label: 'foot', re: /\bfeet\b|\bfoot\b/i },
  { token: 'shin', label: 'shin', re: /\bshins?\b|\bshin splints?\b/i },
  { token: 'back', label: 'back', re: /\b(lower )?backs?\b/i },
  { token: 'cramp', label: 'cramping', re: /\bcramp\w*\b/i },
  { token: 'gi', label: 'GI / stomach', re: /\b(gi|stomach|gut|nausea|nauseous|the runs)\b/i },
  { token: 'chafing', label: 'chafing', re: /\bchaf\w*\b/i },
  { token: 'blister', label: 'blisters', re: /\bblisters?\b/i },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateOf(iso: string): string {
  return iso.slice(0, 10);
}

/** "9 Sep" from a YYYY-MM-DD (or ISO) string. */
function human(iso: string): string {
  const [, m, d] = dateOf(iso).split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]}`;
}

function positiveFeel(text: string): boolean {
  return /\b(felt |feeling )?(great|good|strong|fresh|solid|easy|comfortable|no issues|nailed it|went well|felt fine)\b/i.test(
    text,
  );
}

/** Words the athlete uses when a session went badly — GI, bonk, "rough". Never a diagnosis. */
const TROUBLE_RE =
  /\b(gi|stomach|gut|nausea|nauseous|the runs|cramp\w*|bonk\w*|hit the wall|blew up|blow up|fell apart|struggl\w*|rough|awful|terrible|dizzy|light[- ]?headed|no energy|ran out of (?:gas|energy|steam))\b/i;

function describeSession(s: ActualSession): string {
  const dist = s.distance_km ? `${s.distance_km} km ` : '';
  const dur = !s.distance_km && s.duration_minutes ? `${s.duration_minutes} min ` : '';
  return `${human(s.start_at)} · ${dist}${dur}${s.intensity} ${s.sport}`.replace(/\s+/g, ' ').trim();
}

function snippet(text: string, max = 70): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function bySport(sessions: ActualSession[]): Map<string, ActualSession[]> {
  const m = new Map<string, ActualSession[]>();
  for (const s of sessions) (m.get(s.sport) ?? m.set(s.sport, []).get(s.sport)!).push(s);
  return m;
}

function recoveryIndex(logs: RecoveryLog[]): { bySession: Map<string, RecoveryLog>; byDate: Map<string, RecoveryLog> } {
  const bySession = new Map<string, RecoveryLog>();
  const byDate = new Map<string, RecoveryLog>();
  for (const r of logs) {
    if (r.session_id) bySession.set(r.session_id, r);
    byDate.set(dateOf(r.logged_at), r);
  }
  return { bySession, byDate };
}

type Outcome = 'positive' | 'negative' | null;

/**
 * How a session turned out, from evidence the athlete actually gave — the
 * session's own status plus a same-session / same-day recovery note. Returns
 * null when there's no outcome signal at all (which is the common case, and must
 * NOT be read as "fine").
 */
function sessionOutcome(
  s: ActualSession,
  idx: { bySession: Map<string, RecoveryLog>; byDate: Map<string, RecoveryLog> },
): Outcome {
  if (s.status === 'stopped_early' || s.status === 'skipped') return 'negative';
  if (s.reason && TROUBLE_RE.test(s.reason)) return 'negative';
  const rec = idx.bySession.get(s.id) ?? idx.byDate.get(dateOf(s.start_at));
  if (rec) {
    const hay = `${rec.free_text} ${(rec.reported_symptoms ?? []).join(' ')}`;
    if (rec.overall_severity === 'moderate' || rec.overall_severity === 'high') return 'negative';
    if (TROUBLE_RE.test(hay)) return 'negative';
    if (rec.overall_severity === 'none' || rec.overall_severity === 'low' || positiveFeel(hay)) return 'positive';
  }
  return null;
}

function heatFlag(s: ActualSession): boolean {
  const e = s.environment;
  return Boolean(e && ((e.temperature_c ?? 0) >= 24 || (e.humidity_percent ?? 0) >= 70));
}

/**
 * If the good sessions and the bad sessions split cleanly on ONE available
 * variable (fed/fasted, time of day, heat), return a short phrase for the
 * condition the bad ones share. No causal claim — just "these differed".
 */
function conditionSplit(sessions: ActualSession[], outcomes: Outcome[]): string | null {
  const neg = sessions.filter((_, i) => outcomes[i] === 'negative');
  const pos = sessions.filter((_, i) => outcomes[i] === 'positive');
  if (neg.length === 0 || pos.length === 0) return null;

  const vars: { label: (v: string) => string; of: (s: ActualSession) => string | undefined }[] = [
    { of: (s) => s.pre_fed_state && s.pre_fed_state !== 'unknown' ? s.pre_fed_state : undefined, label: (v) => (v === 'fasted' ? 'done fasted' : 'done fed') },
    { of: (s) => s.time_of_day, label: (v) => `in the ${v}` },
    { of: (s) => (heatFlag(s) ? 'hot' : s.environment ? 'cool' : undefined), label: (v) => (v === 'hot' ? 'in the heat' : 'in cool conditions') },
  ];
  for (const v of vars) {
    const negVals = new Set(neg.map(v.of).filter((x): x is string => Boolean(x)));
    const posVals = new Set(pos.map(v.of).filter((x): x is string => Boolean(x)));
    if (negVals.size !== 1) continue;
    if (negVals.size + posVals.size < 2) continue;
    const [only] = [...negVals];
    if (posVals.has(only!)) continue; // not a clean split
    if (neg.some((s) => v.of(s) === undefined)) continue; // every bad one must have the value
    return v.label(only!);
  }
  return null;
}

// --- detectors ------------------------------------------------------------

const OUTCOME_WINDOW = 5;
const MIN_FOR_OUTCOME = 3;

/**
 * Per-sport read of the recent window, kept strictly honest about the four
 * bases. Emits at most:
 *  - a FREQUENCY fact (basis: repeated) — "you've completed N as planned". Never
 *    an effectiveness claim.
 *  - THEN exactly one of, when there's an outcome signal:
 *      · working setup     — every recent one completed, ≥2/3 felt good, none bad
 *      · condition-dependent — good vs bad split cleanly on one variable
 *      · repeated trouble   — ≥2 of the window had problems the athlete flagged
 *      · mixed / inconclusive — both good and bad, no clean reason → withhold
 */
function sportReads(input: InsightInput): Insight[] {
  const idx = recoveryIndex(input.recoveryLogs);
  const out: Insight[] = [];

  for (const [sport, all] of bySport(input.actualSessions)) {
    const recent = [...all].sort((a, b) => b.start_at.localeCompare(a.start_at)).slice(0, OUTCOME_WINDOW);
    if (recent.length < MIN_FOR_OUTCOME) continue;
    const as_of = dateOf(recent[0]!.start_at);
    const evidence = recent.map(describeSession);
    const completedAll = recent.every((s) => s.status === 'completed');
    const outcomes = recent.map((s) => sessionOutcome(s, idx));
    const pos = outcomes.filter((o) => o === 'positive').length;
    const neg = outcomes.filter((o) => o === 'negative').length;

    // (1) Frequency — a plain count of completions. FREQUENCY ONLY.
    if (completedAll) {
      out.push({
        kind: 'fact',
        basis: 'repeated',
        text: `You've completed your last ${recent.length} ${sport} sessions as planned.`,
        certainty: 'high',
        evidence_count: recent.length,
        topic: 'training',
        as_of,
        evidence,
      });
    }

    const outcomeEvidence = recent.map((s, i) => `${describeSession(s)} — ${outcomes[i] ?? 'no outcome noted'}`);

    // (2) Earned "working setup" — completion AND a consistent good result.
    if (completedAll && neg === 0 && pos >= Math.ceil(recent.length * (2 / 3))) {
      out.push({
        kind: 'pattern',
        basis: 'outcome',
        text: `Your ${sport} sessions have been going well — completed as planned, and you've felt good afterwards (${pos} of ${recent.length}).`,
        certainty: 'moderate',
        evidence_count: pos,
        topic: 'training',
        as_of,
        evidence: outcomeEvidence,
      });
      out.push({
        kind: 'recommendation',
        basis: 'outcome',
        text: `What you're doing for ${sport} looks like it's working — worth keeping it steady rather than changing several things at once.`,
        certainty: 'moderate',
        evidence_count: pos,
        topic: 'training',
        as_of,
        evidence: outcomeEvidence,
      });
      continue;
    }

    // (3) Condition-dependent — good vs bad split cleanly on one variable.
    const split = neg >= 1 && pos >= 1 ? conditionSplit(recent, outcomes) : null;
    if (split) {
      out.push({
        kind: 'pattern',
        basis: 'outcome',
        text: `Your ${sport} sessions have gone differently depending on conditions — the ones that went badly were all ${split}, the ones that went fine weren't. Might be worth planning those separately. Kona isn't pinning down a cause.`,
        certainty: 'low',
        evidence_count: neg + pos,
        topic: 'training',
        as_of,
        evidence: outcomeEvidence,
      });
      continue;
    }

    // (4) Repeated trouble — the window is dominated by sessions that went
    //     badly (at most one went ok). Anything more balanced is "mixed" (5).
    if (neg >= 2 && pos <= 1) {
      out.push({
        kind: 'fact',
        basis: 'outcome',
        text: `Your last ${recent.length} ${sport} sessions have repeatedly run into problems you flagged — ${neg} of ${recent.length}. Worth a look at what's different between the good and bad ones; Kona doesn't diagnose.`,
        certainty: 'high',
        evidence_count: neg,
        topic: 'training',
        as_of,
        evidence: outcomeEvidence,
      });
      continue;
    }

    // (5) Mixed with no clean reason — say so, and change nothing on it.
    if (pos >= 1 && neg >= 1) {
      out.push({
        kind: 'fact',
        basis: 'outcome',
        text: `Results for ${sport} have been mixed lately — some went well, some didn't, and Kona can't see a clear reason yet. Not enough to change anything on.`,
        certainty: 'low',
        evidence_count: pos + neg,
        topic: 'training',
        as_of,
        evidence: outcomeEvidence,
      });
    }
  }
  return out;
}

/** A single session with an outcome note — resist over-reading one data point. */
function unprovenSetup(input: InsightInput): Insight[] {
  const idx = recoveryIndex(input.recoveryLogs);
  let best: { sport: string; s: ActualSession } | undefined;
  for (const [sport, all] of bySport(input.actualSessions)) {
    if (all.length !== 1) continue;
    const s = all[0]!;
    if (sessionOutcome(s, idx) === null) continue;
    if (!best || s.start_at > best.s.start_at) best = { sport, s };
  }
  if (!best) return [];
  return [
    {
      kind: 'fact',
      basis: 'repeated',
      text: `You've done ${best.sport} once so far — one session isn't enough for Kona to tell you what's reliably working.`,
      certainty: 'low',
      evidence_count: 1,
      topic: 'training',
      as_of: dateOf(best.s.start_at),
      evidence: [describeSession(best.s)],
    },
  ];
}

/** A body part / symptom the athlete has mentioned more than once. FACT. */
function recurringSymptom(input: InsightInput): Insight[] {
  type Hit = { date: string; severe: boolean; quote: string };
  const hits = new Map<string, Hit[]>();

  const record = (label: string, date: string, severe: boolean, quote: string) => {
    (hits.get(label) ?? hits.set(label, []).get(label)!).push({ date, severe, quote });
  };

  for (const r of input.recoveryLogs) {
    const date = dateOf(r.logged_at);
    const severe = r.overall_severity === 'moderate' || r.overall_severity === 'high';
    const hay = `${r.free_text} ${(r.reported_symptoms ?? []).join(' ')}`;
    const quote = r.free_text || (r.reported_symptoms ?? []).join(', ');
    for (const s of SYMPTOMS) if (s.re.test(hay)) record(s.label, date, severe, quote);
  }
  for (const a of input.actualSessions) {
    if (!a.reason) continue;
    for (const s of SYMPTOMS) if (s.re.test(a.reason)) record(s.label, dateOf(a.start_at), true, a.reason);
  }

  const out: Insight[] = [];
  for (const [label, list] of hits) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const last = sorted[sorted.length - 1]!.date;
    const evidence = sorted.map(
      (h) => `${human(h.date)} · "${snippet(h.quote)}"${h.severe ? ' (felt significant)' : ''}`,
    );
    out.push({
      kind: 'fact',
      basis: 'reported',
      text: `You've noted ${label} ${list.length} times — most recently ${human(last)}. Kona doesn't diagnose; this is just a flag.`,
      certainty: 'high',
      evidence_count: list.length,
      topic: 'recovery',
      as_of: last,
      evidence,
    });
    if (list.some((h) => h.severe)) {
      out.push({
        kind: 'recommendation',
        basis: 'reported',
        text: `${label} has come up more than once and felt significant at least once — if it keeps recurring or worsens, get it assessed.`,
        certainty: 'moderate',
        evidence_count: list.length,
        topic: 'recovery',
        as_of: last,
        evidence,
      });
    }
  }
  return out;
}

/** Recent sessions repeatedly not going to plan. FACT (no cause implied). */
function offPlanRun(input: InsightInput): Insight[] {
  const recent = [...input.actualSessions]
    .sort((a, b) => b.start_at.localeCompare(a.start_at))
    .slice(0, 6);
  if (recent.length < 4) return [];
  const off = recent.filter((s) => OFF_PLAN.has(s.status));
  if (off.length < 3) return [];
  return [
    {
      kind: 'fact',
      basis: 'reported',
      text: `${off.length} of your last ${recent.length} sessions didn't go as planned. Could be many things — worth keeping an eye on load and recovery.`,
      certainty: 'high',
      evidence_count: off.length,
      topic: 'training',
      as_of: dateOf(recent[0]!.start_at),
      evidence: off.map((s) => `${describeSession(s)} — ${s.status.replace('_', ' ')}${s.reason ? ` (${snippet(s.reason, 40)})` : ''}`),
    },
  ];
}

/** A fuel item that shows up again and again. FACT. */
function stapleFuel(input: InsightInput): Insight[] {
  const tally = new Map<string, { n: number; last: string; dates: string[] }>();
  for (const log of input.fuelLogs) {
    const date = dateOf(log.logged_at);
    for (const item of log.items) {
      const key = item.description
        .toLowerCase()
        .replace(/^\s*(\d+|a|an|one|two|three|four|five|six)\s+/i, '')
        .replace(/[.!?]+$/, '')
        .replace(/(\w)s$/, '$1') // fold a trailing plural: "gels" -> "gel"
        .trim();
      if (!key) continue;
      const cur = tally.get(key) ?? { n: 0, last: date, dates: [] };
      cur.n += 1;
      cur.dates.push(date);
      if (date > cur.last) cur.last = date;
      tally.set(key, cur);
    }
  }
  return [...tally.entries()]
    .filter(([, v]) => v.n >= 3)
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 2)
    .map(([desc, v]) => ({
      kind: 'fact' as const,
      basis: 'repeated' as const,
      text: `You've logged ${desc} ${v.n} times — looks like a staple in your fuelling.`,
      certainty: 'moderate' as const,
      evidence_count: v.n,
      topic: 'fuelling' as const,
      as_of: v.last,
      evidence: [`logged on ${[...new Set(v.dates)].sort().map(human).join(', ')}`],
    }));
}

/** Early thirst / running low on fluid, mentioned more than once. FACT. */
function hydrationFlag(input: InsightInput): Insight[] {
  const re = /\b(thirst\w*|dehydrat\w*|ran out of (?:water|fluid)|out of (?:water|fluid)|parched|bonk\w*)\b/i;
  const hits = input.recoveryLogs
    .filter((r) => re.test(r.free_text))
    .map((r) => ({ date: dateOf(r.logged_at), quote: r.free_text }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (hits.length < 2) return [];
  const last = hits[hits.length - 1]!.date;
  return [
    {
      kind: 'fact',
      basis: 'reported',
      text: `You've flagged early thirst or running low on fluid ${hits.length} times — most recently ${human(last)}.`,
      certainty: 'high',
      evidence_count: hits.length,
      topic: 'fuelling',
      as_of: last,
      evidence: hits.map((h) => `${human(h.date)} · "${snippet(h.quote)}"`),
    },
  ];
}

// --- entry point --------------------------------------------------------

const KIND_RANK: Record<InsightKind, number> = { pattern: 0, fact: 1, recommendation: 2, hypothesis: 3 };

export function deriveInsights(input: InsightInput): Insight[] {
  const all = [
    ...sportReads(input),
    ...unprovenSetup(input),
    ...recurringSymptom(input),
    ...hydrationFlag(input),
    ...offPlanRun(input),
    ...stapleFuel(input),
  ];
  return all
    .sort(
      (a, b) =>
        KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
        b.evidence_count - a.evidence_count ||
        (b.as_of ?? '').localeCompare(a.as_of ?? ''),
    )
    .slice(0, 8);
}
