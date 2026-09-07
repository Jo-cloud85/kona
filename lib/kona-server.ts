import 'server-only';
import { InMemoryRepository, DEMO_USER_ID } from '../src/data/index';
import type { Profile } from '../src/domain/types';
import type { ProfileFormData } from '../src/domain/profile-input';
import {
  AnthropicLlmClient,
  DeterministicLlmClient,
  buildStarter,
  handleMessage,
  type AgentDeps,
  type AgentTurn,
  type ChatStarter,
  type LlmClient,
} from '../src/agent/index';

/**
 * Process-wide Kona instance for the web app.
 *
 * The repository is the in-memory implementation from the core (M2). State lives
 * only in this Node process and resets on server restart — fine for now; a
 * persistence backend is a separate, later decision. Unlike the CLI, the web
 * app does NOT seed a demo profile: the user completes onboarding first.
 */

let repo: InMemoryRepository | undefined;
let llm: LlmClient | undefined;

function getRepo(): InMemoryRepository {
  if (!repo) repo = new InMemoryRepository();
  return repo;
}

/** deterministic unless KONA_LLM=anthropic (or an ANTHROPIC_API_KEY is present
 *  and KONA_LLM isn't forced to 'deterministic'). */
function useAnthropic(): boolean {
  const forced = process.env.KONA_LLM;
  if (forced === 'deterministic') return false;
  if (forced === 'anthropic') return true;
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getLlm(): LlmClient {
  if (!llm) {
    llm = useAnthropic() ? new AnthropicLlmClient() : new DeterministicLlmClient();
  }
  return llm;
}

export function llmName(): string {
  return useAnthropic()
    ? `anthropic (${process.env.KONA_LLM_MODEL ?? 'claude-opus-5'})`
    : 'deterministic';
}

function deps(): AgentDeps {
  return { repo: getRepo(), llm: getLlm() };
}

export async function getProfile(): Promise<Profile | undefined> {
  return getRepo().getProfile(DEMO_USER_ID);
}

export async function saveProfile(data: ProfileFormData): Promise<Profile> {
  const existing = await getRepo().getProfile(DEMO_USER_ID);
  return getRepo().upsertProfile({
    ...existing,
    ...data,
    user_id: DEMO_USER_ID,
    onboarded_at: existing?.onboarded_at ?? new Date().toISOString(),
  });
}

export interface SentMessage {
  turn: AgentTurn;
  /** Structured per-session prompts from a weekly-plan / clarify turn, if any. */
  session_prompts: unknown[];
}

export async function sendMessage(conversationId: string, message: string): Promise<SentMessage> {
  const turn = await handleMessage(deps(), { userId: DEMO_USER_ID, conversationId, message });
  let session_prompts: unknown[] = [];
  for (const r of turn.tool_results) {
    const analysis = (r.data as { analysis?: { session_prompts?: unknown[] } } | undefined)?.analysis;
    if (r.ok && Array.isArray(analysis?.session_prompts)) session_prompts = analysis.session_prompts;
  }
  return { turn, session_prompts };
}

export async function listMessages(conversationId: string) {
  return getRepo().listMessages(conversationId);
}

/** The one-time opening message + conversation starters (only meaningful before
 *  the conversation has any messages). Null until the user has onboarded. */
export async function getStarter(): Promise<ChatStarter | null> {
  const profile = await getRepo().getProfile(DEMO_USER_ID);
  return profile?.onboarded_at ? buildStarter(profile) : null;
}
