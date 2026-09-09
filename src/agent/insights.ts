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
 */

export type InsightKind = 'fact' | 'pattern' | 'hypothesis' | 'recommendation';

export interface Insight {
  kind: InsightKind;
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
  return /\b(felt |feeling )?(great|good|strong|fresh|solid|easy|comfortable|no issues|nailed it)\b/i.test(text);
}

function describeSession(s: ActualSession): string {
  const dist = s.distance_km ? `${s.distance_km} km ` : '';
  const dur = !s.distance_km && s.duration_minutes ? `${s.duration_minutes} min ` : '';
  return `${human(s.start_at)} · ${dist}${dur}${s.intensity} ${s.sport}`.replace(/\s+/g, ' ').trim();
}

function snippet(text: string, max = 70): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// --- detectors ------------------------------------------------------------

/** A per-sport routine that keeps going to plan. PATTERN (+ RECOMMENDATION). */
function workingSetup(input: InsightInput): Insight[] {
  const bySport = new Map<string, ActualSession[]>();
  for (const s of input.actualSessions) {
    (bySport.get(s.sport) ?? bySport.set(s.sport, []).get(s.sport)!).push(s);
  }
  const out: Insight[] = [];
  for (const [sport, all] of bySport) {
    const recent = [...all].sort((a, b) => b.start_at.localeCompare(a.start_at)).slice(0, 5);
    if (recent.length < 3) continue;
    if (!recent.every((s) => s.status === 'completed')) continue;

    const dates = new Set(recent.map((s) => dateOf(s.start_at)));
    const feltGood = input.recoveryLogs.some(
      (r) =>
        (dates.has(dateOf(r.logged_at)) || recent.some((s) => s.id === r.session_id)) &&
        (r.overall_severity === 'none' || r.overall_severity === 'low' || positiveFeel(r.free_text)),
    );

    const evidence = recent.map(describeSession);
    const as_of = dateOf(recent[0]!.start_at);
    out.push({
      kind: 'pattern',
      text: feltGood
        ? `Your last ${recent.length} ${sport} sessions all went to plan and you've felt good after them.`
        : `Your last ${recent.length} ${sport} sessions all went to plan.`,
      certainty: 'moderate',
      evidence_count: recent.length,
      topic: 'training',
      as_of,
      evidence,
    });
    out.push({
      kind: 'recommendation',
      text: `Your ${sport} routine is working — I'd keep it rather than change several things at once.`,
      certainty: 'moderate',
      evidence_count: recent.length,
      topic: 'training',
      as_of,
      evidence,
    });
  }
  return out;
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
      text: `You've logged ${desc} ${v.n} times — looks like a staple in your fuelling.`,
      certainty: 'moderate' as const,
      evidence_count: v.n,
      topic: 'fuelling' as const,
      as_of: v.last,
      evidence: [`logged on ${[...new Set(v.dates)].sort().map(human).join(', ')}`],
    }));
}

// --- entry point --------------------------------------------------------

const KIND_RANK: Record<InsightKind, number> = { pattern: 0, fact: 1, recommendation: 2, hypothesis: 3 };

export function deriveInsights(input: InsightInput): Insight[] {
  const all = [
    ...workingSetup(input),
    ...recurringSymptom(input),
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
