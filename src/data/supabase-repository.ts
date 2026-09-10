import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
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
import type {
  NewActualSession,
  NewFuelLog,
  NewPlannedSession,
  NewRecoveryLog,
  NewWeeklyPlan,
  RelevantHistory,
  Repository,
} from './repository';

/**
 * Production {@link Repository} backed by Supabase Postgres.
 *
 * Constructed per request with a Supabase client bound to the caller's auth
 * cookies, so every statement runs as the signed-in user and Row Level Security
 * (`auth.uid() = user_id`, see supabase/migrations/0001_init.sql) is the
 * isolation boundary — not application code. A `userId` argument is still passed
 * everywhere and used in `where` clauses as defence in depth.
 *
 * No service-role key is used anywhere.
 */

function fail(where: string, error: PostgrestError | null): never {
  throw new Error(`SupabaseRepository.${where}: ${error?.message ?? 'unknown error'}`);
}

/** Drop null/undefined entries so mapped domain objects match the in-memory shape. */
function clean<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined) out[k] = v;
  return out as T;
}

/** Normalise a timestamptz string to the same `...Z` ISO form the in-memory repo emits. */
function iso(v: unknown): string {
  return v ? new Date(v as string).toISOString() : new Date().toISOString();
}

type Row = Record<string, unknown>;

function sessionCoreToRow(c: SessionInputCore): Row {
  return {
    sport: c.sport,
    start_at: c.start_at,
    time_of_day: c.time_of_day ?? null,
    duration_minutes: c.duration_minutes ?? null,
    distance_km: c.distance_km ?? null,
    intensity: c.intensity,
    pre_fed_state: c.pre_fed_state ?? null,
    environment: c.environment ?? null,
    sequence_index: c.sequence_index ?? null,
    session_group_id: c.session_group_id ?? null,
    is_long: c.is_long ?? null,
    needs_detail: c.needs_detail ?? null,
    notes: c.notes ?? null,
  };
}

function rowToPlanned(r: Row): PlannedSession {
  return clean({
    id: r.id as string,
    user_id: r.user_id as string,
    kind: 'planned' as const,
    weekly_plan_id: (r.weekly_plan_id as string | null) ?? undefined,
    sport: r.sport as Sport,
    start_at: r.start_at as string,
    time_of_day: r.time_of_day as PlannedSession['time_of_day'],
    duration_minutes: (r.duration_minutes as number | null) ?? undefined,
    distance_km: (r.distance_km as number | null) ?? undefined,
    intensity: r.intensity as PlannedSession['intensity'],
    pre_fed_state: (r.pre_fed_state as PlannedSession['pre_fed_state']) ?? undefined,
    environment: (r.environment as PlannedSession['environment']) ?? undefined,
    sequence_index: (r.sequence_index as number | null) ?? undefined,
    session_group_id: (r.session_group_id as string | null) ?? undefined,
    is_long: (r.is_long as boolean | null) ?? undefined,
    needs_detail: (r.needs_detail as PlannedSession['needs_detail']) ?? undefined,
    notes: (r.notes as string | null) ?? undefined,
    created_at: iso(r.created_at),
  }) as PlannedSession;
}

function rowToActual(r: Row): ActualSession {
  return clean({
    ...rowToPlanned(r),
    kind: 'actual' as const,
    planned_session_id: (r.planned_session_id as string | null) ?? undefined,
    status: r.status as ActualSession['status'],
    reason: (r.reason as string | null) ?? undefined,
  }) as ActualSession;
}

function rowToWeeklyPlan(r: Row): WeeklyPlan {
  return clean({
    id: r.id as string,
    user_id: r.user_id as string,
    week_start: r.week_start as string,
    source_text: (r.source_text as string | null) ?? undefined,
    rest_days: (r.rest_days as string[] | null) ?? [],
    created_at: iso(r.created_at),
  }) as WeeklyPlan;
}

function rowToFuelLog(r: Row): FuelLog {
  return clean({
    id: r.id as string,
    user_id: r.user_id as string,
    session_id: (r.session_id as string | null) ?? undefined,
    logged_at: iso(r.logged_at),
    items: (r.items as FuelLog['items']) ?? [],
  }) as FuelLog;
}

