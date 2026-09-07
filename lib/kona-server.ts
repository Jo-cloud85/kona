import 'server-only';
import { InMemoryRepository, DEMO_USER_ID } from '../src/data/index';
import type { Profile } from '../src/domain/types';
import type { ProfileFormData } from '../src/domain/profile-input';
import {
  AnthropicLlmClient,
  DeterministicLlmClient,
  handleMessage,
  type AgentDeps,
  type AgentTurn,
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

export async function sendMessage(conversationId: string, message: string): Promise<AgentTurn> {
  return handleMessage(deps(), { userId: DEMO_USER_ID, conversationId, message });
}

export async function listMessages(conversationId: string) {
  return getRepo().listMessages(conversationId);
}
