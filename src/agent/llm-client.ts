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
}

export interface InterpretResult {
  intent: string;
  tool_calls: PlannedToolCall[];
  /** When set, the orchestrator skips tools and returns this question. */
  clarifying_question?: string;
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