function rowToRecoveryLog(r: Row): RecoveryLog {
  return clean({
    id: r.id as string,
    user_id: r.user_id as string,
    session_id: (r.session_id as string | null) ?? undefined,
    logged_at: iso(r.logged_at),
    free_text: (r.free_text as string | null) ?? '',
    overall_severity: (r.overall_severity as RecoveryLog['overall_severity']) ?? undefined,
    reported_symptoms: (r.reported_symptoms as string[] | null) ?? undefined,
    sleep_quality: (r.sleep_quality as RecoveryLog['sleep_quality']) ?? undefined,
  }) as RecoveryLog;
}

function rowToMessage(r: Row): ChatMessage {
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    conversation_id: r.conversation_id as string,
    role: r.role as ChatMessage['role'],
    content: r.content as string,
    created_at: iso(r.created_at),
  };
}

function rowToMemory(r: Row): PersistedMemory {
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    key: r.key as string,
    value: r.value as string,
    certainty: r.certainty as PersistedMemory['certainty'],
    source: r.source as PersistedMemory['source'],
    status: 'active',
    proposed_at: iso(r.proposed_at),
    persisted_at: iso(r.persisted_at),
  };
}

function rowToActivityEvent(r: Row): ActivityEvent {
  return clean({
    id: r.id as string,
    user_id: r.user_id as string,
    type: r.type as ActivityEvent['type'],
    at: iso(r.at),
    summary: r.summary as string,
    meta: (r.meta as Record<string, unknown> | null) ?? undefined,
  }) as ActivityEvent;
}

export class SupabaseRepository implements Repository {
  constructor(private readonly sb: SupabaseClient) {}

  // --- profile -----------------------------------------------------------
  async getProfile(userId: string): Promise<Profile | undefined> {
    const { data, error } = await this.sb.from('profiles').select('*').eq('user_id', userId).maybeSingle();
    if (error) fail('getProfile', error);
    if (!data) return undefined;
    return clean({
      user_id: data.user_id,
      username: data.username ?? undefined,
      goal: data.goal ?? undefined,
      gender: data.gender ?? undefined,
      age: data.age ?? undefined,
      body_weight_kg: data.body_weight_kg ?? undefined,
      usual_sports: data.usual_sports ?? [],
      usual_bottle_ml: data.usual_bottle_ml ?? undefined,
      typical_weekly_sessions: data.typical_weekly_sessions ?? undefined,
      known_sweat_data: data.known_sweat_data ?? undefined,
      preferred_product_ids: data.preferred_product_ids ?? undefined,
      recent_injuries_note: data.recent_injuries_note ?? undefined,
      onboarded_at: data.onboarded_at ? iso(data.onboarded_at) : undefined,
    }) as Profile;
  }

  async upsertProfile(profile: Profile): Promise<Profile> {
    const row = {
      user_id: profile.user_id,
      username: profile.username ?? null,
      goal: profile.goal ?? null,
      gender: profile.gender ?? null,
      age: profile.age ?? null,
      body_weight_kg: profile.body_weight_kg ?? null,
      usual_sports: profile.usual_sports ?? [],
      usual_bottle_ml: profile.usual_bottle_ml ?? null,
      typical_weekly_sessions: profile.typical_weekly_sessions ?? null,
      known_sweat_data: profile.known_sweat_data ?? null,
      preferred_product_ids: profile.preferred_product_ids ?? null,
      recent_injuries_note: profile.recent_injuries_note ?? null,
      onboarded_at: profile.onboarded_at ?? null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await this.sb.from('profiles').upsert(row, { onConflict: 'user_id' });
    if (error) fail('upsertProfile', error);
    return (await this.getProfile(profile.user_id)) as Profile;
  }

  // --- planned sessions -------------------------------------------------
  async savePlannedSession(input: NewPlannedSession): Promise<PlannedSession> {
    const row = {
      ...sessionCoreToRow(input),
      user_id: input.user_id,
      weekly_plan_id: input.weekly_plan_id ?? null,
      created_at: new Date().toISOString(),
    };
    const { data, error } = await this.sb.from('planned_sessions').insert(row).select().single();
    if (error) fail('savePlannedSession', error);
    return rowToPlanned(data as Row);
  }

  async getPlannedSession(id: string): Promise<PlannedSession | undefined> {
    const { data, error } = await this.sb.from('planned_sessions').select('*').eq('id', id).maybeSingle();
    if (error) fail('getPlannedSession', error);
    return data ? rowToPlanned(data as Row) : undefined;
  }

  async updatePlannedSession(
    id: string,
    patch: Partial<
      Pick<
        PlannedSession,
        'intensity' | 'duration_minutes' | 'distance_km' | 'is_long' | 'needs_detail' | 'notes' | 'time_of_day' | 'start_at'
      >
    >,
  ): Promise<PlannedSession | undefined> {
    const { data, error } = await this.sb
      .from('planned_sessions')
      .update(patch)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) fail('updatePlannedSession', error);
    return data ? rowToPlanned(data as Row) : undefined;
  }

