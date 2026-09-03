import type {
  ComposeRequest,
  InterpretRequest,
  InterpretResult,
  LlmClient,
  PlannedToolCall,
} from './llm-client';
import {
  dateForWeekday,
  extractDistanceKm,
  extractDurationMinutes,
  extractIntensity,
  extractReason,
  extractSport,
  parseClarificationAnswer,
  parseFuelItems,
  parsePerceivedIntensity,
  parseRecovery,
  parseWeeklyPlan,
  reasonIsPain,
  resolveStartAt,
  resolveWeekStart,
} from './parse';
import { composeResponse } from './responder';

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

    // 1.5 Answering a question about an under-specified session in the saved week
    const strongModification =
      /\b(actually|only|ended up|instead|stopped|cut (it|the .*?) short|had to stop|didn'?t finish|turned back)\b/i.test(
        text,
      );
    const pd = context.pending_plan_details;
    if (pd && !futureMarker && !strongModification) {
      const pendingSports = new Set(pd.groups.map((g) => g.sport));
      const hasAnswerSignal =
        /\d/.test(text) ||
        /\b(easy|moderate|hard|tempo|steady|comfortable|panting?|sweat\w*|gasping|brutal|chatty)\b/i.test(text);

      // Per-day answer ("Sunday's long run is 22km, and the Saturday swim is 2km").
      const spans = parseWeeklyPlan(text);
      const spansMatchPending =
        spans.length >= 1 &&
        spans.every((d) => d.rest || d.sessions.every((s) => pendingSports.has(s.sport)));

      if (hasAnswerSignal && spansMatchPending) {
        const calls: PlannedToolCall[] = [];
        for (const day of spans) {
          for (const s of day.sessions) {
            const eff = parsePerceivedIntensity(s.raw) ?? s.intensity;
            const dur = extractDurationMinutes(s.raw);
            if (!eff && dur === undefined && s.distance_km === undefined) continue;
            calls.push({
              tool: 'update_planned_sessions',
              args: {
                week_start: pd.week_start,
                day_index: day.day_index,
                sport: s.sport,
                ...(eff ? { intensity: eff } : {}),
                ...(dur !== undefined ? { duration_minutes: dur } : {}),
                ...(s.distance_km !== undefined ? { distance_km: s.distance_km } : {}),
              },
            });
          }
        }
        if (calls.length) {
          return { intent: 'clarify_plan_detail', tool_calls: calls, notes: [`Filling ${calls.length} session(s).`] };
        }
      }

      // Whole-group answer ("the gym sessions are hard, about an hour").
      if (hasAnswerSignal && spans.length < 2) {
        const ans = parseClarificationAnswer(text);
        const hasDetail =
          ans.intensity !== undefined || ans.duration_minutes !== undefined || ans.distance_km !== undefined;
        if (hasDetail) {
          const sportFilter = ans.sport ?? (pd.groups.length === 1 ? pd.groups[0]!.sport : undefined);
          return {
            intent: 'clarify_plan_detail',
            tool_calls: [
              {
                tool: 'update_planned_sessions',
                args: {
                  week_start: pd.week_start,
                  ...(sportFilter ? { sport: sportFilter } : {}),
                  ...(ans.day_index !== undefined ? { day_index: ans.day_index } : {}),
                  ...(ans.intensity ? { intensity: ans.intensity } : {}),
                  ...(ans.duration_minutes !== undefined ? { duration_minutes: ans.duration_minutes } : {}),
                  ...(ans.distance_km !== undefined ? { distance_km: ans.distance_km } : {}),
                },
              },
            ],
            notes: [`Filling in plan detail for ${sportFilter ?? 'pending sessions'}.`],
          };
        }
      }
    }

    // 2a. Plan a whole week (several weekday names, each with a session or rest)
    if (!modificationMarker) {
      const week = parseWeeklyPlan(text);
      if (week.length >= 2) {
        const weekStart = resolveWeekStart(context.now_iso, text);
        const days = week.map((day) => ({
          date: dateForWeekday(weekStart, day.day_index),
          rest: day.rest,
          sessions: day.sessions.map((s) => ({
            sport: s.sport,
            ...(s.distance_km !== undefined ? { distance_km: s.distance_km } : {}),
            ...(s.intensity ? { intensity: s.intensity } : {}),
            ...(s.is_long ? { is_long: true } : {}),
          })),
        }));
        return {
          intent: 'plan_week',
          tool_calls: [
            { tool: 'save_weekly_plan', args: { week_start: weekStart, source_text: text, days } },
          ],
          notes: [`Parsed ${week.length} day(s) for week starting ${weekStart}.`],
        };
      }
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
