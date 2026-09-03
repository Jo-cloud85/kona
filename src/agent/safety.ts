/**
 * Hard safety layer that runs BEFORE and independently of the LLM
 * (CALCULATION_ENGINE_SPEC.md §18, PRODUCT_VISION.md "Safety", AGENT_SPEC.md).
 *
 * Kona must not diagnose. When a message contains a red-flag symptom, the normal
 * fueling-advice flow is skipped and the user is directed to appropriate
 * professional medical care.
 */

export interface SafetyScreen {
  escalate: boolean;
  matched: string[];
}

// Conservative, high-signal phrases only. Everyday soreness ("legs tired",
// "hip a bit sore") must NOT match.
const RED_FLAGS: { label: string; pattern: RegExp }[] = [
  { label: 'chest pain', pattern: /\bchest (pain|tightness|pressure)\b/i },
  { label: 'fainting / loss of consciousness', pattern: /\b(faint(ed|ing)?|passed out|black(ed)? out|lost consciousness)\b/i },
  { label: 'severe or worsening dizziness', pattern: /\b(severe|really bad|worsening)\b.{0,20}\bdizz/i },
  { label: 'confusion', pattern: /\b(confused|disoriented|can't think straight)\b/i },
  { label: 'severe shortness of breath', pattern: /\b(can'?t breathe|struggling to breathe|severe(ly)? short of breath)\b/i },
  { label: 'repeated vomiting / cannot keep fluids down', pattern: /\b(can'?t keep (any )?(fluids?|water|anything) down|keep(s)? vomiting|throwing up repeatedly)\b/i },
  { label: 'severe or persistent pain', pattern: /\b(severe|excruciating|unbearable)\b.{0,15}\bpain\b/i },
  { label: 'suspected significant injury', pattern: /\b(can'?t (walk|put weight)|heard a pop|swollen and can'?t)\b/i },
  { label: 'numbness', pattern: /\b(numbness|no feeling in|can'?t feel my)\b/i },
];

export function screenForEscalation(text: string): SafetyScreen {
  const matched = RED_FLAGS.filter((f) => f.pattern.test(text)).map((f) => f.label);
  return { escalate: matched.length > 0, matched };
}

export function safetyMessage(matched: string[]): string {
  const list = matched.join(', ');
  return (
    `That sounds like something to take seriously${list ? ` (${list})` : ''}. ` +
    `This is outside what a training-fueling companion should advise on — please get it checked by a medical professional, ` +
    `and seek urgent care if it's severe or getting worse. ` +
    `I can pick the fueling side back up once you're okay.`
  );
}
