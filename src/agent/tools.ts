import type { Intensity, Sport } from '../domain/types';
import type { Repository } from '../data/repository';
import { getProduct, resolveProductByPhrase } from '../data/products';
import { newId } from '../data/ids';
import {
  analyzeWeek,
  calculateFuelingTargets,
  type CalculateInput,
  type WeekSessionInput,
} from '../engine/index';
import type { ToolSchema } from './llm-client';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** YYYY-MM-DD of the Monday of the week containing `d`. */
function mondayOf(d: Date): string {
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  local.setDate(local.getDate() - ((local.getDay() + 6) % 7));
  return `${local.getFullYear()}-${pad2(local.getMonth() + 1)}-${pad2(local.getDate())}`;
}

/** Local date (YYYY-MM-DD) for a 0=Mon..6=Sun offset from a Monday week_start. */
function dateFromWeekStart(weekStart: string, dayIndex: number): string {
  const [y, m, day] = weekStart.split('-').map(Number) as [number, number, number];
  const d = new Date(y, m - 1, day + dayIndex);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Deterministic default start time per same-day sequence position. */
const SEQUENCE_TIMES = ['07:00', '17:00', '18:30', '20:00'];

export interface ToolContext {
  repo: Repository;
  userId: string;
}

export interface ToolDefinition {
  description: string;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

class ToolError extends Error {}

// --- tiny arg helpers -------------------------------------------------------

function str(args: Record<string, unknown>, key: string, required = true): string | undefined {
  const v = args[key];
  if (v == null || v === '') {
    if (required) throw new ToolError(`Missing required argument: ${key}`);
    return undefined;
  }
  if (typeof v !== 'string') throw new ToolError(`Argument ${key} must be a string`);
  return v;
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (v == null) return undefined;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || Number.isNaN(n)) throw new ToolError(`Argument ${key} must be a number`);
  return n;
}

const SPORTS: Sport[] = ['running', 'cycling', 'swimming', 'gym', 'hyrox', 'triathlon', 'other'];
const INTENSITIES: Intensity[] = ['easy', 'moderate', 'hard', 'race'];

function sport(args: Record<string, unknown>, key: string, required = true): Sport | undefined {
  const v = str(args, key, required);
  if (v === undefined) return undefined;
  if (!SPORTS.includes(v as Sport)) throw new ToolError(`Unknown sport: ${v}`);
  return v as Sport;
}

function intensity(args: Record<string, unknown>, key: string): Intensity | undefined {
  const v = str(args, key, false);
  if (v === undefined) return undefined;
  if (!INTENSITIES.includes(v as Intensity)) throw new ToolError(`Unknown intensity: ${v}`);
  return v as Intensity;
}

// --- tools ----------------------------------------------------------------

export const TOOLS: Record<string, ToolDefinition> = {
  get_user_profile: {
    description: 'Return the stored athlete profile (weight, usual bottle, sports, measured sweat data).',
    async run(_args, ctx) {
      const profile = await ctx.repo.getProfile(ctx.userId);
      if (!profile) throw new ToolError('No profile on file for this user');
      return profile;
    },
  },

  save_planned_session: {
    description: 'Persist a planned (intended) training session. Never overwrites an actual session.',
    async run(args, ctx) {
      return ctx.repo.savePlannedSession({
        user_id: ctx.userId,
        sport: sport(args, 'sport')!,
        start_at: str(args, 'start_at')!,
        distance_km: num(args, 'distance_km'),
        duration_minutes: num(args, 'duration_minutes'),
        intensity: intensity(args, 'intensity') ?? 'easy',
        environment: (args.environment as CalculateInput['session']['environment']) ?? undefined,
        notes: str(args, 'notes', false),
      });
    },
  },

  save_weekly_plan: {
    description:
      'Persist a whole week of planned sessions (linked as normal planned sessions), then return an analysis flagging double-session and longer/harder days with day-before preparation advice. Do NOT also call calculate_fueling_targets.',
    async run(args, ctx) {
      const weekStart = str(args, 'week_start', false) ?? mondayOf(new Date());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new ToolError('week_start must be YYYY-MM-DD');

      const rawDays = Array.isArray(args.days) ? (args.days as Record<string, unknown>[]) : [];
      if (rawDays.length === 0) throw new ToolError('save_weekly_plan needs a non-empty days array');
      if (rawDays.length > 7) throw new ToolError('a week has at most 7 days');

      const restDays: string[] = [];
      type DayPlan = { date: string; sessions: Record<string, unknown>[] };
      const dayPlans: DayPlan[] = [];

      for (const raw of rawDays) {
        const dayIndex = num(raw, 'day_index');
        const date =
          str(raw, 'date', false) ??
          (typeof dayIndex === 'number' ? dateFromWeekStart(weekStart, dayIndex) : undefined);
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw new ToolError('each day needs a date (YYYY-MM-DD) or a day_index 0-6 (0 = Monday)');
        }
        const sessions = Array.isArray(raw.sessions) ? (raw.sessions as Record<string, unknown>[]) : [];
        if (raw.rest === true || sessions.length === 0) {
          restDays.push(date);
          continue;
        }
        if (sessions.length > 4) throw new ToolError('at most 4 sessions per day');
        dayPlans.push({ date, sessions });
      }

      const weeklyPlan = await ctx.repo.saveWeeklyPlan({
        user_id: ctx.userId,
        week_start: weekStart,
        source_text: str(args, 'source_text', false),
        rest_days: restDays,
      });

      const analysisSessions: WeekSessionInput[] = [];
      const saved = [];
      for (const day of dayPlans) {
        const groupId = day.sessions.length > 1 ? newId('grp') : undefined;
        for (let i = 0; i < day.sessions.length; i++) {
          const s = day.sessions[i]!;
          const sport_ = sport(s, 'sport')!;
          const intensity_ = intensity(s, 'intensity') ?? 'easy';
          const start_at = `${day.date}T${SEQUENCE_TIMES[Math.min(i, SEQUENCE_TIMES.length - 1)]}:00`;
          const distance_km = num(s, 'distance_km');
          const duration_minutes = num(s, 'duration_minutes');
          const isLong = s.is_long === true;

          saved.push(
            await ctx.repo.savePlannedSession({
              user_id: ctx.userId,
              sport: sport_,
              start_at,
              distance_km,
              duration_minutes,
              intensity: intensity_,
              session_group_id: groupId,
              sequence_index: day.sessions.length > 1 ? i : undefined,
              weekly_plan_id: weeklyPlan.id,
              notes: isLong ? 'long session' : undefined,
            }),
          );
          analysisSessions.push({
            sport: sport_,
            intensity: intensity_,
            start_at,
            distance_km,
            duration_minutes,
            is_long: isLong,
          });
        }
      }

      const profile = await ctx.repo.getProfile(ctx.userId);
      const analysis = analyzeWeek({
        week_start: weekStart,
        sessions: analysisSessions,
        rest_days: restDays,
        profile: {
          body_weight_kg: profile?.body_weight_kg ?? 0,
          usual_bottle_ml: profile?.usual_bottle_ml,
          known_sweat_data: profile?.known_sweat_data,
        },
      });

      return { weekly_plan: weeklyPlan, sessions: saved, rest_days: restDays, analysis };
    },
  },

  get_weekly_plan: {
    description: 'Return a saved weekly plan (its sessions + the same analysis) for a given week_start, or the most recent week.',
    async run(args, ctx) {
      const weekStart = str(args, 'week_start', false);
      const plan = weekStart
        ? await ctx.repo.getWeeklyPlan(ctx.userId, weekStart)
        : (await ctx.repo.listWeeklyPlans(ctx.userId)).at(-1);
      if (!plan) throw new ToolError('No weekly plan on file for that week');

      const sessions = await ctx.repo.listPlannedSessionsForWeeklyPlan(plan.id);
      const profile = await ctx.repo.getProfile(ctx.userId);
      const analysis = analyzeWeek({
        week_start: plan.week_start,
        rest_days: plan.rest_days,
        sessions: sessions.map((s) => ({
          sport: s.sport,
          intensity: s.intensity,
          start_at: s.start_at,
          distance_km: s.distance_km,
          duration_minutes: s.duration_minutes,
          is_long: s.notes === 'long session',
        })),
        profile: {
          body_weight_kg: profile?.body_weight_kg ?? 0,
          usual_bottle_ml: profile?.usual_bottle_ml,
          known_sweat_data: profile?.known_sweat_data,
        },
      });
      return { weekly_plan: plan, sessions, rest_days: plan.rest_days, analysis };
    },
  },

  save_actual_session: {
    description:
      'Persist what actually happened as a SEPARATE record, linked to the plan. Stores the reason apart from the session.',
    async run(args, ctx) {
      const status = str(args, 'status')! as 'completed' | 'modified' | 'skipped' | 'stopped_early';
      let plannedId = str(args, 'planned_session_id', false);
      let plan = plannedId ? await ctx.repo.getPlannedSession(plannedId) : undefined;

      const linkDate = str(args, 'link_to_plan_date', false);
      if (!plan && linkDate) {
        plan = await ctx.repo.findPlannedSessionForDate(
          ctx.userId,
          linkDate,
          sport(args, 'sport', false),
        );
        plannedId = plan?.id;
      }

      const resolvedSport = sport(args, 'sport', false) ?? plan?.sport;
      if (!resolvedSport) throw new ToolError('Cannot save actual session: no sport given and no plan to inherit from');

      return ctx.repo.saveActualSession({
        user_id: ctx.userId,
        sport: resolvedSport,
        start_at: str(args, 'start_at', false) ?? plan?.start_at ?? new Date().toISOString(),
        distance_km: num(args, 'distance_km'),
        duration_minutes: num(args, 'duration_minutes'),
        intensity: intensity(args, 'intensity') ?? plan?.intensity ?? 'easy',
        planned_session_id: plannedId,
        status,
        reason: str(args, 'reason', false),
      });
    },
  },

  calculate_fueling_targets: {
    description:
      'Run the deterministic calculation engine for a stored session. This is the ONLY source of fueling numbers.',
    async run(args, ctx) {
      const actualId = str(args, 'actual_session_id', false);
      const plannedId = str(args, 'planned_session_id', false);
      const session = actualId
        ? await ctx.repo.getActualSession(actualId)
        : plannedId
          ? await ctx.repo.getPlannedSession(plannedId)
          : undefined;
      if (!session) throw new ToolError('calculate_fueling_targets needs a valid planned_session_id or actual_session_id');

      const profile = await ctx.repo.getProfile(ctx.userId);
      if (!profile) throw new ToolError('No profile on file for this user');

      const phase = (str(args, 'phase', false) as 'planning' | 'post_workout' | undefined) ?? 'planning';
      const context = (args.context as CalculateInput['context']) ?? undefined;

      return calculateFuelingTargets({
        session: {
          sport: session.sport,
          intensity: session.intensity,
          duration_minutes: session.duration_minutes,
          distance_km: session.distance_km,
          environment: session.environment,
          multi_session: Boolean(session.session_group_id),
          start_at: session.start_at,
        },
        profile: {
          body_weight_kg: profile.body_weight_kg,
          usual_bottle_ml: profile.usual_bottle_ml,
          known_sweat_data: profile.known_sweat_data,
        },
        phase,
        context,
      });
    },
  },

  log_fuel_intake: {
    description:
      'Record intake. Uses known label values from the catalog where available; records quantity only otherwise. Never invents nutrition numbers.',
    async run(args, ctx) {
      const rawItems = Array.isArray(args.items) ? (args.items as Record<string, unknown>[]) : [];
      if (rawItems.length === 0) throw new ToolError('log_fuel_intake needs at least one item');

      const items = rawItems.map((raw) => {
        const description = String(raw.description ?? '').trim();
        if (!description) throw new ToolError('Each fuel item needs a description');
        const quantity = typeof raw.quantity === 'number' ? raw.quantity : 1;
        const product = resolveProductByPhrase(description);

        if (!product) {
          return {
            description,
            quantity,
            carbohydrate_g: null,
            sodium_mg: null,
            protein_g: null,
            certainty: 'user_reported' as const,
            note: 'Not a recognised branded product — recorded as reported, not estimated.',
          };
        }

        const n = product.nutrition;
        const scale = (v: number | null) => (v === null ? null : Math.round(v * quantity * 100) / 100);
        const hasLabelValue =
          product.nutrition_source === 'label' &&
          (n.carbohydrate_g !== null || n.sodium_mg !== null || n.protein_g !== null || n.fluid_ml !== null);

        return {
          description,
          product_id: product.id,
          quantity,
          fluid_ml: scale(n.fluid_ml) ?? undefined,
          carbohydrate_g: scale(n.carbohydrate_g),
          sodium_mg: scale(n.sodium_mg),
          protein_g: scale(n.protein_g),
          certainty: (hasLabelValue ? 'known' : 'user_reported') as 'known' | 'user_reported',
          note: product.note,
        };
      });

      return ctx.repo.saveFuelLog({
        user_id: ctx.userId,
        session_id: str(args, 'session_id', false),
        items,
      });
    },
  },

  save_recovery: {
    description: 'Store a recovery / how-it-felt check-in. Keeps the user\'s own words as the primary record.',
    async run(args, ctx) {
      return ctx.repo.saveRecoveryLog({
        user_id: ctx.userId,
        session_id: str(args, 'session_id', false),
        free_text: str(args, 'free_text')!,
        overall_severity: str(args, 'overall_severity', false) as
          | 'none'
          | 'low'
          | 'moderate'
          | 'high'
          | undefined,
        reported_symptoms: Array.isArray(args.reported_symptoms)
          ? (args.reported_symptoms as string[])
          : undefined,
        sleep_quality: str(args, 'sleep_quality', false) as 'poor' | 'ok' | 'good' | 'unknown' | undefined,
      });
    },
  },

  get_relevant_history: {
    description: 'Return recent actual sessions and recovery logs relevant to the current context.',
    async run(args, ctx) {
      return ctx.repo.getRelevantHistory(ctx.userId, {
        sport: sport(args, 'sport', false),
        limit: num(args, 'limit'),
      });
    },
  },

  propose_memory_update: {
    description: 'Propose a durable memory. Application code validates and persists it.',
    async run(args, ctx) {
      return ctx.repo.proposeMemory({
        user_id: ctx.userId,
        key: str(args, 'key')!,
        value: str(args, 'value')!,
        certainty: (str(args, 'certainty', false) as 'user_reported' | 'known') ?? 'user_reported',
        source: 'conversation',
        proposed_at: new Date().toISOString(),
      });
    },
  },
};

