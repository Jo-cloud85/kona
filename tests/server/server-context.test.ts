import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * getServerContext() decides: real Supabase auth, dev fallback, or refuse.
 * The Supabase-configured path is exercised with a stub client.
 */

const getUser = vi.fn();
vi.mock('../../lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
}));

async function load() {
  vi.resetModules();
  return import('../../lib/server-context');
}

beforeEach(() => {
  getUser.mockReset();
  vi.unstubAllEnvs();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('KONA_LLM', 'deterministic');
});
afterEach(() => vi.unstubAllEnvs());

describe('getServerContext', () => {
  it('dev fallback when Supabase is not configured (non-production)', async () => {
    const { getServerContext, LOCAL_DEV_USER_ID } = await load();
    const r = await getServerContext();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ctx.userId).toBe(LOCAL_DEV_USER_ID);
      expect(r.ctx.persistent).toBe(false);
    }
  });

  it('refuses (500) when Supabase is not configured in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { getServerContext } = await load();
    const r = await getServerContext();
    expect(r).toMatchObject({ ok: false, status: 500 });
  });

  it('401 when Supabase is configured but there is no signed-in user', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { getServerContext } = await load();
    const r = await getServerContext();
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it('returns a persistent, user-scoped context when signed in', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    getUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null });
    const { getServerContext } = await load();
    const r = await getServerContext();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ctx.userId).toBe('user-123');
      expect(r.ctx.persistent).toBe(true);
      expect(typeof r.ctx.repo.getProfile).toBe('function');
    }
  });
});
