import type { RulesConfig } from './types.js';
import { RULES_V0_1_0 } from './v0_1_0.js';

export type { RulesConfig } from './types.js';

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
