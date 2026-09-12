import type { Intensity, MissingDetail, PlannedSession, Sport, TimeOfDay } from '../domain/types';
import { timeOfDayFromHour } from './parse';
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

const TIMES_OF_DAY: TimeOfDay[] = ['morning', 'afternoon', 'evening'];

/** Canonical clock time we store for a session given only its time-of-day
 *  bucket, so downstream views (Home, dashboard) show a consistent hour. */
const TIME_OF_DAY_HHMM: Record<TimeOfDay, string> = {
  morning: '07:00',
  afternoon: '13:00',
  evening: '18:30',
};

function isoHour(iso: string): number | undefined {
  const m = /T(\d{2}):/.exec(iso);
  return m ? Number(m[1]) : undefined;
}

function plannedToWeekSession(s: PlannedSession): WeekSessionInput {
  return {
    sport: s.sport,
    intensity: s.intensity,
    time_of_day: s.time_of_day,
    start_at: s.start_at,
    distance_km: s.distance_km,
    duration_minutes: s.duration_minutes,
    is_long: s.is_long ?? false,
    needs_detail: s.needs_detail ?? [],
  };
}

/** What the user left unspecified for a planned session, so Kona can ask.
 *  Per the session-info contract: type, intensity, distance-or-duration, and
 *  time of day are all required. */
function computeNeedsDetail(opts: {
  intensity_stated: boolean;
  is_long: boolean;
  has_duration: boolean;
  has_distance: boolean;
  time_of_day_stated: boolean;
}): MissingDetail[] {
  const needs: MissingDetail[] = [];
  // A "long" session is conventionally easy/steady — don't nag about effort.
  if (!opts.intensity_stated && !opts.is_long) needs.push('intensity');
  if (!opts.has_duration && !opts.has_distance) needs.push('duration_or_distance');
  if (!opts.time_of_day_stated) needs.push('time_of_day');
  return needs;
}

export interface ToolContext {
  repo: Repository;
  userId: string;
  /** The chat message (turn) these tool calls belong to. Stamped onto every
   *  structured record they create so an edited turn can be reconciled (M23.1). */
  originMessageId?: string;
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

const SPORTS: Sport[] = [
  'running',
  'cycling',
  'swimming',
  'gym',
  'climbing',
  'skating',
  'combat_sports',
  'hyrox',
  'triathlon',
  'other',
];
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

function timeOfDay(args: Record<string, unknown>, key: string): TimeOfDay | undefined {
  const v = str(args, key, false);
  if (v === undefined) return undefined;
  if (!TIMES_OF_DAY.includes(v as TimeOfDay)) throw new ToolError(`Unknown time_of_day: ${v}`);
  return v as TimeOfDay;
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
      const start_at = str(args, 'start_at')!;
      const h = isoHour(start_at);
      const time_of_day = timeOfDay(args, 'time_of_day') ?? (h !== undefined ? timeOfDayFromHour(h) : undefined);
      return ctx.repo.savePlannedSession({
        user_id: ctx.userId,
        sport: sport(args, 'sport')!,
        start_at,
        time_of_day,
        distance_km: num(args, 'distance_km'),
        distance_label: str(args, 'distance_label', false),
        duration_minutes: num(args, 'duration_minutes'),
        intensity: intensity(args, 'intensity') ?? 'easy',
        environment: (args.environment as CalculateInput['session']['environment']) ?? undefined,
        notes: str(args, 'notes', false),
        origin_message_id: ctx.originMessageId,
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
        origin_message_id: ctx.originMessageId,
      });

      const analysisSessions: WeekSessionInput[] = [];
      const saved = [];
      for (const day of dayPlans) {
        const groupId = day.sessions.length > 1 ? newId('grp') : undefined;
        for (let i = 0; i < day.sessions.length; i++) {
          const s = day.sessions[i]!;
          const sport_ = sport(s, 'sport')!;
          const intensityStated = s.intensity !== undefined && s.intensity !== null && s.intensity !== '';
          const intensity_ = intensity(s, 'intensity') ?? 'easy';
          const time_of_day = timeOfDay(s, 'time_of_day');
          const start_at = time_of_day
            ? `${day.date}T${TIME_OF_DAY_HHMM[time_of_day]}:00`
            : `${day.date}T${SEQUENCE_TIMES[Math.min(i, SEQUENCE_TIMES.length - 1)]}:00`;
          const distance_km = num(s, 'distance_km');
          const distance_label = str(s, 'distance_label', false);
          const duration_minutes = num(s, 'duration_minutes');
          const isLong = s.is_long === true;
          const needs_detail = computeNeedsDetail({
            intensity_stated: intensityStated,
            is_long: isLong,
            has_duration: duration_minutes !== undefined,
            has_distance: distance_km !== undefined,
            time_of_day_stated: time_of_day !== undefined,
          });

          saved.push(
            await ctx.repo.savePlannedSession({
              user_id: ctx.userId,
              sport: sport_,
              start_at,
              time_of_day,
              distance_km,
              distance_label,
              duration_minutes,
              intensity: intensity_,
              session_group_id: groupId,
              sequence_index: day.sessions.length > 1 ? i : undefined,
              weekly_plan_id: weeklyPlan.id,
              is_long: isLong || undefined,
              needs_detail: needs_detail.length ? needs_detail : undefined,
              origin_message_id: ctx.originMessageId,
            }),
          );
          analysisSessions.push({
            sport: sport_,
            intensity: intensity_,
            time_of_day,
            start_at,
            distance_km,
            duration_minutes,
            is_long: isLong,
            needs_detail,
          });
        }
      }

      const profile = await ctx.repo.getProfile(ctx.userId);
      const analysis = analyzeWeek({
        week_start: weekStart,
        sessions: analysisSessions,
        rest_days: restDays,
        profile: {
          body_weight_kg: profile?.body_weight_kg,
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
        sessions: sessions.map(plannedToWeekSession),
        profile: {
          body_weight_kg: profile?.body_weight_kg,
          usual_bottle_ml: profile?.usual_bottle_ml,
          known_sweat_data: profile?.known_sweat_data,
        },
      });
      return { weekly_plan: plan, sessions, rest_days: plan.rest_days, analysis };
    },
  },

