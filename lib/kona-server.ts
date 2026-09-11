import 'server-only';
import type { Profile } from '../src/domain/types';
import type { EditReconciliation } from '../src/data/index';
import type { ProfileFormData } from '../src/domain/profile-input';
import {
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
} from '../src/agent/index';
import type { KonaContext } from './server-context';

export { llmName } from './server-context';

/**
 * Web-app use-cases. Each takes the resolved {@link KonaContext} (repo + userId +
 * llm) so every read/write is scoped to the authenticated user. No module-level
 * user identity — that lives in the request context now (M23).
 */

function deps(ctx: KonaContext): AgentDeps {
  return { repo: ctx.repo, llm: ctx.llm };
}

export async function getProfile(ctx: KonaContext): Promise<Profile | undefined> {
  return ctx.repo.getProfile(ctx.userId);
}

export async function saveProfile(ctx: KonaContext, data: ProfileFormData): Promise<Profile> {
  const existing = await ctx.repo.getProfile(ctx.userId);
  return ctx.repo.upsertProfile({
    ...existing,
    ...data,
    user_id: ctx.userId,
    onboarded_at: existing?.onboarded_at ?? new Date().toISOString(),
  });
}

export interface SentMessage {
  turn: AgentTurn;
  /** Structured per-session prompts from a weekly-plan / clarify turn, if any. */
  session_prompts: unknown[];
  /** For an edit: what reconciling the replaced turn(s) removed/repaired (M23.1). */
  reconciled?: EditReconciliation;
}

export async function sendMessage(ctx: KonaContext, conversationId: string, message: string): Promise<SentMessage> {
  const turn = await handleMessage(deps(ctx), { userId: ctx.userId, conversationId, message });
  let session_prompts: unknown[] = [];
  for (const r of turn.tool_results) {
    const analysis = (r.data as { analysis?: { session_prompts?: { in_focus?: boolean }[] } } | undefined)?.analysis;
    if (r.ok && Array.isArray(analysis?.session_prompts)) {
      // Only surface the 1–2 sessions Kona is chasing now — the rest are
      // deferred (M21). Fall back to all if nothing is flagged.
      const focus = analysis.session_prompts.filter((p) => p.in_focus);
      session_prompts = focus.length ? focus : analysis.session_prompts;
    }
  }
  return { turn, session_prompts };
}

export async function listMessages(ctx: KonaContext, conversationId: string) {
  return ctx.repo.listMessages(ctx.userId, conversationId);
}

/**
 * Edit-and-regenerate (M23.1). In order:
 *  1. find the ids of the edited message + everything after it,
 *  2. reconcile the structured records those turns created — delete the
 *     sessions / fuel / recovery / weekly plans / memories / activity events
 *     stamped with those message ids, and null any dangling foreign key on a
 *     surviving record (a later record is kept, only its link to a now-gone
 *     record is cut),
 *  3. delete the messages,
 *  4. re-run the turn with `newText`; the regenerated turn's records get the
 *     NEW message id as their origin.
 *
 * DELIBERATE LIMITATIONS (documented — ARCHITECTURE.md §6b):
 *  - A memory the edited turn *updated* (rather than first created) reverts to
 *    unset, not to its earlier value — there is no memory revision history.
 *  - Profile facts set via chat (body weight, bottle, goal) are one row per
 *    user with no per-fact provenance, so they are not reverted by an edit.
 *  - A plan *field update* (`update_planned_sessions`) is not reverted; only
 *    records the turn *created* are.
 */
export async function editMessage(
  ctx: KonaContext,
  conversationId: string,
  messageId: string,
  newText: string,
): Promise<SentMessage> {
  const removedIds = await ctx.repo.listMessageIdsFrom(ctx.userId, conversationId, messageId);
  const reconciled = await ctx.repo.deleteRecordsForMessages(ctx.userId, removedIds);
  await ctx.repo.deleteMessagesFrom(ctx.userId, conversationId, messageId);
  const sent = await sendMessage(ctx, conversationId, newText);
  return { ...sent, reconciled };
}

export async function listConversations(ctx: KonaContext) {
  return ctx.repo.listConversations(ctx.userId);
}

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getInsights(ctx: KonaContext): Promise<Insight[]> {
  const [actualSessions, recoveryLogs, fuelLogs, memories] = await Promise.all([
    ctx.repo.listActualSessions(ctx.userId),
    ctx.repo.listRecoveryLogs(ctx.userId),
    ctx.repo.listFuelLogs(ctx.userId),
    ctx.repo.listMemories(ctx.userId),
  ]);
  return deriveInsights({ actualSessions, recoveryLogs, fuelLogs, memories });
}

export async function getKnows(ctx: KonaContext): Promise<KnowsView | null> {
  const profile = await ctx.repo.getProfile(ctx.userId);
  if (!profile?.onboarded_at) return null;
  const [memories, actualSessions, recoveryLogs, fuelLogs, events] = await Promise.all([
    ctx.repo.listMemories(ctx.userId),
    ctx.repo.listActualSessions(ctx.userId),
    ctx.repo.listRecoveryLogs(ctx.userId),
    ctx.repo.listFuelLogs(ctx.userId),
    ctx.repo.listActivityEvents(ctx.userId, 40),
  ]);
  return buildKnows({ profile, memories, actualSessions, recoveryLogs, fuelLogs, events });
}

export async function getHome(ctx: KonaContext, selectedDate?: string): Promise<HomeView | null> {
  const profile = await ctx.repo.getProfile(ctx.userId);
  if (!profile?.onboarded_at) return null;
  const [weeklyPlans, actualSessions, recoveryLogs, fuelLogs, memories] = await Promise.all([
    ctx.repo.listWeeklyPlans(ctx.userId),
    ctx.repo.listActualSessions(ctx.userId),
    ctx.repo.listRecoveryLogs(ctx.userId),
    ctx.repo.listFuelLogs(ctx.userId),
    ctx.repo.listMemories(ctx.userId),
  ]);
  const weeklyPlan = weeklyPlans.at(-1);
  const sessions = weeklyPlan ? await ctx.repo.listPlannedSessionsForWeeklyPlan(weeklyPlan.id) : [];
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

export async function submitCheckin(ctx: KonaContext, input: CheckinInput): Promise<CheckinResult | null> {
  const profile = await ctx.repo.getProfile(ctx.userId);
  if (!profile?.onboarded_at) return null;

  const log = buildCheckinLog(input);
  const screen = screenForEscalation(log.free_text);
  await ctx.repo.saveRecoveryLog({
    user_id: ctx.userId,
    free_text: log.free_text,
    overall_severity: log.overall_severity,
    reported_symptoms: log.reported_symptoms,
  });
  await ctx.repo.appendActivityEvent({
    user_id: ctx.userId,
    type: 'checkin_done',
    summary: 'You did an end-of-day check-in',
  });
  await recordTurnActivity(ctx.repo, ctx.userId, []); // insight-detection pass only
  return { ok: true, escalated: screen.escalate, reflection: checkinReflection(input, screen) };
}

/** The opening message + conversation starters. Null until the user has onboarded. */
export async function getStarter(ctx: KonaContext): Promise<ChatStarter | null> {
  const profile = await ctx.repo.getProfile(ctx.userId);
  if (!profile?.onboarded_at) return null;
  const weeklyPlan = (await ctx.repo.listWeeklyPlans(ctx.userId)).at(-1);
  const sessions = weeklyPlan ? await ctx.repo.listPlannedSessionsForWeeklyPlan(weeklyPlan.id) : [];
  return buildStarter(profile, { now: new Date(), sessions });
}
