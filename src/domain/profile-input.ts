import type { Gender, Profile, Sport } from './types';

/**
 * Validation for the onboarding form. Pure and framework-free so it can be unit
 * tested and reused by the API route. Validates external input at the boundary
 * (CLAUDE.md "Validate external/user input at boundaries").
 */

/** Sports offered in the onboarding form (a subset of the full Sport union). */
export const ONBOARDING_SPORTS = ['running', 'swimming', 'cycling', 'gym', 'climbing'] as const satisfies readonly Sport[];

export const GENDERS: readonly Gender[] = ['female', 'male', 'nonbinary', 'other', 'prefer_not_to_say'];

export type ProfileFormData = Omit<Profile, 'user_id' | 'known_sweat_data' | 'preferred_product_ids' | 'onboarded_at'>;

export type ProfileValidation =
  | { ok: true; data: ProfileFormData }
  | { ok: false; error: string };

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

export function validateProfileInput(input: unknown): ProfileValidation {
  if (!isRecord(input)) return { ok: false, error: 'Expected a profile object' };

  const username = typeof input.username === 'string' ? input.username.trim() : '';
  if (username.length < 1 || username.length > 40) {
    return { ok: false, error: 'Username must be 1–40 characters' };
  }

  const gender = input.gender;
  if (typeof gender !== 'string' || !GENDERS.includes(gender as Gender)) {
    return { ok: false, error: 'Please choose a gender option' };
  }

  const age = intInRange(input.age, 12, 100);
  if (age === undefined) return { ok: false, error: 'Age must be a whole number between 12 and 100' };

  const body_weight_kg = numInRange(input.body_weight_kg, 25, 250);
  if (body_weight_kg === undefined) {
    return { ok: false, error: 'Body weight must be between 25 and 250 kg' };
  }

  const rawSports = Array.isArray(input.usual_sports) ? input.usual_sports : [];
  const usual_sports = [...new Set(rawSports)].filter(
    (s): s is Sport => typeof s === 'string' && (ONBOARDING_SPORTS as readonly string[]).includes(s),
  );
  if (usual_sports.length === 0) return { ok: false, error: 'Pick at least one type of workout' };

  const typical_weekly_sessions = intInRange(input.typical_weekly_sessions, 0, 40);
  if (typical_weekly_sessions === undefined) {
    return { ok: false, error: 'Sessions per week must be a whole number between 0 and 40' };
  }

  const noteRaw = typeof input.recent_injuries_note === 'string' ? input.recent_injuries_note.trim() : '';
  if (noteRaw.length > 500) return { ok: false, error: 'Keep the injury note under 500 characters' };

  const p = isRecord(input.self_perception) ? input.self_perception : {};
  const sleep_quality = intInRange(p.sleep_quality, 1, 5);
  const hydration = intInRange(p.hydration, 1, 5);
  const sweat_level = intInRange(p.sweat_level, 1, 5);
  if (sleep_quality === undefined || hydration === undefined || sweat_level === undefined) {
    return { ok: false, error: 'Rate sleep, hydration and sweat level from 1 to 5' };
  }

  return {
    ok: true,
    data: {
      username,
      gender: gender as Gender,
      age,
      body_weight_kg,
      usual_sports,
      typical_weekly_sessions,
      ...(noteRaw ? { recent_injuries_note: noteRaw } : {}),
      self_perception: { sleep_quality, hydration, sweat_level },
    },
  };
}