  async listPlannedSessions(userId: string): Promise<PlannedSession[]> {
    const { data, error } = await this.sb
      .from('planned_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('start_at', { ascending: true });
    if (error) fail('listPlannedSessions', error);
    return (data as Row[]).map(rowToPlanned);
  }

  // --- weekly plans ---------------------------------------------------
  async saveWeeklyPlan(input: NewWeeklyPlan): Promise<WeeklyPlan> {
    const del = await this.sb
      .from('weekly_plans')
      .delete()
      .eq('user_id', input.user_id)
      .eq('week_start', input.week_start);
    if (del.error) fail('saveWeeklyPlan(delete)', del.error);
    const row = {
      user_id: input.user_id,
      week_start: input.week_start,
      source_text: input.source_text ?? null,
      rest_days: input.rest_days ?? [],
      created_at: new Date().toISOString(),
    };
    const { data, error } = await this.sb.from('weekly_plans').insert(row).select().single();
    if (error) fail('saveWeeklyPlan(insert)', error);
    return rowToWeeklyPlan(data as Row);
  }

  async getWeeklyPlan(userId: string, weekStart: string): Promise<WeeklyPlan | undefined> {
    const { data, error } = await this.sb
      .from('weekly_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('week_start', weekStart)
      .maybeSingle();
    if (error) fail('getWeeklyPlan', error);
    return data ? rowToWeeklyPlan(data as Row) : undefined;
  }

  async listWeeklyPlans(userId: string): Promise<WeeklyPlan[]> {
    const { data, error } = await this.sb
      .from('weekly_plans')
      .select('*')
      .eq('user_id', userId)
      .order('week_start', { ascending: true });
    if (error) fail('listWeeklyPlans', error);
    return (data as Row[]).map(rowToWeeklyPlan);
  }

  async listPlannedSessionsForWeeklyPlan(weeklyPlanId: string): Promise<PlannedSession[]> {
    const { data, error } = await this.sb
      .from('planned_sessions')
      .select('*')
      .eq('weekly_plan_id', weeklyPlanId)
      .order('start_at', { ascending: true });
    if (error) fail('listPlannedSessionsForWeeklyPlan', error);
    return (data as Row[]).map(rowToPlanned);
  }

  async findPlannedSessionForDate(userId: string, dateIso: string, sport?: Sport): Promise<PlannedSession | undefined> {
    const day = dateIso.slice(0, 10);
    let q = this.sb
      .from('planned_sessions')
      .select('*')
      .eq('user_id', userId)
      .gte('start_at', `${day}T00:00`)
      .lte('start_at', `${day}T23:59:59`)
      .order('created_at', { ascending: false });
    if (sport) q = q.eq('sport', sport);
    const { data, error } = await q;
    if (error) fail('findPlannedSessionForDate', error);
    const rows = (data as Row[]).map(rowToPlanned).filter((s) => s.start_at.slice(0, 10) === day);
    return rows[0];
  }

  // --- actual sessions ----------------------------------------------
  async saveActualSession(input: NewActualSession): Promise<ActualSession> {
    const row = {
      ...sessionCoreToRow(input),
      user_id: input.user_id,
      planned_session_id: input.planned_session_id ?? null,
      status: input.status,
      reason: input.reason ?? null,
      created_at: new Date().toISOString(),
    };
    const { data, error } = await this.sb.from('sessions').insert(row).select().single();
    if (error) fail('saveActualSession', error);
    return rowToActual(data as Row);
  }

  async getActualSession(id: string): Promise<ActualSession | undefined> {
    const { data, error } = await this.sb.from('sessions').select('*').eq('id', id).maybeSingle();
    if (error) fail('getActualSession', error);
    return data ? rowToActual(data as Row) : undefined;
  }

  async listActualSessions(userId: string): Promise<ActualSession[]> {
    const { data, error } = await this.sb
      .from('sessions')
      .select('*')
      .eq('user_id', userId)
      .order('start_at', { ascending: true });
    if (error) fail('listActualSessions', error);
    return (data as Row[]).map(rowToActual);
  }

  // --- fuel logs ---------------------------------------------------
  async saveFuelLog(input: NewFuelLog): Promise<FuelLog> {
    const row = {
      user_id: input.user_id,
      session_id: input.session_id ?? null,
      items: input.items ?? [],
      logged_at: new Date().toISOString(),
    };
    const { data, error } = await this.sb.from('fuel_logs').insert(row).select().single();
    if (error) fail('saveFuelLog', error);
    return rowToFuelLog(data as Row);
  }

  async listFuelLogs(userId: string, sessionId?: string): Promise<FuelLog[]> {
    let q = this.sb.from('fuel_logs').select('*').eq('user_id', userId).order('logged_at', { ascending: true });
    if (sessionId) q = q.eq('session_id', sessionId);
    const { data, error } = await q;
    if (error) fail('listFuelLogs', error);
    return (data as Row[]).map(rowToFuelLog);
  }

  // --- recovery logs ---------------------------------------------
  async saveRecoveryLog(input: NewRecoveryLog): Promise<RecoveryLog> {
    const row = {
      user_id: input.user_id,
      session_id: input.session_id ?? null,
      free_text: input.free_text,
      overall_severity: input.overall_severity ?? null,
      reported_symptoms: input.reported_symptoms ?? null,
      sleep_quality: input.sleep_quality ?? null,
      logged_at: new Date().toISOString(),
    };
    const { data, error } = await this.sb.from('recovery_logs').insert(row).select().single();
    if (error) fail('saveRecoveryLog', error);
    return rowToRecoveryLog(data as Row);
  }

  async listRecoveryLogs(userId: string): Promise<RecoveryLog[]> {
    const { data, error } = await this.sb
      .from('recovery_logs')
      .select('*')
      .eq('user_id', userId)
      .order('logged_at', { ascending: true });
    if (error) fail('listRecoveryLogs', error);
    return (data as Row[]).map(rowToRecoveryLog);
  }

  // --- messages / conversations -------------------------------
  async appendMessage(msg: Omit<ChatMessage, 'id' | 'created_at'>): Promise<ChatMessage> {
    const row = {
      user_id: msg.user_id,
      conversation_id: msg.conversation_id,
      role: msg.role,
      content: msg.content,
      created_at: new Date().toISOString(),
    };
    const { data, error } = await this.sb.from('messages').insert(row).select().single();
    if (error) fail('appendMessage', error);
    return rowToMessage(data as Row);
  }

  async listMessages(userId: string, conversationId: string): Promise<ChatMessage[]> {
    const { data, error } = await this.sb
      .from('messages')
      .select('*')
      .eq('user_id', userId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) fail('listMessages', error);
    return (data as Row[]).map(rowToMessage);
  }

  async deleteMessagesFrom(userId: string, conversationId: string, messageId: string): Promise<number> {
    const target = await this.sb
      .from('messages')
      .select('created_at')
      .eq('user_id', userId)
      .eq('conversation_id', conversationId)
      .eq('id', messageId)
      .maybeSingle();
    if (target.error) fail('deleteMessagesFrom(find)', target.error);
    if (!target.data) return 0;
    const { data, error } = await this.sb
      .from('messages')
      .delete()
      .eq('user_id', userId)
      .eq('conversation_id', conversationId)
      .gte('created_at', target.data.created_at as string)
      .select('id');
    if (error) fail('deleteMessagesFrom(delete)', error);
    return (data as Row[]).length;
  }

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    const { data, error } = await this.sb
      .from('conversation_summaries')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) fail('listConversations', error);
    return (data as Row[]).map((r) => ({
      id: r.id as string,
      title: (r.title as string) || 'New chat',
      message_count: Number(r.message_count ?? 0),
      created_at: iso(r.created_at),
      updated_at: iso(r.updated_at),
    }));
  }