  update_planned_sessions: {
    description:
      "Fill in details the athlete left out of a saved weekly plan (how hard a session is, its duration or distance). Match by day and/or sport. Do NOT create a new plan. Re-runs and returns the week analysis.",
    async run(args, ctx) {
      const weekStart = str(args, 'week_start', false);
      const plan = weekStart
        ? await ctx.repo.getWeeklyPlan(ctx.userId, weekStart)
        : (await ctx.repo.listWeeklyPlans(ctx.userId)).at(-1);
      if (!plan) throw new ToolError('No weekly plan on file to update');

      const all = await ctx.repo.listPlannedSessionsForWeeklyPlan(plan.id);
      const wantSport = sport(args, 'sport', false);
      const dayIndex = num(args, 'day_index');
      const wantDate =
        str(args, 'date', false) ??
        (typeof dayIndex === 'number' ? dateFromWeekStart(plan.week_start, dayIndex) : undefined);

      let targets = all.filter((s) => (s.needs_detail?.length ?? 0) > 0);
      if (wantSport) targets = targets.filter((s) => s.sport === wantSport);
      if (wantDate) targets = targets.filter((s) => s.start_at.slice(0, 10) === wantDate);
      if (targets.length === 0) {
        throw new ToolError('Nothing pending in the plan matches that day/sport.');
      }

      const newIntensity = intensity(args, 'intensity');
      const newDuration = num(args, 'duration_minutes');
      const newDistance = num(args, 'distance_km');
      const newDistanceLabel = str(args, 'distance_label', false);
      const newTime = timeOfDay(args, 'time_of_day');
      if (
        newIntensity === undefined &&
        newDuration === undefined &&
        newDistance === undefined &&
        newDistanceLabel === undefined &&
        newTime === undefined
      ) {
        throw new ToolError('update_planned_sessions needs an intensity, duration_minutes, distance_km, or time_of_day');
      }

      const applied_fields: ('intensity' | 'duration_minutes' | 'distance_km' | 'time_of_day')[] = [];
      if (newIntensity !== undefined) applied_fields.push('intensity');
      if (newDuration !== undefined) applied_fields.push('duration_minutes');
      if (newDistance !== undefined || newDistanceLabel !== undefined) applied_fields.push('distance_km');
      if (newTime !== undefined) applied_fields.push('time_of_day');

      const updated = [];
      for (const s of targets) {
        const remaining = new Set(s.needs_detail ?? []);
        const patch: Parameters<typeof ctx.repo.updatePlannedSession>[1] = {};
        if (newIntensity !== undefined) {
          patch.intensity = newIntensity;
          remaining.delete('intensity');
        }
        if (newDuration !== undefined) {
          patch.duration_minutes = newDuration;
          remaining.delete('duration_or_distance');
        }
        if (newDistance !== undefined) {
          patch.distance_km = newDistance;
          remaining.delete('duration_or_distance');
        }
        if (newDistanceLabel !== undefined) {
          patch.distance_label = newDistanceLabel;
          remaining.delete('duration_or_distance');
        }
        if (newTime !== undefined) {
          patch.time_of_day = newTime;
          // realign stored start_at so Home / dashboard show the right hour
          patch.start_at = `${s.start_at.slice(0, 10)}T${TIME_OF_DAY_HHMM[newTime]}:00`;
          remaining.delete('time_of_day');
        }
        patch.needs_detail = [...remaining];
        updated.push(await ctx.repo.updatePlannedSession(s.id, patch));
      }

      const sessions = await ctx.repo.listPlannedSessionsForWeeklyPlan(plan.id);
      const profile = await ctx.repo.getProfile(ctx.userId);
      const analysis = analyzeWeek({
        week_start: plan.week_start,
        rest_days: plan.rest_days,
        sessions: sessions.map(plannedToWeekSession),
        profile: {
          body_weight_kg: profile?.body_weight_kg,
          usual_bottle_ml: profile?.usual_bottle_ml,
          known_sweat_data: profile?.known_sweat_data,
        },
      });
      return { weekly_plan: plan, updated, applied_fields, sessions, rest_days: plan.rest_days, analysis };
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
        origin_message_id: ctx.originMessageId,
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
        origin_message_id: ctx.originMessageId,
      });
    },
  },

  save_recovery: {
    description: 'Store a recovery / how-it-felt check-in. Keeps the user\'s own words as the primary record.',
    async run(args, ctx) {
      return ctx.repo.saveRecoveryLog({
        user_id: ctx.userId,
        session_id: str(args, 'session_id', false),
        origin_message_id: ctx.originMessageId,
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
        origin_message_id: ctx.originMessageId,
        proposed_at: new Date().toISOString(),
      });
    },
  },

  save_profile_fact: {
    description:
      "Update a standing fact on the athlete's profile from something they said in passing — body weight (kg), usual bottle size (ml), or their training goal / target event and its date. Do NOT use this for session details or one-off intake.",
    async run(args, ctx) {
      const profile = await ctx.repo.getProfile(ctx.userId);
      if (!profile) throw new ToolError('No profile on file for this user');
      const patch: {
        body_weight_kg?: number;
        usual_bottle_ml?: number;
        goal?: { text: string; event_date?: string };
      } = {};

      const w = num(args, 'body_weight_kg');
      if (w !== undefined) {
        if (w < 25 || w > 250) throw new ToolError('body_weight_kg must be between 25 and 250');
        patch.body_weight_kg = Math.round(w * 10) / 10;
      }
      const b = num(args, 'usual_bottle_ml');
      if (b !== undefined) {
        if (b < 100 || b > 3000) throw new ToolError('usual_bottle_ml must be between 100 and 3000');
        patch.usual_bottle_ml = Math.round(b);
      }
      const goalText = str(args, 'goal_text', false);
      const goalDate = str(args, 'goal_event_date', false);
      if (goalText || goalDate) {
        const text = goalText?.slice(0, 200) ?? profile.goal?.text;
        if (!text) throw new ToolError('goal_event_date needs an existing goal or goal_text');
        const goal: { text: string; event_date?: string } = { text };
        const date = goalDate ?? profile.goal?.event_date;
        if (date) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ToolError('goal_event_date must be YYYY-MM-DD');
          goal.event_date = date;
        }
        patch.goal = goal;
      }
      if (Object.keys(patch).length === 0) {
        throw new ToolError('save_profile_fact needs body_weight_kg, usual_bottle_ml, or goal_text/goal_event_date');
      }
      return ctx.repo.upsertProfile({ ...profile, ...patch });
    },
  },
};

