import 'server-only';
import type { Repository } from '../src/data/repository';
import { InMemoryRepository } from '../src/data/in-memory-repository';
import { SupabaseRepository } from '../src/data/supabase-repository';
import { AnthropicLlmClient, DeterministicLlmClient, type LlmClient } from '../src/agent/index';
import { createSupabaseServerClient } from './supabase/server';
import { isPersistenceConfigured, isProduction } from './supabase/env';

/**
 * Resolves the per-request execution context: which repository, which user, and
 * the shared LLM client.
 *
 *  - Supabase configured  → real auth. A signed-in user gets a
 *    {@link SupabaseRepository} bound to their session (RLS enforced). No user
 *    → 401.
 *  - Supabase NOT configured → dev-only fallback: a process-wide
 *    {@link InMemoryRepository} and one fixed local user, no auth. Refused when
 *    NODE_ENV=production so a misconfigured deploy fails loudly instead of
 *    silently running single-user without persistence.
 */

/** Fixed user id for the no-Supabase dev fallback. A UUID so it matches the prod shape. */
export const LOCAL_DEV_USER_ID = '00000000-0000-0000-0000-000000000001';

export interface KonaContext {
  repo: Repository;
  userId: string;
  llm: LlmClient;
  /** true when backed by Supabase; false for the in-memory dev fallback. */
  persistent: boolean;
}

export type ContextResult = { ok: true; ctx: KonaContext } | { ok: false; status: number; error: string };

// --- LLM client (stateless, safe to share across requests) ----------------
let llmSingleton: LlmClient | undefined;

function useAnthropic(): boolean {
  const forced = process.env.KONA_LLM;
  if (forced === 'deterministic') return false;
  if (forced === 'anthropic') return true;
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function llmName(): string {
  return useAnthropic() ? `anthropic (${process.env.KONA_LLM_MODEL ?? 'claude-opus-5'})` : 'deterministic';
}

function getLlm(): LlmClient {
  if (!llmSingleton) {
    llmSingleton = useAnthropic() ? new AnthropicLlmClient() : new DeterministicLlmClient();
    console.log(`[kona] conversation client: ${llmName()}`);
  }
  return llmSingleton;
}

// --- dev fallback repo ---------------------------------------------------
let devRepo: InMemoryRepository | undefined;
let warnedDev = false;

function devContext(): ContextResult {
  if (isProduction()) {
    return { ok: false, status: 500, error: 'Persistence is not configured (NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY).' };
  }
  if (!warnedDev) {
    console.warn(
      '[kona] PERSISTENCE DISABLED — no Supabase env. Running in-memory as a single local user; state resets on restart.',
    );
    warnedDev = true;
  }
  if (!devRepo) devRepo = new InMemoryRepository();
  return { ok: true, ctx: { repo: devRepo, userId: LOCAL_DEV_USER_ID, llm: getLlm(), persistent: false } };
}

export async function getServerContext(): Promise<ContextResult> {
  if (!isPersistenceConfigured()) return devContext();

  const sb = await createSupabaseServerClient();
  if (!sb) return { ok: false, status: 500, error: 'Supabase client could not be created.' };

  const {
    data: { user },
    error,
  } = await sb.auth.getUser();
  if (error || !user) return { ok: false, status: 401, error: 'Not signed in.' };

  return { ok: true, ctx: { repo: new SupabaseRepository(sb), userId: user.id, llm: getLlm(), persistent: true } };
}