  // --- activity events (append-only) --------------------------
  async appendActivityEvent(input: NewActivityEvent): Promise<ActivityEvent> {
    const row = {
      user_id: input.user_id,
      type: input.type,
      summary: input.summary,
      meta: input.meta ?? null,
      at: input.at ?? new Date().toISOString(),
    };
    const { data, error } = await this.sb.from('activity_events').insert(row).select().single();
    if (error) fail('appendActivityEvent', error);
    return rowToActivityEvent(data as Row);
  }

  async listActivityEvents(userId: string, limit?: number): Promise<ActivityEvent[]> {
    let q = this.sb.from('activity_events').select('*').eq('user_id', userId).order('at', { ascending: false });
    if (limit) q = q.limit(limit);
    const { data, error } = await q;
    if (error) fail('listActivityEvents', error);
    return (data as Row[]).map(rowToActivityEvent);
  }

  // --- personal memories ---------------------------------------
  async proposeMemory(candidate: MemoryCandidate): Promise<PersistedMemory> {
    const now = new Date().toISOString();
    const row = {
      user_id: candidate.user_id,
      key: candidate.key,
      value: candidate.value,
      certainty: candidate.certainty,
      source: candidate.source,
      status: 'active',
      proposed_at: candidate.proposed_at ?? now,
      persisted_at: now,
    };
    const { data, error } = await this.sb
      .from('personal_memories')
      .upsert(row, { onConflict: 'user_id,key' })
      .select()
      .single();
    if (error) fail('proposeMemory', error);
    return rowToMemory(data as Row);
  }