const SPORT_ENUM = [...SPORTS];
const INTENSITY_ENUM = [...INTENSITIES];

/** JSON Schemas for the tool arguments, consumed by real LLM providers.
 *  The deterministic client ignores these. */
const TOOL_INPUT_SCHEMAS: Record<string, Record<string, unknown>> = {
  get_user_profile: { type: 'object', properties: {}, required: [] },

  save_planned_session: {
    type: 'object',
    properties: {
      sport: { type: 'string', enum: SPORT_ENUM },
      start_at: { type: 'string', description: 'ISO-8601 local datetime, e.g. 2026-09-04T06:00:00' },
      distance_km: { type: 'number' },
      duration_minutes: { type: 'number' },
      intensity: { type: 'string', enum: INTENSITY_ENUM },
      notes: { type: 'string' },
    },
    required: ['sport', 'start_at'],
  },

  save_weekly_plan: {
    type: 'object',
    properties: {
      week_start: { type: 'string', description: 'YYYY-MM-DD of the Monday the week starts. Defaults to this week.' },
      source_text: { type: 'string', description: "The athlete's original sentence, kept verbatim." },
      days: {
        type: 'array',
        description: 'One entry per day the athlete mentioned. Omit days not mentioned.',
        items: {
          type: 'object',
          properties: {
            day_index: { type: 'number', description: '0 = Monday .. 6 = Sunday. Use this or `date`.' },
            date: { type: 'string', description: 'YYYY-MM-DD. Use this or `day_index`.' },
            rest: { type: 'boolean', description: 'True for a rest/off day (no sessions).' },
            sessions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sport: { type: 'string', enum: SPORT_ENUM },
                  distance_km: { type: 'number' },
                  duration_minutes: { type: 'number' },
                  intensity: { type: 'string', enum: INTENSITY_ENUM },
                  is_long: { type: 'boolean', description: 'The athlete called it a "long" session.' },
                },
                required: ['sport'],
              },
            },
          },
        },
      },
    },
    required: ['days'],
  },

  get_weekly_plan: {
    type: 'object',
    properties: {
      week_start: { type: 'string', description: 'YYYY-MM-DD Monday. Omit for the most recent week.' },
    },
    required: [],
  },

  save_actual_session: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['completed', 'modified', 'skipped', 'stopped_early'] },
      sport: { type: 'string', enum: SPORT_ENUM },
      start_at: { type: 'string' },
      distance_km: { type: 'number' },
      duration_minutes: { type: 'number' },
      intensity: { type: 'string', enum: INTENSITY_ENUM },
      reason: { type: 'string', description: "The athlete's stated reason, in their words" },
      planned_session_id: { type: 'string' },
      link_to_plan_date: { type: 'string', description: 'YYYY-MM-DD to link this to an existing plan' },
    },
    required: ['status'],
  },

  calculate_fueling_targets: {
    type: 'object',
    properties: {
      planned_session_id: { type: 'string', description: 'Use "$last" for a plan created earlier this turn' },
      actual_session_id: { type: 'string', description: 'Use "$last" for an actual session created earlier this turn' },
      phase: { type: 'string', enum: ['planning', 'post_workout'] },
      context: {
        type: 'object',
        properties: {
          reason_for_modification: { type: 'string' },
          injury_or_pain: { type: 'boolean' },
          resistance_training: { type: 'boolean' },
          poor_sleep: { type: 'boolean' },
        },
      },
    },
    required: ['phase'],
  },

  log_fuel_intake: {
    type: 'object',
    properties: {
      session_id: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'What the athlete said, e.g. "SIS gel", "750ml bottle"' },
            quantity: { type: 'number' },
          },
          required: ['description'],
        },
      },
    },
    required: ['items'],
  },

  save_recovery: {
    type: 'object',
    properties: {
      free_text: { type: 'string', description: "The athlete's own words" },
      overall_severity: { type: 'string', enum: ['none', 'low', 'moderate', 'high'] },
      reported_symptoms: { type: 'array', items: { type: 'string' } },
      sleep_quality: { type: 'string', enum: ['poor', 'ok', 'good', 'unknown'] },
      session_id: { type: 'string' },
    },
    required: ['free_text'],
  },

  get_relevant_history: {
    type: 'object',
    properties: {
      sport: { type: 'string', enum: SPORT_ENUM },
      limit: { type: 'number' },
    },
    required: [],
  },

  propose_memory_update: {
    type: 'object',
    properties: {
      key: { type: 'string' },
      value: { type: 'string' },
      certainty: { type: 'string', enum: ['user_reported', 'known'] },
    },
    required: ['key', 'value'],
  },
};

export const TOOL_SCHEMAS: ToolSchema[] = Object.entries(TOOLS).map(([name, def]) => ({
  name,
  description: def.description,
  input_schema: TOOL_INPUT_SCHEMAS[name] ?? { type: 'object', properties: {}, required: [] },
}));

export async function runTool(
  tool: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ tool: string; ok: boolean; data?: unknown; error?: string }> {
  const def = TOOLS[tool];
  if (!def) return { tool, ok: false, error: `Unknown tool: ${tool}` };
  try {
    const data = await def.run(args, ctx);
    return { tool, ok: true, data };
  } catch (err) {
    return { tool, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Helper used by the exact-product test path (§21.13).
export function knownProductProtein(productId: string): number | null {
  return getProduct(productId)?.nutrition.protein_g ?? null;
}
