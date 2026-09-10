import 'server-only';
import { getServerContext, type KonaContext } from './server-context';

/**
 * Resolve the request context or produce the error Response. Every API route
 * starts with this so unauthenticated / misconfigured calls are rejected
 * uniformly before any use-case runs.
 */
export async function requireContext(): Promise<{ ctx: KonaContext } | { response: Response }> {
  const r = await getServerContext();
  if (r.ok) return { ctx: r.ctx };
  return { response: Response.json({ error: r.error }, { status: r.status }) };
}
