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
  SessionInputCore,
  Sport,
  WeeklyPlan,
} from '../domain/types';

export interface NewPlannedSession extends SessionInputCore {
  user_id: string;
  weekly_plan_id?: string;
}

export interface NewWeeklyPlan {
  user_id: string;
  week_start: string;
  source_text?: string;
  rest_days?: string[];
}

export interface NewActualSession extends SessionInputCore {
  user_id: string;
  planned_session_id?: string;
  status: ActualSession['status'];
  reason?: string;
}

export interface NewFuelLog {
  user_id: string;
  session_id?: string;
  items: FuelLog['items'];
}

export interface NewRecoveryLog {
  user_id: string;
  session_id?: string;
  free_text: string;
  overall_severity?: RecoveryLog['overall_severity'];
  reported_symptoms?: string[];
  sleep_quality?: RecoveryLog['sleep_quality'];
}

export interface RelevantHistory {
  recent_actual_sessions: ActualSession[];
  recent_recovery_logs: RecoveryLog[];
}

/**
 * Persistence boundary. The in-memory implementation is the only one for the
 * vertical slice; a Postgres/Supabase implementation can be added behind the
 * same interface later (ARCHITECTURE.md).
 */
export interface Repository {
  getProfile(userId: string): Promise<Profile | undefined>;
  upsertProfile(profile: Profile): Promise<Profile>;

  savePlannedSession(input: NewPlannedSession): Promise<PlannedSession>;
  getPlannedSession(id: string): Promise<PlannedSession | undefined>;
  listPlannedSessions(userId: string): Promise<PlannedSession[]>;
  updatePlannedSession(
    id: string,
    patch: Partial<
      Pick<PlannedSession, 'intensity' | 'duration_minutes' | 'distance_km' | 'is_long' | 'needs_detail' | 'notes'>
    >,
  ): Promise<PlannedSession | undefined>;

  /** Replaces any existing plan for the same (user, week_start). */
  saveWeeklyPlan(input: NewWeeklyPlan): Promise<WeeklyPlan>;
  getWeeklyPlan(userId: string, weekStart: string): Promise<WeeklyPlan | undefined>;
  listWeeklyPlans(userId: string): Promise<WeeklyPlan[]>;
  listPlannedSessionsForWeeklyPlan(weeklyPlanId: string): Promise<PlannedSession[]>;
  /** Latest plan for a given local calendar date (YYYY-MM-DD), optionally by sport. */
  findPlannedSessionForDate(
    userId: string,
    dateIso: string,
    sport?: Sport,
  ): Promise<PlannedSession | undefined>;

  saveActualSession(input: NewActualSession): Promise<ActualSession>;
  getActualSession(id: string): Promise<ActualSession | undefined>;
  listActualSessions(userId: string): Promise<ActualSession[]>;

  saveFuelLog(input: NewFuelLog): Promise<FuelLog>;
  listFuelLogs(userId: string, sessionId?: string): Promise<FuelLog[]>;

  saveRecoveryLog(input: NewRecoveryLog): Promise<RecoveryLog>;
  listRecoveryLogs(userId: string): Promise<RecoveryLog[]>;

  appendMessage(msg: Omit<ChatMessage, 'id' | 'created_at'>): Promise<ChatMessage>;
  listMessages(conversationId: string): Promise<ChatMessage[]>;
  /** One summary row per conversation that has messages, newest activity first. */
  listConversations(userId: string): Promise<ConversationSummary[]>;

  proposeMemory(candidate: MemoryCandidate): Promise<PersistedMemory>;
  listMemories(userId: string): Promise<PersistedMemory[]>;

  getRelevantHistory(userId: string, filter: { sport?: Sport; limit?: number }): Promise<RelevantHistory>;
}
