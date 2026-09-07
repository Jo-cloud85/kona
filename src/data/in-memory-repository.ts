import type {
  ActualSession,
  ChatMessage,
  ConversationSummary,
  FuelLog,
  MemoryCandidate,
  PersistedMemory,
  PlannedSession,
  Profile,
  RecoveryLog,
  Sport,
  WeeklyPlan,
} from '../domain/types';
import { newId } from './ids';
import type {
  NewActualSession,
  NewFuelLog,
  NewPlannedSession,
  NewRecoveryLog,
  NewWeeklyPlan,
  RelevantHistory,
  Repository,
} from './repository';

export interface InMemoryRepositoryOptions {
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

export class InMemoryRepository implements Repository {
  private profiles = new Map<string, Profile>();
  private planned = new Map<string, PlannedSession>();
  private actual = new Map<string, ActualSession>();
  private fuelLogs: FuelLog[] = [];
  private recoveryLogs: RecoveryLog[] = [];
  private messages: ChatMessage[] = [];
  private memories: PersistedMemory[] = [];
  private weeklyPlans: WeeklyPlan[] = [];
  private readonly now: () => Date;

  constructor(opts: InMemoryRepositoryOptions = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  private iso(): string {
    return this.now().toISOString();
  }

  async getProfile(userId: string): Promise<Profile | undefined> {
    return this.profiles.get(userId);
  }

  async upsertProfile(profile: Profile): Promise<Profile> {
    this.profiles.set(profile.user_id, profile);
    return profile;
  }

  async savePlannedSession(input: NewPlannedSession): Promise<PlannedSession> {
    const session: PlannedSession = {
      ...input,
      id: newId('plan'),
      kind: 'planned',
      created_at: this.iso(),
    };
    this.planned.set(session.id, session);
    return session;
  }

  async getPlannedSession(id: string): Promise<PlannedSession | undefined> {
    return this.planned.get(id);
  }

  async updatePlannedSession(
    id: string,
    patch: Partial<
      Pick<PlannedSession, 'intensity' | 'duration_minutes' | 'distance_km' | 'is_long' | 'needs_detail' | 'notes'>
    >,
  ): Promise<PlannedSession | undefined> {
    const existing = this.planned.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.planned.set(id, updated);
    return updated;
  }

  async listPlannedSessions(userId: string): Promise<PlannedSession[]> {
    return [...this.planned.values()]
      .filter((s) => s.user_id === userId)
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
  }

  async saveWeeklyPlan(input: NewWeeklyPlan): Promise<WeeklyPlan> {
    this.weeklyPlans = this.weeklyPlans.filter(
      (p) => !(p.user_id === input.user_id && p.week_start === input.week_start),
    );
    const plan: WeeklyPlan = {
      id: newId('week'),
      user_id: input.user_id,
      week_start: input.week_start,
      source_text: input.source_text,
      rest_days: input.rest_days ?? [],
      created_at: this.iso(),
    };
    this.weeklyPlans.push(plan);
    return plan;
  }

  async getWeeklyPlan(userId: string, weekStart: string): Promise<WeeklyPlan | undefined> {
    return this.weeklyPlans.find((p) => p.user_id === userId && p.week_start === weekStart);
  }

  async listWeeklyPlans(userId: string): Promise<WeeklyPlan[]> {
    return this.weeklyPlans
      .filter((p) => p.user_id === userId)
      .sort((a, b) => a.week_start.localeCompare(b.week_start));
  }

  async listPlannedSessionsForWeeklyPlan(weeklyPlanId: string): Promise<PlannedSession[]> {
    return [...this.planned.values()]
      .filter((s) => s.weekly_plan_id === weeklyPlanId)
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
  }

  async findPlannedSessionForDate(
    userId: string,
    dateIso: string,
    sport?: Sport,
  ): Promise<PlannedSession | undefined> {
    const day = dateIso.slice(0, 10);
    const matches = (await this.listPlannedSessions(userId)).filter(
      (s) => s.start_at.slice(0, 10) === day && (sport ? s.sport === sport : true),
    );
    // Most recently created plan for that day wins.
    return matches.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  }

  async saveActualSession(input: NewActualSession): Promise<ActualSession> {
    const session: ActualSession = {
      ...input,
      id: newId('act'),
      kind: 'actual',
      created_at: this.iso(),
    };
    this.actual.set(session.id, session);
    return session;
  }

  async getActualSession(id: string): Promise<ActualSession | undefined> {
    return this.actual.get(id);
  }

  async listActualSessions(userId: string): Promise<ActualSession[]> {
    return [...this.actual.values()]
      .filter((s) => s.user_id === userId)
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
  }

  async saveFuelLog(input: NewFuelLog): Promise<FuelLog> {
    const log: FuelLog = {
      ...input,
      id: newId('fuel'),
      logged_at: this.iso(),
    };
    this.fuelLogs.push(log);
    return log;
  }

  async listFuelLogs(userId: string, sessionId?: string): Promise<FuelLog[]> {
    return this.fuelLogs.filter(
      (l) => l.user_id === userId && (sessionId ? l.session_id === sessionId : true),
    );
  }

  async saveRecoveryLog(input: NewRecoveryLog): Promise<RecoveryLog> {
    const log: RecoveryLog = {
      ...input,
      id: newId('rec'),
      logged_at: this.iso(),
    };
    this.recoveryLogs.push(log);
    return log;
  }

  async listRecoveryLogs(userId: string): Promise<RecoveryLog[]> {
    return this.recoveryLogs.filter((l) => l.user_id === userId);
  }

  async appendMessage(msg: Omit<ChatMessage, 'id' | 'created_at'>): Promise<ChatMessage> {
    const stored: ChatMessage = { ...msg, id: newId('msg'), created_at: this.iso() };
    this.messages.push(stored);
    return stored;
  }

  async listMessages(conversationId: string): Promise<ChatMessage[]> {
    return this.messages.filter((m) => m.conversation_id === conversationId);
  }

  async listConversations(_userId?: string): Promise<ConversationSummary[]> {
    const byConv = new Map<string, ChatMessage[]>();
    for (const m of this.messages) {
      const list = byConv.get(m.conversation_id);
      if (list) list.push(m);
      else byConv.set(m.conversation_id, [m]);
    }
    const rows: ConversationSummary[] = [];
    for (const [id, msgs] of byConv) {
      const ordered = [...msgs].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const firstUser = ordered.find((m) => m.role === 'user');
      rows.push({
        id,
        title: firstUser ? firstUser.content.slice(0, 60) : 'New chat',
        message_count: ordered.length,
        created_at: ordered[0]!.created_at,
        updated_at: ordered[ordered.length - 1]!.created_at,
      });
    }
    return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async proposeMemory(candidate: MemoryCandidate): Promise<PersistedMemory> {
    // Application code owns persistence; the agent only proposes (ARCHITECTURE.md §5).
    const existing = this.memories.find(
      (m) => m.user_id === candidate.user_id && m.key === candidate.key,
    );
    if (existing) {
      existing.value = candidate.value;
      existing.certainty = candidate.certainty;
      existing.persisted_at = this.iso();
      return existing;
    }
    const persisted: PersistedMemory = {
      ...candidate,
      id: newId('mem'),
      status: 'active',
      persisted_at: this.iso(),
    };
    this.memories.push(persisted);
    return persisted;
  }

  async listMemories(userId: string): Promise<PersistedMemory[]> {
    return this.memories.filter((m) => m.user_id === userId);
  }

  async getRelevantHistory(
    userId: string,
    filter: { sport?: Sport; limit?: number },
  ): Promise<RelevantHistory> {
    const limit = filter.limit ?? 5;
    const sessions = (await this.listActualSessions(userId))
      .filter((s) => (filter.sport ? s.sport === filter.sport : true))
      .slice(-limit)
      .reverse();
    const recovery = (await this.listRecoveryLogs(userId)).slice(-limit).reverse();
    return { recent_actual_sessions: sessions, recent_recovery_logs: recovery };
  }
}
