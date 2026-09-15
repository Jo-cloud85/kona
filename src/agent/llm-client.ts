import type {
  ActualSession,
  MissingDetail,
  PersistedMemory,
  PlannedSession,
  Profile,
  Sport,
  WeeklyPlan,
} from '../domain/types';
import type { RelevantHistory } from '../data/repository';
import type { Insight } from './insights';

/** Sessions in the current weekly plan the user hasn't fully specified. */
export interface PendingPlanDetail {
  week_start: string;
  groups: { sport: Sport; day_indexes: number[]; weekday_labels: string[]; missing: MissingDetail[] }[];
}

/**
 * The LLM's role here is strictly conversational orchestration
 * (ARCHITECTURE.md, AGENT_SPEC.md): interpret language, pick tools, phrase
 * results. It never computes fueling numbers — those come from tool results
 * produced by the deterministic engine.
 *
 * This interface lets a real provider (OpenAI/Anthropic function-calling) drop
 * in later. The vertical slice ships a deterministic rule-based implementation.
 */

export interface ContextPackage {
  now_iso: string;
  profile?: Profile;
  current_plan?: PlannedSession;
  last_actual_session?: ActualSession;
  current_week_plan?: WeeklyPlan;
  /** Present when the latest weekly plan has sessions with missing detail. */
  pending_plan_details?: PendingPlanDetail;
  history: RelevantHistory;
  memories: PersistedMemory[];
  /** Pre-computed observations about the athlete (deterministic pattern layer). */
  insights: Insight[];
}

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments (used by real LLM providers). */
  input_schema: Record<string, unknown>;
}

export interface PlannedToolCall {
  tool: string;
  /** Arg values equal to the string "$last" are resolved by the orchestrator to
   *  the id of the most recent matching saved record. */
  args: Record<string, unknown>;
}

export interface InterpretRequest {
  message: string;
  context: ContextPackage;
  tools: ToolSchema[];
  /** A short, bounded window of the immediately preceding turns in this same
   *  conversation (oldest first) — NOT the whole history (see ARCHITECTURE.md
   *  "never pass the whole history to the LLM"; CONTEXT already carries the
   *  durable structured facts). Exists so a multi-step ask_choice exchange
   *  (sport -> style -> time -> ...) reads as one conversation instead of each
   *  tap losing what the athlete already answered a turn or two ago. */
  recent_messages?: { role: 'user' | 'assistant'; content: string }[];
}

/** A tappable quick-reply. Tapping sends `value` as the athlete's next chat
 *  message, verbatim — the LLM sees it exactly as if they'd typed it, so no
 *  separate structured-answer path is needed. */
export interface ChoiceOption {
  label: string;
  value: string;
}

export interface InterpretResult {
  intent: string;
  tool_calls: PlannedToolCall[];
  /** When set, the orchestrator skips tools and returns this question. */
  clarifying_question?: string;
  /** Present alongside clarifying_question when it's a single-choice question
   *  best answered with quick-reply chips (sport, session style, time of day,
   *  duration/intensity, another session today, conditions) rather than free
   *  text. Absent for an open-ended clarifying question. */
  clarifying_options?: ChoiceOption[];
  notes?: string[];
}

export interface ToolResult {
  tool: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface ComposeRequest {
  message: string;
  context: ContextPackage;
  intent: string;
  tool_results: ToolResult[];
}

export interface LlmClient {
  interpret(req: InterpretRequest): Promise<InterpretResult>;
  compose(req: ComposeRequest): Promise<string>;
}
