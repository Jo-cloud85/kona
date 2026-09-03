import type { PriorityLevel } from '../domain/types';

/** 0..3 numeric priority used internally; mapped to PriorityLevel on output. */
export type PriorityScore = 0 | 1 | 2 | 3;

const LEVELS: PriorityLevel[] = ['NONE', 'LOW', 'MODERATE', 'HIGH'];

export function clampScore(n: number): PriorityScore {
  if (n <= 0) return 0;
  if (n >= 3) return 3;
  return n as PriorityScore;
}

export function toLevel(score: number): PriorityLevel {
  return LEVELS[clampScore(score)]!;
}

/** Raise `score` to at least `floor`. */
export function atLeast(score: number, floor: PriorityScore): PriorityScore {
  return clampScore(Math.max(score, floor));
}
