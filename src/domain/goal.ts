import type { TrainingGoal } from './types';

/**
 * Goal helpers. The goal is *context for the assistant*, not a training-plan
 * feature — so this stays deliberately light: parse an event date out of the
 * free-text goal where one is stated, and turn a goal + date into a single
 * ready-to-show line ("11 weeks to your first Olympic-distance triathlon").
 */

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const MONTH_RE = MONTHS.map((m) => `${m}|${m.slice(0, 3)}`).join('|');

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function monthIndex(name: string): number {
  const n = name.toLowerCase();
  return MONTHS.findIndex((m) => m === n || m.slice(0, 3) === n.slice(0, 3));
}
/** Pick the year that keeps the date in the future (this year, else next). */
function futureYear(month: number, day: number, now: Date): number {
  const thisYear = new Date(now.getFullYear(), month, day);
  return thisYear.getTime() >= atMidnight(now).getTime() ? now.getFullYear() : now.getFullYear() + 1;
}
function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Best-effort event date (YYYY-MM-DD) from free text. undefined when none stated. */
export function parseGoalDate(text: string, now: Date = new Date()): string | undefined {
  const t = text.trim();

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // "in N weeks" / "N weeks away"
  const wk = /\b(?:in\s+)?(\d{1,2})\s*weeks?\b/i.exec(t);
  if (wk) {
    const d = atMidnight(now);
    d.setDate(d.getDate() + Number(wk[1]) * 7);
    return ymd(d);
  }

  // "<Month> <day>" or "<day> <Month>" (optionally "on ..."), with optional year
  const md =
    new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`, 'i').exec(t) ??
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})\\b(?:,?\\s*(\\d{4}))?`, 'i').exec(t);
  if (md) {
    const monthStr = /\d/.test(md[1]!) ? md[2]! : md[1]!;
    const dayStr = /\d/.test(md[1]!) ? md[1]! : md[2]!;
    const mi = monthIndex(monthStr);
    const day = Number(dayStr);
    if (mi >= 0 && day >= 1 && day <= 31) {
      const year = md[3] ? Number(md[3]) : futureYear(mi, day, now);
      return ymd(new Date(year, mi, day));
    }
  }

  // bare "in <Month>" (no day) -> the 1st, so we never say "race week" early
  const mOnly = new RegExp(`\\bin\\s+(${MONTH_RE})\\b`, 'i').exec(t);
  if (mOnly) {
    const mi = monthIndex(mOnly[1]!);
    if (mi >= 0) return ymd(new Date(futureYear(mi, 1, now), mi, 1));
  }

  return undefined;
}

/** Strip a trailing "in June" / "on Oct 11" / "(2026-06-14)" date clause. */
function shortGoal(text: string): string {
  let s = text
    .trim()
    .replace(new RegExp(`[,\\s]+(?:on|in|by)\\s+(?:${MONTH_RE})\\b.*$`, 'i'), '')
    .replace(/[,\s]+on\s+\d{4}-\d{2}-\d{2}.*$/i, '')
    .replace(/[,\s]+in\s+\d{1,2}\s*weeks?.*$/i, '')
    .replace(/\s*\(\s*\d{4}-\d{2}-\d{2}\s*\)\s*$/i, '')
    .replace(/[.\s]+$/, '')
    .trim();
  // lowercase a leading article so "your <goal>" reads naturally
  s = s.replace(/^(A|An|The)\b/, (m) => m.toLowerCase());
  return s;
}

export interface GoalContext {
  text: string | null;
  event_date: string | null;
  days_until: number | null;
  weeks_until: number | null;
  /** One ready-to-show line, or null when there's nothing time-relevant to say. */
  phrase: string | null;
}

export function goalContext(goal: TrainingGoal | undefined, now: Date = new Date()): GoalContext {
  if (!goal?.text) {
    return { text: null, event_date: null, days_until: null, weeks_until: null, phrase: null };
  }
  const event_date = goal.event_date ?? parseGoalDate(goal.text, now);
  if (!event_date) {
    return { text: goal.text, event_date: null, days_until: null, weeks_until: null, phrase: null };
  }

  const [y, m, d] = event_date.split('-').map(Number) as [number, number, number];
  const days_until = Math.round((new Date(y, m - 1, d).getTime() - atMidnight(now).getTime()) / 86_400_000);
  const weeks_until = Math.round(days_until / 7);
  const g = shortGoal(goal.text);

  let phrase: string | null;
  if (days_until < 0) phrase = null;
  else if (days_until === 0) phrase = `Race day — ${g}.`;
  else if (days_until <= 7) phrase = `Race week — ${g} in ${days_until} day${days_until === 1 ? '' : 's'}.`;
  else if (days_until <= 21) phrase = `${days_until} days to your ${g}.`;
  else phrase = `${weeks_until} weeks to your ${g}.`;

  return { text: goal.text, event_date, days_until, weeks_until, phrase };
}
