import type { Repository } from '../data/repository';
import { buildContext } from './context';
import type { LlmClient, ToolResult } from './llm-client';
import { safetyMessage, screenForEscalation, type SafetyScreen } from './safety';
import { runTool, TOOL_SCHEMAS } from './tools';

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

  await repo.appendMessage({ conversation_id: input.conversationId, role: 'user', content: input.message });

  // Hard safety layer BEFORE the LLM (CALCULATION_ENGINE_SPEC.md §18).
  const safety = screenForEscalation(input.message);
  const context = await buildContext(repo, input.userId, nowIso);

  if (safety.escalate) {
    const reply = safetyMessage(safety.matched);
    await repo.appendMessage({ conversation_id: input.conversationId, role: 'assistant', content: reply });
    return { reply, intent: 'safety_escalation', tool_calls: [], tool_results: [], safety };
  }

  const interpretation = await llm.interpret({ message: input.message, context, tools: TOOL_SCHEMAS });

  if (interpretation.clarifying_question || interpretation.tool_calls.length === 0) {
    const reply =
      interpretation.clarifying_question ??
      "Tell me a bit more and I'll help — a planned session, what you actually did, what you ate, or how recovery feels.";
    await repo.appendMessage({ conversation_id: input.conversationId, role: 'assistant', content: reply });
    return {
      reply,
      intent: interpretation.intent,
      tool_calls: [],
      tool_results: [],
      safety,
      clarifying_question: reply,
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

  await repo.appendMessage({ conversation_id: input.conversationId, role: 'assistant', content: reply });

  return { reply, intent: interpretation.intent, tool_calls: executed, tool_results: results, safety };
}
