import type { RecoverySeverity } from '../domain/types';
import { parseRecovery } from './parse';
import type { SafetyScreen } from './safety';

/**
 * End-of-day check-in — a short structured "how did today go?". It is stored as
 * a normal recovery log (the user's answers become the free-text record) and
 * runs through the same safety screen as any recovery message. Kona does not
 * diagnose: a concerning elaboration is pointed at professional care.
 *
 * M27: "legs" (fresh/normal/heavy) replaces the earlier 6-option humor scale
 * (workout_feel) — more literal, still a single tap, and reads less like a
 * gimmick. Sleep and mood are new, optional questions; `category` +
 * `recommendation_outcome` are now recorded as their own structured fields
 * (see RecoveryLog) instead of only living in free_text prose, so the
 * "Kona learned" detector (insights.ts) can count outcomes per advice
 * category directly rather than re-parsing English this file wrote itself.
 */

export interface CheckinInput {
  legs: 'fresh' | 'normal' | 'heavy';
  went_as_planned: boolean;
  pains: boolean;
  sleep_quality?: 'poor' | 'ok' | 'good';
  mood?: 'low' | 'ok' | 'good';
  elaborate?: string;
  /** M24.5 — closes the loop on a Kona Briefing recommendation. Only asked
   *  (and only meaningful) when Home actually gave a real, evidence-backed
   *  action for today — see the `konaBriefing` prop threaded through
   *  CheckinDialog. Undefined when the question wasn't shown at all. */
  followed_recommendation?: boolean;
  /** Only meaningful when `followed_recommendation` is true. */
  recommendation_outcome?: 'better' | 'worse' | 'same';
  /** `KonaBriefing.category` for whichever call was shown — only meaningful
   *  when `followed_recommendation` is set. */
  category?: string;
}

export interface CheckinLog {
  free_text: string;
  overall_severity: RecoverySeverity;
  reported_symptoms?: string[];
  sleep_quality?: 'poor' | 'ok' | 'good';
  mood?: 'low' | 'ok' | 'good';
  followed_category?: string;
  followed_outcome?: 'better' | 'worse' | 'same';
  went_as_planned: boolean;
}

const SEVERITY_ORDER: RecoverySeverity[] = ['none', 'low', 'moderate', 'high'];

const LEGS_SEVERITY: Record<CheckinInput['legs'], RecoverySeverity> = {
  fresh: 'none',
  normal: 'low',
  heavy: 'moderate',
};

function maxSeverity(a: RecoverySeverity, b: RecoverySeverity): RecoverySeverity {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

export function buildCheckinLog(input: CheckinInput): CheckinLog {
  const elaborate = (input.elaborate ?? '').trim();

  const parts = [
    `End-of-day check-in — legs felt ${input.legs}.`,
    `Went as planned: ${input.went_as_planned ? 'yes' : 'no'}.`,
    `Injuries / cramps / pains: ${input.pains ? 'yes' : 'no'}.`,
  ];
  if (input.sleep_quality) parts.push(`Sleep: ${input.sleep_quality}.`);
  if (input.mood) parts.push(`Mood: ${input.mood}.`);
  if (elaborate) parts.push(`Notes: ${elaborate}`);
  // Closes the loop on a Kona Briefing recommendation (M24.5). Phrasing is
  // deliberate, not incidental: it's chosen to trip insights.ts's existing
  // positiveFeel / TROUBLE_RE wording, so the NEXT similarSessionFlag lookup
  // for a comparable session reads this outcome the same way it reads any
  // other recovery note — no change needed to insights.ts's input surface.
  let followed_category: string | undefined;
  let followed_outcome: CheckinInput['recommendation_outcome'];
  if (input.followed_recommendation === true) {
    const outcome =
      input.recommendation_outcome === 'worse'
        ? 'but it still felt rough'
        : input.recommendation_outcome === 'better'
          ? 'and it went well'
          : 'about the same as usual, no issues';
    parts.push(`Followed Kona's earlier suggestion for today's session — ${outcome}.`);
    followed_category = input.category;
    followed_outcome = input.recommendation_outcome;
  } else if (input.followed_recommendation === false) {
    parts.push("Did not follow Kona's earlier suggestion for today's session.");
  }
  const free_text = parts.join(' ');

  const parsed = parseRecovery(elaborate || input.legs);
  let severity: RecoverySeverity = LEGS_SEVERITY[input.legs] ?? 'low';
  if (input.pains) severity = maxSeverity(severity, 'moderate');
  severity = maxSeverity(severity, parsed.severity);

  const symptoms = input.pains && parsed.symptoms.length === 0 ? ['unspecified'] : parsed.symptoms;

  return {
    free_text,
    overall_severity: severity,
    went_as_planned: input.went_as_planned,
    ...(symptoms.length ? { reported_symptoms: symptoms } : {}),
    ...(input.sleep_quality ? { sleep_quality: input.sleep_quality } : {}),
    ...(input.mood ? { mood: input.mood } : {}),
    ...(followed_category ? { followed_category } : {}),
    ...(followed_outcome ? { followed_outcome } : {}),
  };
}

/** A short, non-diagnostic reflection for the check-in popup. */
export function checkinReflection(input: CheckinInput, screen: SafetyScreen): string {
  if (screen.escalate) {
    return (
      "That's outside what a training-fueling companion should weigh in on — please get it checked by a medical " +
      "professional, and seek urgent care if it's severe or getting worse. Tell me in chat once you're okay and " +
      "we'll pick the fueling back up."
    );
  }

  const opener =
    input.legs === 'fresh'
      ? 'Nice — sounds like that went well.'
      : input.legs === 'heavy'
        ? 'Sounds like a tough one.'
        : 'Got it.';

  let next: string;
  if (input.pains) {
    next =
      "Noting the aches. If it's sharp, not improving, or painful to load, get it looked at — and tell me in chat " +
      "what happened so I can ease the next session.";
  } else if (!input.went_as_planned) {
    next = "The plan shifted — tell me in chat what you actually did and I'll compare it against the plan.";
  } else {
    next = 'Recovery looks on track. Ask me in chat if you want the next session adjusted.';
  }
  return `${opener} ${next}`;
}
