import type { RulesConfig } from './types';
import { RULES_V0_1_0 } from './v0_1_0';
import { DAILY_RULES, type DailyRules } from './daily_v0_2_0';

export type { RulesConfig } from './types';
export type { DailyRules, ActivityLevel } from './daily_v0_2_0';

/** The daily-nutrition methodology table (separate version line from the engine). */
export function getDailyRules(): DailyRules {
  return DAILY_RULES;
}

/** Registry of every published methodology version. */
const REGISTRY: Record<string, RulesConfig> = {
  '0.1.0': RULES_V0_1_0,
};

export const LATEST_METHODOLOGY_VERSION = '0.1.0';

/**
 * Resolve a rules table by methodology version. Defaults to the latest published
 * version. Throws for an unknown version rather than silently falling back.
 */
export function getRules(version: string = LATEST_METHODOLOGY_VERSION): RulesConfig {
  const rules = REGISTRY[version];
  if (!rules) {
    throw new Error(`Unknown calculation methodology version: ${version}`);
  }
  return rules;
}
