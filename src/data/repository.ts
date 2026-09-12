import type {
  ActivityEvent,
  ActualSession,
  ChatMessage,
  ConversationSummary,
  FuelLog,
  MemoryCandidate,
  NewActivityEvent,
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
  /** The chat message (turn) creating this record (M23.1). */
  origin_message_id?: string;
}

export interface NewWeeklyPlan {
  user_id: string;
  week_start: string;
  source_text?: string;
  rest_days?: string[];
  origin_message_id?: string;
}

export interface NewActualSession extends SessionInputCore {
  user_id: string;
  planned_session_id?: string;
  status: ActualSession['status'];
  reason?: string;
  origin_message_id?: string;
}

export interface NewFuelLog {
  user_id: string;
  session_id?: string;
  items: FuelLog['items'];
  origin_message_id?: string;
}

export interface NewRecoveryLog {
  user_id: string;
  session_id?: string;
  free_text: string;
  overall_severity?: RecoveryLog['overall_severity'];
  reported_symptoms?: string[];
  sleep_quality?: RecoveryLog['sleep_quality'];
  origin_message_id?: string;
}

/**
 * What `deleteRecordsForMessages` removed / repaired while reconciling an edited
 * chat turn (M23.1). All counts are of the caller's own rows.
 */
export interface EditReconciliation {
  planned_sessions: number;
  sessions: number;
  weekly_plans: number;
  fuel_logs: number;
  recovery_logs: number;
  memories: number;
  activity_events: number;
  /** Foreign-key references on surviving rows that pointed at a deleted record
   *  and were set to null (a later record kept, its link to a gone record cut). */
  nulled_links: number;
}

export interface RelevantHistory {
  recent_actual_sessions: ActualSession[];
  recent_recovery_logs: RecoveryLog[];
  recent_fuel_logs: FuelLog[];
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
      Pick<
        PlannedSession,
        'intensity' | 'duration_minutes' | 'distance_km' | 'distance_label' | 'is_long' | 'needs_detail' | 'notes' | 'time_of_day' | 'start_at' | 'environment'
      >
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
  /** Messages for one of the user's own conversations. Scoped by user so a
   *  conversation id from another user can never be read. */
  listMessages(userId: string, conversationId: string): Promise<ChatMessage[]>;
  /** The ids of `messageId` and every message after it in the user's
   *  conversation, chronological. Empty if `messageId` is not the user's.
   *  Used to reconcile structured records before the edit-and-regenerate
   *  delete (M23.1). */
  listMessageIdsFrom(userId: string, conversationId: string, messageId: string): Promise<string[]>;
  /** Remove `messageId` and every message after it in the user's conversation
   *  (for the edit-and-regenerate flow). Returns how many were removed. */
  deleteMessagesFrom(userId: string, conversationId: string, messageId: string): Promise<number>;
  /**
   * Reconcile structured records for an edited turn (M23.1): delete every
   * planned/actual session, weekly plan, fuel log, recovery log, memory and
   * activity event whose `origin_message_id` is in `messageIds`, then null any
   * foreign-key reference on a SURVIVING row that pointed at one of the deleted
   * records (a later, kept record loses only its dangling link, not itself).
   * Idempotent. Never touches another user's rows or the `profiles` row.
   */
  deleteRecordsForMessages(userId: string, messageIds: string[]): Promise<EditReconciliation>;
  /** One summary row per conversation that has messages, newest activity first. */
  listConversations(userId: string): Promise<ConversationSummary[]>;

  appendActivityEvent(input: NewActivityEvent): Promise<ActivityEvent>;
  /** Newest first. */
  listActivityEvents(userId: string, limit?: number): Promise<ActivityEvent[]>;

  proposeMemory(candidate: MemoryCandidate): Promise<PersistedMemory>;
  listMemories(userId: string): Promise<PersistedMemory[]>;

  getRelevantHistory(userId: string, filter: { sport?: Sport; limit?: number }): Promise<RelevantHistory>;
}
