import { parseGoalDate } from './goal';
import type { Gender, Profile, Sport, TrainingGoal } from './types';

/**
 * Validation for the onboarding / profile form. Pure and framework-free so it
 * can be unit tested and reused by the API route (CLAUDE.md: validate at the
 * boundary).
 *
 * The 2026 reset makes onboarding tiny: only a name and at least one sport are
 * required. Everything else (goal text, weight, bottle size, age, …) is optional
 * and collected progressively in conversation.
 */

/** Endurance-first sports offered in the form (a subset of the full Sport union). */
export const ONBOARDING_SPORTS = [
  'running',
  'cycling',
  'swimming',
  'triathlon',
  'gym',
] as const satisfies readonly Sport[];

export const GENDERS: readonly Gender[] = ['female', 'male', 'nonbinary', 'other', 'prefer_not_to_say'];

export type ProfileFormData = Omit<Profile, 'user_id' | 'known_sweat_data' | 'preferred_product_ids' | 'onboarded_at'>;

export type ProfileValidation = { ok: true; data: ProfileFormData } | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function intInRange(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return undefined;
  return n >= min && n <= max ? n : undefined;
}

function numInRange(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return n >= min && n <= max ? Math.round(n * 10) / 10 : undefined;
}

function parseGoal(v: unknown): TrainingGoal | undefined {
  if (typeof v === 'string') {
    const text = v.trim().slice(0, 200);
    if (!text) return undefined;
    const event_date = parseGoalDate(text);
    return event_date ? { text, event_date } : { text };
  }
  if (isRecord(v) && typeof v.text === 'string' && v.text.trim()) {
    const text = v.text.trim().slice(0, 200);
    const goal: TrainingGoal = { text };
    if (typeof v.event_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.event_date)) {
      goal.event_date = v.event_date;
    } else {
      const parsed = parseGoalDate(text);
      if (parsed) goal.event_date = parsed;
    }
    return goal;
  }
  return undefined;
}

export function validateProfileInput(input: unknown): ProfileValidation {
  if (!isRecord(input)) return { ok: false, error: 'Expected a profile object' };

  const username = typeof input.username === 'string' ? input.username.trim() : '';
  if (username.length < 1 || username.length > 40) {
    return { ok: false, error: 'Username must be 1–40 characters' };
  }

  const rawSports = Array.isArray(input.usual_sports) ? input.usual_sports : [];
  const usual_sports = [...new Set(rawSports)].filter(
    (s): s is Sport => typeof s === 'string' && (ONBOARDING_SPORTS as readonly string[]).includes(s),
  );
  if (usual_sports.length === 0) return { ok: false, error: 'Pick at least one sport' };

  const data: ProfileFormData = { username, usual_sports };

  const goal = parseGoal(input.goal);
  if (goal) data.goal = goal;

  // Everything below is optional — only validated when present.
  if (input.gender !== undefined && input.gender !== '') {
    if (typeof input.gender !== 'string' || !GENDERS.includes(input.gender as Gender)) {
      return { ok: false, error: 'That gender option is not valid' };
    }
    data.gender = input.gender as Gender;
  }

  if (input.age !== undefined && input.age !== '' && input.age !== null) {
    const age = intInRange(input.age, 12, 100);
    if (age === undefined) return { ok: false, error: 'Age must be a whole number between 12 and 100' };
    data.age = age;
  }

  if (input.body_weight_kg !== undefined && input.body_weight_kg !== '' && input.body_weight_kg !== null) {
    const w = numInRange(input.body_weight_kg, 25, 250);
    if (w === undefined) return { ok: false, error: 'Body weight must be between 25 and 250 kg' };
    data.body_weight_kg = w;
  }

  if (input.usual_bottle_ml !== undefined && input.usual_bottle_ml !== '' && input.usual_bottle_ml !== null) {
    const b = intInRange(input.usual_bottle_ml, 100, 3000);
    if (b === undefined) return { ok: false, error: 'Bottle size must be between 100 and 3000 ml' };
    data.usual_bottle_ml = b;
  }

  if (
    input.typical_weekly_sessions !== undefined &&
    input.typical_weekly_sessions !== '' &&
    input.typical_weekly_sessions !== null
  ) {
    const n = intInRange(input.typical_weekly_sessions, 0, 40);
    if (n === undefined) return { ok: false, error: 'Sessions per week must be a whole number between 0 and 40' };
    data.typical_weekly_sessions = n;
  }

  if (typeof input.recent_injuries_note === 'string') {
    const note = input.recent_injuries_note.trim();
    if (note.length > 500) return { ok: false, error: 'Keep the injury note under 500 characters' };
    if (note) data.recent_injuries_note = note;
  }

  return { ok: true, data };
}
