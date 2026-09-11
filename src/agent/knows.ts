import type { ActivityEvent, ActualSession, PersistedMemory, Profile, RecoveryLog } from '../domain/types';
import { deriveInsights, type Insight } from './insights';

/**
 * The "What Kona knows about you" payload — evidence of learning, not a dump of
 * database fields. Four honest strands:
 *   - what Kona has *worked out* (the deterministic insight/pattern layer),
 *   - what the athlete has *told* Kona (goal + durable memories),
 *   - what's *on record* recently (recent sessions + how they felt),
 *   - *how Kona's been learning* — the activity timeline (told → remembered →
 *     became relevant → advice changed).
 * When there's nothing real to show, `has_anything` is false and the UI shows an
 * honest empty state — never invented content.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function human(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]}`;
}

function snippet(text: string, max = 56): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Where an insight sits in the learning loop, for the athlete's own benefit
 * (M23.2 — "told / watching / acting on"). Derived from the existing
 * `certainty` field, not a new dimension: nothing below "moderate" is confident
 * enough to say Kona is leaning on it yet.
 */
export type InsightLearningTier = 'watching' | 'acting_on';

function learningTier(i: Insight): InsightLearningTier {
  return i.certainty === 'low' ? 'watching' : 'acting_on';
}

export interface KnowsInsight extends Insight {
  tier: InsightLearningTier;
}

export interface KnowsToldLine {
  label: string;
  value: string;
}

export interface KnowsRecentSession {
  date: string;
  /** "8 km easy run" */
  text: string;
  /** short phrase from a same-day recovery note, if any */
  felt?: string;
  /** only when the session didn't go to plan */
  status?: string;
}

export interface KnowsTimelineEntry {
  date: string;
  type: ActivityEvent['type'];
  summary: string;
  /** true for Kona-side steps (learned / spotted / adapted), false for "you did/told". */
  by_kona: boolean;
}

export interface KnowsView {
  has_anything: boolean;
  insights: KnowsInsight[];
  told: KnowsToldLine[];
  recent: KnowsRecentSession[];
  timeline: KnowsTimelineEntry[];
}

const KONA_SIDE = new Set<ActivityEvent['type']>(['fact_learned', 'insight_formed', 'recommendation_adapted']);
const TIMELINE_HIDE = new Set<ActivityEvent['type']>(['plan_saved', 'plan_updated']);

const MEM_LABEL: Record<string, string> = {
  next_race: 'Next race',
  typical_week: 'Typical week',
};

function memLabel(key: string): string {
  if (MEM_LABEL[key]) return MEM_LABEL[key]!;
  if (/(^prefers?_|preference)/i.test(key)) return 'Preference';
  if (/^(only_|no_|cant_|cannot_|constraint)/i.test(key)) return 'Constraint';
  if (/fuel|setup|breakfast/i.test(key)) return 'Go-to setup';
  return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function recentSessions(actuals: ActualSession[], recovery: RecoveryLog[]): KnowsRecentSession[] {
  const byDate = new Map<string, RecoveryLog>();
  const bySession = new Map<string, RecoveryLog>();
  for (const r of recovery) {
    byDate.set(r.logged_at.slice(0, 10), r);
    if (r.session_id) bySession.set(r.session_id, r);
  }
  return [...actuals]
    .sort((a, b) => b.start_at.localeCompare(a.start_at))
    .slice(0, 6)
    .map((s) => {
      const dist = s.distance_km ? `${s.distance_km} km ` : '';
      const dur = !s.distance_km && s.duration_minutes ? `${s.duration_minutes} min ` : '';
      const rec = bySession.get(s.id) ?? byDate.get(s.start_at.slice(0, 10));
      return {
        date: human(s.start_at),
        text: `${dist}${dur}${s.intensity} ${s.sport}`.replace(/\s+/g, ' ').trim(),
        ...(rec?.free_text ? { felt: snippet(rec.free_text) } : {}),
        ...(s.status !== 'completed' ? { status: s.status.replace('_', ' ') } : {}),
      };
    });
}

export function buildKnows(input: {
  profile?: Profile;
  memories: PersistedMemory[];
  actualSessions: ActualSession[];
  recoveryLogs: RecoveryLog[];
  fuelLogs: Parameters<typeof deriveInsights>[0]['fuelLogs'];
  events?: ActivityEvent[];
}): KnowsView {
  const insights: KnowsInsight[] = deriveInsights({
    actualSessions: input.actualSessions,
    recoveryLogs: input.recoveryLogs,
    fuelLogs: input.fuelLogs,
    memories: input.memories,
  }).map((i) => ({ ...i, tier: learningTier(i) }));

  const told: KnowsToldLine[] = [];
  if (input.profile?.goal?.text) told.push({ label: 'Training for', value: input.profile.goal.text });
  for (const m of input.memories) {
    if (m.key === 'goal') continue; // covered by profile.goal
    told.push({ label: memLabel(m.key), value: m.value });
  }

  const recent = recentSessions(input.actualSessions, input.recoveryLogs);

  const timeline: KnowsTimelineEntry[] = (input.events ?? [])
    .filter((e) => !TIMELINE_HIDE.has(e.type))
    .slice(0, 14)
    .map((e) => ({
      date: human(e.at),
      type: e.type,
      summary: e.summary,
      by_kona: KONA_SIDE.has(e.type),
    }));

  return {
    has_anything: insights.length > 0 || told.length > 0 || recent.length > 0 || timeline.length > 0,
    insights,
    told,
    recent,
    timeline,
  };
}
