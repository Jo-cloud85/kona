import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRepository } from '../../src/data/index';
import { DeterministicLlmClient } from '../../src/agent/index';
import type * as ServerContext from '../../lib/server-context';

/**
 * Every API route must reject a request with no resolvable context (401/500)
 * and serve one with a valid context. getServerContext is stubbed and the
 * route handlers are driven directly.
 */

const getServerContext = vi.fn();
vi.mock('../../lib/server-context', async (importOriginal) => {
  const actual = await importOriginal<typeof ServerContext>();
  return { ...actual, getServerContext, llmName: () => 'deterministic' };
});

const TEST_USER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
function okContext() {
  return {
    ok: true as const,
    ctx: { repo: new InMemoryRepository(), userId: TEST_USER, llm: new DeterministicLlmClient(), persistent: false },
  };
}

beforeEach(() => getServerContext.mockReset());

type Handler = (r: Request) => Promise<Response>;
type RouteMod = Record<string, unknown>;

const LOADERS: Record<string, () => Promise<RouteMod>> = {
  home: () => import('../../app/api/home/route'),
  insights: () => import('../../app/api/insights/route'),
  knows: () => import('../../app/api/knows/route'),
  conversations: () => import('../../app/api/conversations/route'),
  profile: () => import('../../app/api/profile/route'),
  chat: () => import('../../app/api/chat/route'),
};
const ROUTES = Object.keys(LOADERS);
const loadRoute = (name: string): Promise<RouteMod> => LOADERS[name]!();

describe('API routes — auth boundary', () => {
  it('return 401 for every route when there is no signed-in user', async () => {
    getServerContext.mockResolvedValue({ ok: false, status: 401, error: 'Not signed in.' });
    for (const name of ROUTES) {
      const mod = await loadRoute(name);
      const handler = mod.GET as Handler;
      const url = `http://localhost/api/${name}${name === 'chat' ? '?conversationId=web' : ''}`;
      const res = await handler(new Request(url));
      expect(res.status, name).toBe(401);
    }
  });

  it('return 500 when persistence is misconfigured', async () => {
    getServerContext.mockResolvedValue({ ok: false, status: 500, error: 'Persistence is not configured.' });
    const mod = await loadRoute('home');
    const res = await (mod.GET as Handler)(new Request('http://localhost/api/home'));
    expect(res.status).toBe(500);
  });

  it('serve normally with a valid context (scoped to that user)', async () => {
    getServerContext.mockResolvedValue(okContext());
    const home = await loadRoute('home');
    const res = await (home.GET as Handler)(new Request('http://localhost/api/home'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ home: null }); // fresh user, no onboarding

    getServerContext.mockResolvedValue(okContext());
    const insights = await loadRoute('insights');
    const ir = await (insights.GET as Handler)(new Request('http://localhost/api/insights'));
    expect(ir.status).toBe(200);
    expect(await ir.json()).toEqual({ insights: [] });
  });
});
