import type { RecoverySeverity } from '../domain/types';
import { parseRecovery } from './parse';
import type { SafetyScreen } from './safety';

/**
 * End-of-day check-in — a short structured "how did today go?". It is stored as
 * a normal recovery log (the user's answers become the free-text record) and
 * runs through the same safety screen as any recovery message. Kona does not
 * diagnose: a concerning elaboration is pointed at professional care.
 */

export interface CheckinInput {
  /** One of the humorous feel options, e.g. "Dying...". Free text is tolerated. */
  workout_feel: string;
  went_as_planned: boolean;
  pains: boolean;
  elaborate?: string;
}

export interface CheckinLog {
  free_text: string;
  overall_severity: RecoverySeverity;
  reported_symptoms?: string[];
}

const SEVERITY_ORDER: RecoverySeverity[] = ['none', 'low', 'moderate', 'high'];

const FEEL_SEVERITY: Record<string, RecoverySeverity> = {
  'feeling great!': 'none',
  'breezed it': 'none',
  'solid grind': 'low',
  survived: 'low',
  'dying...': 'moderate',
  "didn't happen": 'none',
};

function maxSeverity(a: RecoverySeverity, b: RecoverySeverity): RecoverySeverity {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

export function buildCheckinLog(input: CheckinInput): CheckinLog {
  const feel = input.workout_feel.trim();
  const elaborate = (input.elaborate ?? '').trim();

  const parts = [
    `End-of-day check-in — workout felt: "${feel}".`,
    `Went as planned: ${input.went_as_planned ? 'yes' : 'no'}.`,
    `Injuries / cramps / pains: ${input.pains ? 'yes' : 'no'}.`,
  ];
  if (elaborate) parts.push(`Notes: ${elaborate}`);
  const free_text = parts.join(' ');

  const parsed = parseRecovery(elaborate || feel);
  let severity: RecoverySeverity = FEEL_SEVERITY[feel.toLowerCase()] ?? 'low';
  if (input.pains) severity = maxSeverity(severity, 'moderate');
  severity = maxSeverity(severity, parsed.severity);

  const symptoms = input.pains && parsed.symptoms.length === 0 ? ['unspecified'] : parsed.symptoms;

  return {
    free_text,
    overall_severity: severity,
    ...(symptoms.length ? { reported_symptoms: symptoms } : {}),
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

  const feel = input.workout_feel.toLowerCase();
  const opener = /great|breez/.test(feel)
    ? 'Nice — sounds like that went well.'
    : /dying|didn'?t happen/.test(feel)
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
