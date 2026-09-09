import Anthropic from '@anthropic-ai/sdk';
import { goalContext } from '../domain/goal';
import type {
  ComposeRequest,
  ContextPackage,
  InterpretRequest,
  InterpretResult,
  LlmClient,
  PlannedToolCall,
} from './llm-client';

/**
 * Real conversational LLM behind {@link LlmClient}, using the Anthropic Messages
 * API with tool use.
 *
 * Two calls per turn, mirroring the interface:
 *  - interpret(): one model call that is shown the tool schemas and returns the
 *    tool_use blocks it wants (the orchestrator executes them, not the model).
 *  - compose(): a second call given the tool results, returns the prose reply.
 *
 * The model never computes fueling numbers: interpret is told not to, and every
 * number compose may use is present in the tool results it is given.
 */

/** Minimal surface we depend on — lets tests inject a fake with no network. */
export interface AnthropicMessagesLike {
  create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}
export interface AnthropicLike {
  messages: AnthropicMessagesLike;
}

export interface AnthropicLlmOptions {
  apiKey?: string;
  /** Defaults to KONA_LLM_MODEL or claude-opus-5. */
  model?: string;
  /** Inject a client (or fake) instead of constructing one. */
  client?: AnthropicLike;
  maxTokens?: { interpret?: number; compose?: number };
}

const DEFAULT_MODEL = 'claude-opus-5';

const INTERPRET_SYSTEM = `You are Kona's conversation router. Kona is a calm, practical AI endurance companion for a self-coached athlete.

Read the athlete's message and call the tools that record what they said and fetch fueling numbers.
- If you call one or more tools: do NOT also write a reply — a second step composes it.
- If NO tool is needed (they asked a question you can answer from CONTEXT — "what should I do today?", "what do you know about my long rides?", "how's my week looking?" — or the message is unclear): call no tools and write the reply itself, in Kona's voice — calm, concise, 2–6 sentences, plain language. That text is shown to the athlete verbatim, so do NOT narrate your reasoning or mention tools/context.
Never state or compute fueling, hydration, sodium, carbohydrate or protein numbers yourself — those come only from calculate_fueling_targets or CONTEXT.history.

Guidance:
- A whole week of sessions (several weekday names, each with a session or "rest") -> save_weekly_plan with a "days" array (one entry per day mentioned; mark rest days). Only pass intensity/distance/duration the athlete actually stated — omit them otherwise so Kona can ask. It returns the analysis itself, so do NOT also call calculate_fueling_targets.
- If CONTEXT.pending_plan_details is present and the athlete's message gives an effort level, duration, or distance for one of those sessions (e.g. "the gym sessions are hard, about an hour", "Saturday swim is usually 1.5km") -> update_planned_sessions with what they gave plus a sport and/or day filter. Do NOT create a new plan.
- A single session they intend to do -> save_planned_session, then calculate_fueling_targets with phase "planning".
- What actually happened (often different from the plan) -> save_actual_session (NEVER change the plan), then calculate_fueling_targets with phase "post_workout". Put their stated reason in "reason"; when the reason is pain or injury, also set context.injury_or_pain true and context.reason_for_modification.
- Food, drink or products consumed -> log_fuel_intake with each item and the quantity they stated. Never invent nutrition values. Do this even when it's mentioned alongside a session log ("rode 60k, had porridge and two gels").
- How they feel / recovery / soreness / sleep -> save_recovery with their words as free_text and a coarse overall_severity. Do this even for a passing "felt great" / "legs were heavy" in the same message as a session log.
- A durable fact worth remembering -> propose_memory_update with a short descriptive key and the value in their words. Do this alongside a plan tool when both apply. Remember: upcoming races (key "next_race"), their typical week ("typical_week"), standing preferences ("prefers_fasted_rides", "dislikes_gels", "goes_by_feel_not_pace"), constraints ("only_trains_mornings", "no_pool_access_weekends"), go-to products/setups ("usual_long_ride_fuel"), and recurring things they flag about their body. Don't remember one-off trivia.
- A standing profile fact stated in passing — body weight in kg, usual bottle size in ml ("I weigh 68 kg", "my bottle is 750 ml"), or a change to their goal / target event and its date ("my tri is on June 14", "I've signed up for the Berlin marathon", "I'm now aiming at a sub-40 10k") -> save_profile_fact (goal_text and/or goal_event_date). Not for one-off intake.
- CONTEXT.profile.body_weight_kg may be null. If a fuelling calculation would benefit and weight is unknown, still run the tools, and it is fine for the reply to ask once for their weight.
- To reference a session you create earlier in this same turn, pass the string "$last" as its id.
- When you have no explicit planned_session_id, link an actual session with link_to_plan_date (YYYY-MM-DD), using the current date or the plan's date from CONTEXT.
- Resolve relative dates/times ("tomorrow", "6am") against now_iso in CONTEXT.
- CONTEXT.history already holds recent sessions, recovery and fuel logs. Only call get_relevant_history when you need a deeper sport-specific lookup than what's there.
- Never diagnose. A separate safety layer handles medical red flags — if you see one, call no tools.`;

