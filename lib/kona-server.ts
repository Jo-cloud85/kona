import 'server-only';
import { InMemoryRepository, DEMO_USER_ID } from '../src/data/index';
import type { Profile } from '../src/domain/types';
import type { ProfileFormData } from '../src/domain/profile-input';
import {
  AnthropicLlmClient,
  DeterministicLlmClient,
  buildCheckinLog,
  buildHome,
  buildKnows,
  buildStarter,
  checkinReflection,
  deriveInsights,
  handleMessage,
  recordTurnActivity,
  screenForEscalation,
  type AgentDeps,
  type AgentTurn,
  type CheckinInput,
  type ChatStarter,
  type HomeView,
  type Insight,
  type KnowsView,
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

/**
 * The real Anthropic model is the shipped conversational path. The deterministic
 * stub is only a fallback — no API key on the box (local dev / CI / offline), or
 * `KONA_LLM=deterministic` set explicitly. It cannot reason over history or feel
 * like a companion; it exists so tests and no-key runs still work.
 */
function useAnthropic(): boolean {
  const forced = process.env.KONA_LLM;
  if (forced === 'deterministic') return false;
  if (forced === 'anthropic') return true;
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getLlm(): LlmClient {
  if (!llm) {
    llm = useAnthropic() ? new AnthropicLlmClient() : new DeterministicLlmClient();
    console.log(`[kona] conversation client: ${llmName()}`);
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

/**
 * Edit-and-regenerate: drop `messageId` and everything after it in the
 * conversation, then re-run the turn with `newText`. NOTE: structured records
 * (saved sessions, memories) created by the removed turn(s) are NOT rolled back
 * — the transcript and Kona's replies are corrected, not the side effects.
 */
export async function editMessage(
  conversationId: string,
  messageId: string,
  newText: string,
): Promise<SentMessage> {
  await getRepo().deleteMessagesFrom(conversationId, messageId);
  return sendMessage(conversationId, newText);
}

export async function listConversations() {
  return getRepo().listConversations(DEMO_USER_ID);
}

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getInsights(): Promise<Insight[]> {
  const repo = getRepo();
  const [actualSessions, recoveryLogs, fuelLogs, memories] = await Promise.all([
    repo.listActualSessions(DEMO_USER_ID),
    repo.listRecoveryLogs(DEMO_USER_ID),
    repo.listFuelLogs(DEMO_USER_ID),
    repo.listMemories(DEMO_USER_ID),
  ]);
  return deriveInsights({ actualSessions, recoveryLogs, fuelLogs, memories });
}

export async function getKnows(): Promise<KnowsView | null> {
  const repo = getRepo();
  const profile = await repo.getProfile(DEMO_USER_ID);
  if (!profile?.onboarded_at) return null;
  const [memories, actualSessions, recoveryLogs, fuelLogs, events] = await Promise.all([
    repo.listMemories(DEMO_USER_ID),
    repo.listActualSessions(DEMO_USER_ID),
    repo.listRecoveryLogs(DEMO_USER_ID),
    repo.listFuelLogs(DEMO_USER_ID),
    repo.listActivityEvents(DEMO_USER_ID, 40),
  ]);
  return buildKnows({ profile, memories, actualSessions, recoveryLogs, fuelLogs, events });
}

export async function getHome(selectedDate?: string): Promise<HomeView | null> {
  const repo = getRepo();
  const profile = await repo.getProfile(DEMO_USER_ID);
  if (!profile?.onboarded_at) return null;
  const [weeklyPlans, actualSessions, recoveryLogs, fuelLogs, memories] = await Promise.all([
    repo.listWeeklyPlans(DEMO_USER_ID),
    repo.listActualSessions(DEMO_USER_ID),
    repo.listRecoveryLogs(DEMO_USER_ID),
    repo.listFuelLogs(DEMO_USER_ID),
    repo.listMemories(DEMO_USER_ID),
  ]);
  const weeklyPlan = weeklyPlans.at(-1);
  const sessions = weeklyPlan ? await repo.listPlannedSessionsForWeeklyPlan(weeklyPlan.id) : [];
  const today = ymdLocal(new Date());
  const checkinDoneToday = recoveryLogs.some((l) => ymdLocal(new Date(l.logged_at)) === today);
  return buildHome({
    profile,
    weeklyPlan,
    sessions,
    selectedDate,
    checkinDoneToday,
    actualSessions,
    recoveryLogs,
    fuelLogs,
    memories,
  });
}

export interface CheckinResult {
  ok: true;
  escalated: boolean;
  reflection: string;
}

export async function submitCheckin(input: CheckinInput): Promise<CheckinResult | null> {
  const repo = getRepo();
  const profile = await repo.getProfile(DEMO_USER_ID);
  if (!profile?.onboarded_at) return null;

  const log = buildCheckinLog(input);
  const screen = screenForEscalation(log.free_text);
  await repo.saveRecoveryLog({
    user_id: DEMO_USER_ID,
    free_text: log.free_text,
    overall_severity: log.overall_severity,
    reported_symptoms: log.reported_symptoms,
  });
  await repo.appendActivityEvent({ user_id: DEMO_USER_ID, type: 'checkin_done', summary: 'You did an end-of-day check-in' });
  await recordTurnActivity(repo, DEMO_USER_ID, []); // insight-detection pass only
  return { ok: true, escalated: screen.escalate, reflection: checkinReflection(input, screen) };
}

/** The one-time opening message + conversation starters (only meaningful before
 *  the conversation has any messages). Null until the user has onboarded. */
export async function getStarter(): Promise<ChatStarter | null> {
  const profile = await getRepo().getProfile(DEMO_USER_ID);
  return profile?.onboarded_at ? buildStarter(profile) : null;
}
