import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRepository } from '../../src/data/supabase-repository';

/**
 * Exercises SupabaseRepository against a REAL Supabase project — the only place
 * RLS isolation and cross-process persistence are actually proven.
 *
 * Skipped unless a disposable test project is configured (0001_init.sql applied):
 *   KONA_TEST_SUPABASE_URL
 *   KONA_TEST_SUPABASE_ANON_KEY
 *   KONA_TEST_SUPABASE_SERVICE_ROLE   (mints + cleans up throwaway users)
 *
 * See DEPLOYMENT.md § "Running the live persistence tests".
 */
const URL = process.env.KONA_TEST_SUPABASE_URL;
const ANON = process.env.KONA_TEST_SUPABASE_ANON_KEY;
const SERVICE = process.env.KONA_TEST_SUPABASE_SERVICE_ROLE;
const enabled = Boolean(URL && ANON && SERVICE);

const PW = 'pw-' + Math.random().toString(36).slice(2) + 'A1!';

let admin: SupabaseClient;
const users: { id: string; token: string; email: string }[] = [];

function repoFor(token: string): SupabaseRepository {
  const client = createClient(URL!, ANON!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return new SupabaseRepository(client);
}
function rawFor(token: string): SupabaseClient {
  return createClient(URL!, ANON!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function mkUser(): Promise<{ id: string; token: string; email: string }> {
  const email = `kona-live-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('createUser failed');
  const s = await createClient(URL!, ANON!).auth.signInWithPassword({ email, password: PW });
  if (s.error || !s.data.session) throw s.error ?? new Error('signIn failed');
  return { id: data.user.id, token: s.data.session.access_token, email };
}

describe.skipIf(!enabled)('SupabaseRepository (live project)', () => {
  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
    users.push(await mkUser(), await mkUser());
  }, 30_000);

  afterAll(async () => {
    for (const u of users) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  });

  it('round-trips core entities and still sees them from a fresh client (persistence across "restart")', async () => {
    const [a] = users;
    const w = repoFor(a!.token);

    await w.upsertProfile({ user_id: a!.id, usual_sports: ['running'], body_weight_kg: 63, onboarded_at: '2026-01-01T00:00:00Z' });
    const plan = await w.savePlannedSession({ user_id: a!.id, sport: 'running', intensity: 'easy', start_at: '2026-05-01T06:00:00', distance_km: 18 });
    await w.saveActualSession({ user_id: a!.id, sport: 'running', intensity: 'easy', start_at: '2026-05-01T06:00:00', status: 'completed', planned_session_id: plan.id });
    await w.appendMessage({ user_id: a!.id, conversation_id: 'live1', role: 'user', content: 'hello kona' });
    await w.proposeMemory({ user_id: a!.id, key: 'usual_bottle', value: '750 ml', certainty: 'user_reported', source: 'conversation', proposed_at: '2026-01-01T00:00:00Z' });
    await w.appendActivityEvent({ user_id: a!.id, type: 'session_logged', summary: 'You logged a run' });

    // brand-new client, same identity — nothing kept in memory
    const r = repoFor(a!.token);
    expect((await r.getProfile(a!.id))?.body_weight_kg).toBe(63);
    expect((await r.listPlannedSessions(a!.id))).toHaveLength(1);
    expect((await r.listActualSessions(a!.id))[0]?.planned_session_id).toBe(plan.id);
    expect((await r.listMessages(a!.id, 'live1')).map((m) => m.content)).toEqual(['hello kona']);
    expect((await r.listMemories(a!.id))[0]?.value).toBe('750 ml');
    expect((await r.listConversations(a!.id)).map((c) => c.id)).toContain('live1');
    expect((await r.listActivityEvents(a!.id)).map((e) => e.type)).toContain('session_logged');
  }, 30_000);

  it('RLS: user B cannot read or write user A\'s data', async () => {
    const [a, b] = users;
    const rb = repoFor(b!.token);

    // reads come back empty, not another user's rows
    expect(await rb.getProfile(a!.id)).toBeUndefined();
    expect(await rb.listPlannedSessions(a!.id)).toEqual([]);
    expect(await rb.listActualSessions(a!.id)).toEqual([]);
    expect(await rb.listMessages(a!.id, 'live1')).toEqual([]);
    expect(await rb.listMemories(a!.id)).toEqual([]);
    expect(await rb.listActivityEvents(a!.id)).toEqual([]);
    expect(await rb.listConversations(a!.id)).toEqual([]);

    // a write claiming user A's id is rejected by the insert policy
    const raw = rawFor(b!.token);
    const bad = await raw.from('sessions').insert({
      user_id: a!.id,
      sport: 'running',
      intensity: 'easy',
      start_at: '2026-05-02T06:00:00',
      status: 'completed',
    });
    expect(bad.error).toBeTruthy();
  }, 30_000);

  it('activity_events are append-only at the database level', async () => {
    const [a] = users;
    const raw = rawFor(a!.token);
    const inserted = await raw.from('activity_events').insert({ user_id: a!.id, type: 'fuel_logged', summary: 'immutable?' }).select().single();
    expect(inserted.error).toBeFalsy();
    const id = inserted.data!.id;

    const upd = await raw.from('activity_events').update({ summary: 'changed' }).eq('id', id).select();
    // no UPDATE policy → 0 rows affected (or an error); either way the row is unchanged
    expect(upd.data ?? []).toHaveLength(0);
    const del = await raw.from('activity_events').delete().eq('id', id).select();
    expect(del.data ?? []).toHaveLength(0);

    const still = await raw.from('activity_events').select('summary').eq('id', id).single();
    expect(still.data?.summary).toBe('immutable?');
  }, 30_000);

  it('M23.1: origin_message_id stamps records and reconciliation removes an edited turn', async () => {
    const [a] = users;
    const w = repoFor(a!.token);

    const mSession = await w.appendMessage({ user_id: a!.id, conversation_id: 'rec1', role: 'user', content: 'ran 18k' });
    const mFuel = await w.appendMessage({ user_id: a!.id, conversation_id: 'rec1', role: 'user', content: 'had 3 gels' });

    const s = await w.saveActualSession({
      user_id: a!.id, sport: 'running', intensity: 'easy', start_at: '2026-06-10T06:00:00',
      status: 'completed', origin_message_id: mSession.id,
    });
    const f = await w.saveFuelLog({
      user_id: a!.id, session_id: s.id,
      items: [{ description: 'gel', certainty: 'user_reported' }], origin_message_id: mFuel.id,
    });

    expect((await w.getActualSession(s.id))?.origin_message_id).toBe(mSession.id);

    // reconcile ONLY the session turn: session goes, fuel is kept but its link nulled
    const summary = await w.deleteRecordsForMessages(a!.id, [mSession.id]);
    expect(summary.sessions).toBe(1);
    expect(summary.fuel_logs).toBe(0);
    expect(summary.nulled_links).toBe(1);

    expect(await w.getActualSession(s.id)).toBeUndefined();
    const keptFuel = (await w.listFuelLogs(a!.id)).find((x) => x.id === f.id);
    expect(keptFuel?.session_id).toBeUndefined();

    // FK ON DELETE CASCADE safety-net: deleting the message alone would also
    // have removed the session — verify by deleting mFuel's message and its log.
    await w.deleteRecordsForMessages(a!.id, [mFuel.id]);
    expect(await w.listFuelLogs(a!.id)).toHaveLength(0);
  }, 30_000);
});
