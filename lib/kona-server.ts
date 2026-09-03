import 'server-only';
import { createSeededRepository, DEMO_USER_ID } from '../src/data/index';
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
 * The repository is the in-memory implementation from the core (M2). That means
 * state lives only in this Node process and resets on server restart — fine for
 * the thin UI milestone; a persistence backend is a separate, later decision.
 */

let repoPromise: ReturnType<typeof createSeededRepository> | undefined;
let llm: LlmClient | undefined;

function getLlm(): LlmClient {
  if (!llm) {
    llm = process.env.ANTHROPIC_API_KEY ? new AnthropicLlmClient() : new DeterministicLlmClient();
  }
  return llm;
}

export function llmName(): string {
  return process.env.ANTHROPIC_API_KEY
    ? `anthropic (${process.env.KONA_LLM_MODEL ?? 'claude-opus-5'})`
    : 'deterministic';
}

async function deps(): Promise<AgentDeps> {
  if (!repoPromise) repoPromise = createSeededRepository();
  return { repo: await repoPromise, llm: getLlm() };
}

export async function sendMessage(conversationId: string, message: string): Promise<AgentTurn> {
  return handleMessage(await deps(), { userId: DEMO_USER_ID, conversationId, message });
}

export async function listMessages(conversationId: string) {
  const { repo } = await deps();
  return repo.listMessages(conversationId);
}