  async listMemories(userId: string): Promise<PersistedMemory[]> {
    const { data, error } = await this.sb
      .from('personal_memories')
      .select('*')
      .eq('user_id', userId)
      .order('persisted_at', { ascending: true });
    if (error) fail('listMemories', error);
    return (data as Row[]).map(rowToMemory);
  }

  // --- relevant history ---------------------------------------
  async getRelevantHistory(userId: string, filter: { sport?: Sport; limit?: number }): Promise<RelevantHistory> {
    const limit = filter.limit ?? 5;
    let sessionsQ = this.sb
      .from('sessions')
      .select('*')
      .eq('user_id', userId)
      .order('start_at', { ascending: false })
      .limit(limit);
    if (filter.sport) sessionsQ = sessionsQ.eq('sport', filter.sport);

    const [sessions, recovery, fuel] = await Promise.all([
      sessionsQ,
      this.sb.from('recovery_logs').select('*').eq('user_id', userId).order('logged_at', { ascending: false }).limit(limit),
      this.sb.from('fuel_logs').select('*').eq('user_id', userId).order('logged_at', { ascending: false }).limit(limit),
    ]);
    if (sessions.error) fail('getRelevantHistory(sessions)', sessions.error);
    if (recovery.error) fail('getRelevantHistory(recovery)', recovery.error);
    if (fuel.error) fail('getRelevantHistory(fuel)', fuel.error);

    return {
      recent_actual_sessions: (sessions.data as Row[]).map(rowToActual),
      recent_recovery_logs: (recovery.data as Row[]).map(rowToRecoveryLog),
      recent_fuel_logs: (fuel.data as Row[]).map(rowToFuelLog),
    };
  }
}
