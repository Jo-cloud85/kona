import Anthropic from '@anthropic-ai/sdk';
import type {
  ComposeRequest,
  ContextPackage,
  InterpretRequest,
  InterpretResult,
  LlmClient,
  PlannedToolCall,
} from './llm-client.js';

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

const INTERPRET_SYSTEM = `You are Kona's conversation router. Kona is a calm, practical training-fueling companion for recreational athletes.

Your ONLY job this turn: read the athlete's message and call the tools that record what they said and fetch any fueling numbers. Do NOT write a reply to the user now. Do NOT state or compute any fueling, hydration, sodium, carbohydrate or protein numbers yourself — those come only from calculate_fueling_targets.

Guidance:
- A session they intend to do -> save_planned_session, then calculate_fueling_targets with phase "planning".
- What actually happened (often different from the plan) -> save_actual_session (NEVER change the plan), then calculate_fueling_targets with phase "post_workout". Put their stated reason in "reason"; when the reason is pain or injury, also set context.injury_or_pain true and context.reason_for_modification.
- Food, drink or products consumed -> log_fuel_intake with each item and the quantity they stated. Never invent nutrition values.
- How they feel / recovery / soreness / sleep -> save_recovery with their words as free_text and a coarse overall_severity.
- To reference a session you create earlier in this same turn, pass the string "$last" as its id.
- When you have no explicit planned_session_id, link an actual session with link_to_plan_date (YYYY-MM-DD), using the current date or the plan's date from CONTEXT.
- Resolve relative dates/times ("tomorrow", "6am") against now_iso in CONTEXT.
- If the message is unclear or has no actionable content, call NO tools and reply with one short clarifying question.
- Never diagnose. A separate safety layer handles medical red flags — if you see one, call no tools.`;

const COMPOSE_SYSTEM = `You are Kona: a calm, experienced, practical training-fueling companion. Reply to the athlete in 2–6 sentences — plain, encouraging, concise. No emojis, no lectures, no "fitness bro" tone.

Hard rules:
- Every number you mention (fluid, sodium, carbohydrate, protein, minutes) MUST appear verbatim in the TOOL RESULTS below. Never introduce a number that is not there. If there are no numbers, use none.
- Planned and actual are separate facts. Never say the plan became the actual; if a plan was kept, say so.
- Do NOT diagnose or pin a symptom on a single cause. For pain/injury: prioritise not making up missed training, and suggest professional assessment if it persists or worsens.
- Call estimates estimates. Known product label values may be stated plainly.
- Shape: acknowledge what happened; give the most useful next action; add brief context; note what to prepare next time if useful.
- If a tool result has "ok": false, briefly say you could not record that part.`;

function contextForPrompt(ctx: ContextPackage): string {
  return JSON.stringify(
    {
      now_iso: ctx.now_iso,
      profile: ctx.profile
        ? {
            body_weight_kg: ctx.profile.body_weight_kg,
            usual_sports: ctx.profile.usual_sports,
            usual_bottle_ml: ctx.profile.usual_bottle_ml,
            has_measured_sweat_data: Boolean(ctx.profile.known_sweat_data?.length),
          }
        : null,
      current_plan: ctx.current_plan ?? null,
      last_actual_session: ctx.last_actual_session ?? null,
      memories: ctx.memories.map((m) => ({ key: m.key, value: m.value })),
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
  save_planned_session: 'plan_session',
  save_actual_session: 'log_actual',
  log_fuel_intake: 'log_fuel',
  save_recovery: 'recovery_check_in',
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
