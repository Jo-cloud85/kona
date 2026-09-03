import type { Profile } from '../domain/types.js';
import { InMemoryRepository, type InMemoryRepositoryOptions } from './in-memory-repository.js';

export const DEMO_USER_ID = 'user_demo';

/**
 * The demo athlete from ARCHITECTURE.md's context-package example: 64 kg,
 * cross-trains, 750 ml bottle, usual SIS gel, usual 24 g protein shake.
 * No measured sweat data — so the engine must stay in reference-range mode.
 */
export function demoProfile(): Profile {
  return {
    user_id: DEMO_USER_ID,
    body_weight_kg: 64,
    usual_sports: ['running', 'cycling', 'swimming', 'gym'],
    usual_bottle_ml: 750,
    typical_weekly_sessions: 6,
    preferred_product_ids: ['sis-go-isotonic-gel', 'protein-shake-24g'],
  };
}

export async function createSeededRepository(
  opts: InMemoryRepositoryOptions = {},
): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository(opts);
  await repo.upsertProfile(demoProfile());
  return repo;
}