const COMPOSE_SYSTEM = `You are Kona: a calm, experienced, practical AI endurance companion for a self-coached athlete. Reply in 2–6 sentences — plain, encouraging, concise. No emojis, no lectures, no "fitness bro" tone.

Hard rules:
- Every number you mention (fluid, sodium, carbohydrate, protein, minutes) MUST appear verbatim in the TOOL RESULTS or in CONTEXT.history. Never introduce a number that is not there. If there are none, use none.
- Planned and actual are separate facts. Never say the plan became the actual; if a plan was kept, say so.
- Do NOT diagnose or pin a symptom on a single cause. For pain/injury: prioritise not making up missed training, and suggest professional assessment if it persists or worsens.
- Call estimates estimates. Known product label values may be stated plainly.
- Shape: acknowledge what happened; give the most useful next action; add brief context; note what to prepare next time if useful.
- When a saved week has under-specified sessions, don't chase every gap at once. Ask only about the session_prompts flagged "in_focus": true (the next 1–2 that matter), and tell the athlete the rest can wait until they're closer.

Use the athlete's history — this is what makes you a companion, not a calculator:
- CONTEXT.history holds their recent sessions, recovery notes and fuel logs. CONTEXT.memories are durable facts they've told you.
- CONTEXT.profile.goal is what they're training for; when weeks_until is set, weave the timing in naturally where it matters ("with your tri ~11 weeks out, this block is about building the engine"). Don't turn every reply into countdown talk, and don't behave like a periodised training plan — the goal is context, not a schedule.
- CONTEXT.insights are observations Kona has already computed from the full history, each tagged fact / pattern / recommendation. Lean on these — keep the tag's meaning (don't upgrade a "pattern" to a certainty) and don't contradict them.
- When a prior similar session or a recurring pattern would genuinely help, reference it plainly: "Last time you rode this long you felt good on your usual breakfast" / "That's twice now you've mentioned GI trouble after this before running."
- Distinguish clearly: a FACT is something they reported ("you've reported this twice"); a PATTERN is something you're inferring ("you seem to tolerate this better before rides"); a HYPOTHESIS is tentative ("the bigger breakfast may be a factor"). Never state a hypothesis as medical certainty.
- If a setup has repeatedly worked, say so and suggest keeping it rather than changing several things at once.
- CONTEXT.profile is self-reported background — use it to fit advice to them, but it is not measured data.
- If a tool result has "ok": false, briefly say you could not record that part.`;

