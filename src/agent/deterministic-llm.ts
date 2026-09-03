import type {
  ComposeRequest,
  InterpretRequest,
  InterpretResult,
  LlmClient,
  PlannedToolCall,
} from './llm-client.js';
import {
  extractDistanceKm,
  extractDurationMinutes,
  extractIntensity,
  extractReason,
  extractSport,
  parseFuelItems,
  parseRecovery,
  reasonIsPain,
  resolveStartAt,
} from './parse.js';
import { composeResponse } from './responder.js';

/**
 * A deterministic, rule-based stand-in for the conversational LLM.
 *
 * It performs the LLM's two jobs — interpret language into tool calls, and phrase
 * tool results back — without a model, so the whole slice runs and is testable
 * with no API key. A real provider can replace this behind {@link LlmClient}.
 *
 * It still never produces fueling numbers: those come only from
 * `calculate_fueling_targets` results.
 */
export class DeterministicLlmClient implements LlmClient {
  async interpret(req: InterpretRequest): Promise<InterpretResult> {
    const { message, context } = req;
    const text = message.trim();
    const distance = extractDistanceKm(text);
    const duration = extractDurationMinutes(text);

    const looksLikeFuel =
      /\b(gel|gels|bottle|shake|electrolytes?|drink mix|energy bar|chew|chews)\b/i.test(text) ||
      /\b\d+\s?ml\b/i.test(text);
    const futureMarker = /\b(tomorrow|today|tonight|this (evening|morning|afternoon)|planning|going to|gonna|i'?ll|i am doing|i'?m doing)\b/i.test(
      text,
    );
    const modificationMarker = /\b(actually|only|ended up|managed|cut (it|the .*?) short|had to stop|stopped|didn'?t finish|turned back)\b/i.test(
      text,
    );
    const pastWorkoutMarker = /\b(ran|did|rode|cycled|swam|completed|finished|went for)\b/i.test(text);
    const recoveryMarker = /\b(feel|feeling|felt|legs?|sore|soreness|tired|fatigued?|doms|recovery|hip|knee|calf|ache|aching|cramp\w*|slept|sleep)\b/i.test(
      text,
    );

    // 1. Fuel / intake logging
    if (looksLikeFuel && distance === undefined) {
      const items = parseFuelItems(text).map((i) => ({ description: i.description, quantity: i.quantity }));
      const sessionId = context.last_actual_session?.id;
      return {
        intent: 'log_fuel',
        tool_calls: [
          {
            tool: 'log_fuel_intake',
            args: { items, ...(sessionId ? { session_id: sessionId } : {}) },
          },
        ],
        notes: [`Parsed ${items.length} intake item(s).`],
      };
    }

    // 2. Plan a session
    if (distance !== undefined && futureMarker && !modificationMarker) {
      const sport = extractSport(text) ?? 'running';
      const start_at = resolveStartAt(context.now_iso, text);
      const intensity = extractIntensity(text) ?? 'easy';
      const calls: PlannedToolCall[] = [
        {
          tool: 'save_planned_session',
          args: {
            sport,
            start_at,
            distance_km: distance,
            ...(duration ? { duration_minutes: duration } : {}),
            intensity,
          },
        },
        {
          tool: 'calculate_fueling_targets',
          args: { planned_session_id: '$last', phase: 'planning' },
        },
      ];
      return { intent: 'plan_session', tool_calls: calls, notes: [`Planned ${distance}km ${sport} at ${start_at}.`] };
    }

    // 3. Log an actual session (often a modification of the plan)
    if (distance !== undefined && (modificationMarker || pastWorkoutMarker) && !futureMarker) {
      const reason = extractReason(text);
      const pain = reasonIsPain(reason);
      const status = pain
        ? 'stopped_early'
        : /\b(skip|skipped|didn'?t (run|go|do)|couldn'?t start)\b/i.test(text)
          ? 'skipped'
          : 'modified';
      const planDate = context.current_plan?.start_at?.slice(0, 10) ?? context.now_iso.slice(0, 10);
      const sport = extractSport(text) ?? context.current_plan?.sport ?? 'running';

      return {
        intent: 'log_actual',
        tool_calls: [
          {
            tool: 'save_actual_session',
            args: {
              status,
              sport,
              distance_km: distance,
              ...(duration ? { duration_minutes: duration } : {}),
              ...(reason ? { reason } : {}),
              link_to_plan_date: planDate,
            },
          },
          {
            tool: 'calculate_fueling_targets',
            args: {
              actual_session_id: '$last',
              phase: 'post_workout',
              context: {
                ...(pain ? { injury_or_pain: true } : {}),
                ...(reason ? { reason_for_modification: reason } : {}),
              },
            },
          },
        ],
        notes: [reason ? `Reason recorded: ${reason}` : 'No reason given.'],
      };
    }

    // 4. Recovery check-in
    if (recoveryMarker && distance === undefined) {
      const parsed = parseRecovery(text);
      const sessionId = context.last_actual_session?.id;
      return {
        intent: 'recovery_check_in',
        tool_calls: [
          {
            tool: 'save_recovery',
            args: {
              free_text: text,
              overall_severity: parsed.severity,
              ...(parsed.symptoms.length ? { reported_symptoms: parsed.symptoms } : {}),
              ...(parsed.sleep_quality ? { sleep_quality: parsed.sleep_quality } : {}),
              ...(sessionId ? { session_id: sessionId } : {}),
            },
          },
        ],
        notes: [`Recovery severity parsed as ${parsed.severity}.`],
      };
    }

    // 5. Fallback
    return {
      intent: 'clarify',
      tool_calls: [],
      clarifying_question:
        "Tell me a bit more and I'll help — e.g. a session you're planning, what you actually did, what you ate or drank, or how your recovery feels.",
    };
  }

  async compose(req: ComposeRequest): Promise<string> {
    return composeResponse(req);
  }
}
