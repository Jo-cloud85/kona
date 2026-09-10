import type { Repository } from '../data/repository';
import { deriveTurnEvents } from './activity';
import { buildContext } from './context';
import { deriveInsights } from './insights';
import type { LlmClient, ToolResult } from './llm-client';
import { safetyMessage, screenForEscalation, type SafetyScreen } from './safety';
import { runTool, TOOL_SCHEMAS } from './tools';

/** Record activity events for a completed turn — action events + any insight
 *  that just crossed its evidence threshold. Best-effort; never throws.
 *  Pass toolResults `[]` to only run the insight-detection pass (e.g. a check-in). */
export async function recordTurnActivity(repo: Repository, userId: string, toolResults: ToolResult[]): Promise<void> {
  try {
    const [actualSessions, recoveryLogs, fuelLogs, memories, priorEvents] = await Promise.all([
      repo.listActualSessions(userId),
      repo.listRecoveryLogs(userId),
      repo.listFuelLogs(userId),
      repo.listMemories(userId),
      repo.listActivityEvents(userId),
    ]);
    const insightsAfter = deriveInsights({ actualSessions, recoveryLogs, fuelLogs, memories });
    const knownInsightTexts = new Set(
      priorEvents
        .filter((e) => e.type === 'insight_formed')
        .map((e) => e.summary.replace(/^Kona(?:'s take| spotted) — /, '')),
    );
    const alreadyAdaptedFrom = new Set(
      priorEvents
        .filter((e) => e.type === 'recommendation_adapted')
        .map((e) => String((e.meta as { from?: string } | undefined)?.from ?? ''))
        .filter(Boolean),
    );
    const adviceProducedThisTurn = toolResults.some(
      (r) => r.ok && (r.tool === 'calculate_fueling_targets' || r.tool === 'save_weekly_plan'),
    );
    const events = deriveTurnEvents({
      userId,
      toolResults,
      knownInsightTexts,
      insightsAfter,
      adviceProducedThisTurn,
      alreadyAdaptedFrom,
    });
    for (const e of events) await repo.appendActivityEvent(e);
  } catch {
    /* activity logging is non-critical */
  }
}

export interface AgentDeps {
  repo: Repository;
  llm: LlmClient;
}

export interface HandleMessageInput {
  userId: string;
  conversationId: string;
  message: string;
  /** Injectable clock for deterministic runs/tests. */
  now?: Date;
}

export interface AgentTurn {
  reply: string;
  intent: string;
  tool_calls: { tool: string; args: Record<string, unknown> }[];
  tool_results: ToolResult[];
  safety: SafetyScreen;
  clarifying_question?: string;
  /** Ids of the two messages this turn appended — used by the edit flow. */
  user_message_id: string;
  assistant_message_id: string;
}

/** Resolve the "$last" arg convention against ids saved earlier this turn. */
function resolveArgs(
  args: Record<string, unknown>,
  memo: { plannedId?: string; actualId?: string },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (v === '$last') {
      out[k] = k.includes('actual') ? memo.actualId : k.includes('planned') ? memo.plannedId : (memo.actualId ?? memo.plannedId);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function handleMessage(deps: AgentDeps, input: HandleMessageInput): Promise<AgentTurn> {
  const { repo, llm } = deps;
  const nowIso = (input.now ?? new Date()).toISOString();

  const userMessage = await repo.appendMessage({
    user_id: input.userId,
    conversation_id: input.conversationId,
    role: 'user',
    content: input.message,
  });

  // Hard safety layer BEFORE the LLM (CALCULATION_ENGINE_SPEC.md §18).
  const safety = screenForEscalation(input.message);
  const context = await buildContext(repo, input.userId, nowIso);

  if (safety.escalate) {
    const reply = safetyMessage(safety.matched);
    const assistantMessage = await repo.appendMessage({
      user_id: input.userId,
      conversation_id: input.conversationId,
      role: 'assistant',
      content: reply,
    });
    return {
      reply,
      intent: 'safety_escalation',
      tool_calls: [],
      tool_results: [],
      safety,
      user_message_id: userMessage.id,
      assistant_message_id: assistantMessage.id,
    };
  }

  const interpretation = await llm.interpret({ message: input.message, context, tools: TOOL_SCHEMAS });

  if (interpretation.clarifying_question || interpretation.tool_calls.length === 0) {
    const reply =
      interpretation.clarifying_question ??
      "Tell me a bit more and I'll help — a planned session, what you actually did, what you ate, or how recovery feels.";
    const assistantMessage = await repo.appendMessage({
      user_id: input.userId,
      conversation_id: input.conversationId,
      role: 'assistant',
      content: reply,
    });
    return {
      reply,
      intent: interpretation.intent,
      tool_calls: [],
      tool_results: [],
      safety,
      clarifying_question: reply,
      user_message_id: userMessage.id,
      assistant_message_id: assistantMessage.id,
    };
  }

  const memo: { plannedId?: string; actualId?: string } = {
    plannedId: context.current_plan?.id,
    actualId: context.last_actual_session?.id,
  };
  const executed: AgentTurn['tool_calls'] = [];
  const results: ToolResult[] = [];

  for (const call of interpretation.tool_calls) {
    const args = resolveArgs(call.args, memo);
    executed.push({ tool: call.tool, args });
    const result = await runTool(call.tool, args, { repo, userId: input.userId });
    results.push(result);
    if (result.ok && result.data && typeof result.data === 'object') {
      const id = (result.data as { id?: string }).id;
      if (id && call.tool === 'save_planned_session') memo.plannedId = id;
      if (id && call.tool === 'save_actual_session') {
        memo.actualId = id;
        // Make the context reflect the plan this actual session was linked to,
        // so the composer can speak about "the plan" accurately even when it
        // isn't the same record as the generic "next upcoming plan".
        const linkedId = (result.data as { planned_session_id?: string }).planned_session_id;
        if (linkedId && linkedId !== context.current_plan?.id) {
          context.current_plan = (await repo.getPlannedSession(linkedId)) ?? context.current_plan;
        }
      }
    }
  }

  const reply = await llm.compose({
    message: input.message,
    context,
    intent: interpretation.intent,
    tool_results: results,
  });

  const assistantMessage = await repo.appendMessage({
    user_id: input.userId,
    conversation_id: input.conversationId,
    role: 'assistant',
    content: reply,
  });

  await recordTurnActivity(repo, input.userId, results);

  return {
    reply,
    intent: interpretation.intent,
    tool_calls: executed,
    tool_results: results,
    safety,
    user_message_id: userMessage.id,
    assistant_message_id: assistantMessage.id,
  };
}
