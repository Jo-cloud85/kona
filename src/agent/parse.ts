import type { Intensity, Sport } from '../domain/types';

/** Natural-language parsing helpers for the deterministic interpreter.
 *  These do NOT compute anything numerical about fueling — they only extract
 *  what the user said (distance, time, sport, reason, food items). */

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function extractDistanceKm(text: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)\s*k(?:m|ilomet\w*)?\b/i.exec(text);
  return m ? Number(m[1]) : undefined;
}

export function extractDurationMinutes(text: string): number | undefined {
  const h = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i.exec(text);
  const min = /(\d+)\s*(?:minutes?|mins?|min)\b/i.exec(text);
  let total = 0;
  if (h) total += Number(h[1]) * 60;
  if (min) total += Number(min[1]);
  return total > 0 ? Math.round(total) : undefined;
}

export function extractTime(text: string): { hh: number; mm: number } | undefined {
  const ampm = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (ampm) {
    let hh = Number(ampm[1]) % 12;
    if (/pm/i.test(ampm[3]!)) hh += 12;
    return { hh, mm: ampm[2] ? Number(ampm[2]) : 0 };
  }
  const at = /\bat\s+(\d{1,2})(?::(\d{2}))?\b/i.exec(text);
  if (at) return { hh: Number(at[1]), mm: at[2] ? Number(at[2]) : 0 };
  return undefined;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Resolve the intended local date/time for a planned session. */
export function resolveStartAt(nowIso: string, text: string): string {
  const now = new Date(nowIso);
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (/\btomorrow\b/i.test(text)) {
    date.setDate(date.getDate() + 1);
  } else if (/\b(today|tonight|this (evening|morning|afternoon))\b/i.test(text)) {
    // keep today
  } else {
    for (let i = 0; i < WEEKDAYS.length; i++) {
      if (new RegExp(`\\b${WEEKDAYS[i]}\\b`, 'i').test(text) || new RegExp(`\\b${WEEKDAYS[i]!.slice(0, 3)}\\b`, 'i').test(text)) {
        let delta = (i - date.getDay() + 7) % 7;
        if (delta === 0) delta = 7;
        date.setDate(date.getDate() + delta);
        break;
      }
    }
  }

  const time = extractTime(text) ?? { hh: 6, mm: 0 };
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(time.hh)}:${pad(time.mm)}:00`;
}

export function extractSport(text: string): Sport | undefined {
  if (/\b(run|running|jog|jogging|ran)\b/i.test(text)) return 'running';
  if (/\b(ride|rode|cycl\w*|bike|biking|spin)\b/i.test(text)) return 'cycling';
  if (/\b(swim|swam|swimming)\b/i.test(text)) return 'swimming';
  if (/\b(gym|weights|strength|lifting|core)\b/i.test(text)) return 'gym';
  return undefined;
}

export function extractIntensity(text: string): Intensity | undefined {
  if (/\b(easy|recovery|z2|zone 2)\b/i.test(text)) return 'easy';
  if (/\b(tempo|threshold|hard|fast|intervals?)\b/i.test(text)) return 'hard';
  if (/\b(moderate|steady)\b/i.test(text)) return 'moderate';
  if (/\b(race|time trial)\b/i.test(text)) return 'race';
  return undefined;
}

/** Text after "because" / "cause" / "as my ...", used as a modification reason. */
export function extractReason(text: string): string | undefined {
  const m = /\b(?:because|cause|coz|cos|as|since)\b\s+(.*)$/i.exec(text);
  if (m) {
    return m[1]!
      .trim()
      .replace(/[.!]+$/, '')
      .replace(/^my\s+/i, '');
  }
  const hurt = /\bmy ([\w\s]+?) (?:hurt|hurts|was hurting|started hurting|was sore|felt sore|was tight)\b/i.exec(text);
  if (hurt) return `${hurt[1]!.trim()} discomfort`;
  return undefined;
}

export function reasonIsPain(reason: string | undefined): boolean {
  if (!reason) return false;
  return /\b(hurt|hurts|pain|painful|sore|soreness|discomfort|injur\w*|strain\w*|pull\w*|ache|aching|tight\w*|cramp\w*)\b/i.test(
    reason,
  );
}

export interface ParsedFuelItem {
  description: string;
  quantity: number;
}

export function parseFuelItems(text: string): ParsedFuelItem[] {
  const stripped = text
    .replace(/^\s*(i\s+)?(just\s+)?(had|ate|drank|took|used|consumed)\b/i, '')
    .replace(/\bduring the (run|ride|swim|session|workout)\b/i, '')
    .trim();

  return stripped
    .split(/\s*(?:,|\+|\band\b|\bplus\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^(my|the|a|an)$/i.test(part))
    .map((part) => {
      const qm = /^(\d+|a|an|one|two|three|four|five|six)\b\s*/i.exec(part);
      let quantity = 1;
      let description = part;
      if (qm) {
        const token = qm[1]!.toLowerCase();
        quantity = /^\d+$/.test(token) ? Number(token) : (WORD_NUMBERS[token] ?? 1);
        description = part.slice(qm[0].length).trim();
      }
      description = description.replace(/^(my|the)\s+/i, '').trim();
      return { description: description || part, quantity };
    });
}

export interface ParsedRecovery {
  severity: 'none' | 'low' | 'moderate' | 'high';
  symptoms: string[];
  sleep_quality?: 'poor' | 'ok' | 'good';
}

export function parseRecovery(text: string): ParsedRecovery {
  const symptoms: string[] = [];
  for (const part of ['legs', 'left hip', 'right hip', 'hip', 'knee', 'calf', 'hamstring', 'back', 'quads', 'shoulders']) {
    if (new RegExp(`\\b${part}\\b`, 'i').test(text)) symptoms.push(part);
  }
  if (/\bcramp\w*\b/i.test(text)) symptoms.push('cramp');

  let severity: ParsedRecovery['severity'] = 'low';
  if (/\b(fine|good|great|fresh|no issues|all good|okay|ok)\b/i.test(text) && !/\bnot (ok|okay|fine|good)\b/i.test(text)) {
    severity = /\btired|sore|heavy|fatigued?\b/i.test(text) ? 'low' : 'none';
  }
  if (/\b(really|very|super|extremely)\s+(sore|tired|fatigued?|bad)\b/i.test(text) || /\b(bad|badly|terrible|rough|wrecked|trashed)\b/i.test(text)) {
    severity = 'moderate';
  }
  if (/\b(limping|can'?t walk|couldn'?t walk|worst|severe)\b/i.test(text)) severity = 'high';

  let sleep: ParsedRecovery['sleep_quality'];
  if (/\b(bad|poor|little|no|terrible)\s+sleep\b/i.test(text) || /\bslept (badly|poorly)\b/i.test(text)) sleep = 'poor';
  else if (/\b(good|great)\s+sleep\b/i.test(text) || /\bslept (well|great)\b/i.test(text)) sleep = 'good';

  return { severity, symptoms, sleep_quality: sleep };
}