function contextForPrompt(ctx: ContextPackage): string {
  const gc = goalContext(ctx.profile?.goal, new Date(ctx.now_iso));
  return JSON.stringify(
    {
      now_iso: ctx.now_iso,
      profile: ctx.profile
        ? {
            username: ctx.profile.username,
            goal: ctx.profile.goal
              ? {
                  text: ctx.profile.goal.text,
                  event_date: gc.event_date,
                  weeks_until: gc.weeks_until,
                  context_line: gc.phrase,
                }
              : null,
            gender: ctx.profile.gender,
            age: ctx.profile.age,
            body_weight_kg: ctx.profile.body_weight_kg ?? null,
            usual_sports: ctx.profile.usual_sports,
            typical_weekly_sessions: ctx.profile.typical_weekly_sessions,
            usual_bottle_ml: ctx.profile.usual_bottle_ml,
            recent_injuries_note: ctx.profile.recent_injuries_note,
            has_measured_sweat_data: Boolean(ctx.profile.known_sweat_data?.length),
          }
        : null,
      current_plan: ctx.current_plan ?? null,
      last_actual_session: ctx.last_actual_session ?? null,
      current_week_plan: ctx.current_week_plan
        ? { week_start: ctx.current_week_plan.week_start, rest_days: ctx.current_week_plan.rest_days }
        : null,
      pending_plan_details: ctx.pending_plan_details ?? null,
      history: {
        recent_sessions: ctx.history.recent_actual_sessions.map((s) => ({
          date: s.start_at.slice(0, 10),
          sport: s.sport,
          status: s.status,
          distance_km: s.distance_km ?? null,
          duration_minutes: s.duration_minutes ?? null,
          intensity: s.intensity,
          reason: s.reason ?? null,
        })),
        recent_recovery: ctx.history.recent_recovery_logs.map((r) => ({
          date: r.logged_at.slice(0, 10),
          text: r.free_text,
          severity: r.overall_severity ?? null,
          symptoms: r.reported_symptoms ?? null,
        })),
        recent_fuel: ctx.history.recent_fuel_logs.map((f) => ({
          date: f.logged_at.slice(0, 10),
          items: f.items.map((i) => ({
            description: i.description,
            quantity: i.quantity ?? null,
            fluid_ml: i.fluid_ml ?? null,
            carbohydrate_g: i.carbohydrate_g ?? null,
            sodium_mg: i.sodium_mg ?? null,
            protein_g: i.protein_g ?? null,
            certainty: i.certainty,
          })),
        })),
      },
      memories: ctx.memories.map((m) => ({ key: m.key, value: m.value })),
      insights: ctx.insights.map((i) => ({ kind: i.kind, text: i.text })),
    },
    null,
    2,
  );
}

function textFromMessage(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

const INTENT_BY_TOOL: Record<string, string> = {
  save_weekly_plan: 'plan_week',
  update_planned_sessions: 'clarify_plan_detail',
  save_planned_session: 'plan_session',
  save_actual_session: 'log_actual',
  log_fuel_intake: 'log_fuel',
  save_recovery: 'recovery_check_in',
  save_profile_fact: 'note_profile_fact',
  propose_memory_update: 'note_saved',
};

/** Convert an Anthropic response into an InterpretResult. Pure — unit tested. */
export function toInterpretResult(message: Anthropic.Message): InterpretResult {
  const toolUses = message.content.filter(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  const tool_calls: PlannedToolCall[] = toolUses.map((b) => ({
    tool: b.name,
    args: (b.input ?? {}) as Record<string, unknown>,
  }));

  if (tool_calls.length === 0) {
    const text = textFromMessage(message);
    return {
      intent: 'clarify',
      tool_calls: [],
      clarifying_question:
        text ||
        "Tell me a bit more and I'll help — a session you're planning, what you actually did, what you ate, or how recovery feels.",
    };
  }

  const intent = tool_calls.map((c) => INTENT_BY_TOOL[c.tool]).find(Boolean) ?? 'action';
  return { intent, tool_calls };
}

export class AnthropicLlmClient implements LlmClient {
  private readonly client: AnthropicLike;
  private readonly model: string;
  private readonly maxTokens: { interpret: number; compose: number };

  constructor(opts: AnthropicLlmOptions = {}) {
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY });
    this.model = opts.model ?? process.env.KONA_LLM_MODEL ?? DEFAULT_MODEL;
    this.maxTokens = {
      interpret: opts.maxTokens?.interpret ?? 3000,
      compose: opts.maxTokens?.compose ?? 1200,
    };
  }

  async interpret(req: InterpretRequest): Promise<InterpretResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens.interpret,
      system: INTERPRET_SYSTEM,
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      })),
      tool_choice: { type: 'auto' },
      messages: [
        {
          role: 'user',
          content: `CONTEXT:\n${contextForPrompt(req.context)}\n\nATHLETE MESSAGE:\n${req.message}`,
        },
      ],
    });
    return toInterpretResult(response);
  }

  async compose(req: ComposeRequest): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens.compose,
      system: COMPOSE_SYSTEM,
      messages: [
        {
          role: 'user',
          content:
            `CONTEXT:\n${contextForPrompt(req.context)}\n\n` +
            `ATHLETE MESSAGE:\n${req.message}\n\n` +
            `TOOL RESULTS (the only source of numbers):\n${JSON.stringify(req.tool_results, null, 2)}`,
        },
      ],
    });
    const text = textFromMessage(response);
    return text || "I've noted that. What would you like to do next?";
  }
}