const SPORT_ENUM = [...SPORTS];
const INTENSITY_ENUM = [...INTENSITIES];
const TIME_OF_DAY_ENUM = [...TIMES_OF_DAY];

/** JSON Schemas for the tool arguments, consumed by real LLM providers.
 *  The deterministic client ignores these. */
const TOOL_INPUT_SCHEMAS: Record<string, Record<string, unknown>> = {
  get_user_profile: { type: 'object', properties: {}, required: [] },

  save_planned_session: {
    type: 'object',
    properties: {
      sport: { type: 'string', enum: SPORT_ENUM },
      start_at: { type: 'string', description: 'ISO-8601 local datetime, e.g. 2026-09-04T06:00:00' },
      time_of_day: {
        type: 'string',
        enum: TIME_OF_DAY_ENUM,
        description: 'morning / afternoon / evening. Derived from start_at if omitted.',
      },
      distance_km: {
        type: 'number',
        description: 'A single distance in km. If the athlete gave a range (e.g. "13-14km"), use the midpoint here and put their exact words in distance_label.',
      },
      distance_label: {
        type: 'string',
        description: 'Only when distance_km alone would misrepresent what they said (a range like "13-14 km", "~10k"). Their own words, shown instead of the number.',
      },
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
                  distance_km: {
                    type: 'number',
                    description: 'A single distance in km. If the athlete gave a range (e.g. "13-14km"), use the midpoint here and put their exact words in distance_label.',
                  },
                  distance_label: {
                    type: 'string',
                    description: 'Only when distance_km alone would misrepresent what they said (a range like "13-14 km", "~10k"). Their own words, shown instead of the number.',
                  },
                  duration_minutes: { type: 'number' },
                  intensity: { type: 'string', enum: INTENSITY_ENUM },
                  time_of_day: { type: 'string', enum: TIME_OF_DAY_ENUM, description: 'morning / afternoon / evening.' },
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

  update_planned_sessions: {
    type: 'object',
    properties: {
      week_start: { type: 'string', description: 'YYYY-MM-DD Monday. Omit for the most recent week.' },
      day_index: { type: 'number', description: '0 = Monday .. 6 = Sunday. Narrows to one day.' },
      date: { type: 'string', description: 'YYYY-MM-DD. Narrows to one day.' },
      sport: { type: 'string', enum: SPORT_ENUM, description: 'Narrows to sessions of this sport.' },
      intensity: { type: 'string', enum: INTENSITY_ENUM },
      duration_minutes: { type: 'number' },
      distance_km: {
        type: 'number',
        description: 'A single distance in km. If the athlete gave a range (e.g. "13-14km"), use the midpoint here and put their exact words in distance_label.',
      },
      distance_label: {
        type: 'string',
        description: 'Only when distance_km alone would misrepresent what they said (a range like "13-14 km", "~10k"). Their own words, shown instead of the number.',
      },
      time_of_day: { type: 'string', enum: TIME_OF_DAY_ENUM, description: 'morning / afternoon / evening.' },
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

  save_profile_fact: {
    type: 'object',
    properties: {
      body_weight_kg: { type: 'number', description: 'Athlete body weight in kg (25–250).' },
      usual_bottle_ml: { type: 'number', description: 'Their usual bottle size in ml (100–3000).' },
      goal_text: { type: 'string', description: 'Their training goal / target event, in their words.' },
      goal_event_date: { type: 'string', description: 'YYYY-MM-DD of the target event, when they give one.' },
    },
    required: [],
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
    const message = err instanceof Error ? err.message : String(err);
    // Surfaced to the athlete as a plain-language apology (see COMPOSE_SYSTEM) —
    // logged here too so a real cause is diagnosable, not just a black box.
    console.error(`kona tool failed: ${tool}`, err);
    return { tool, ok: false, error: message };
  }
}

// Helper used by the exact-product test path (§21.13).
export function knownProductProtein(productId: string): number | null {
  return getProduct(productId)?.nutrition.protein_g ?? null;
}
