import 'server-only';
import { getServerContext, type KonaContext } from './server-context';
import { safeTz } from '../src/domain/time';

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

/**
 * The athlete's IANA timezone, sent by the client (see app/client-tz.ts) —
 * the only place that reliably knows it, since the server's own clock/OS
 * timezone (UTC on Vercel) is not the athlete's. Falls back to UTC — the
 * previous (wrong-but-consistent) behaviour — when a client hasn't been
 * updated to send it yet, rather than failing the request.
 */
export function requestTimezone(req: Request): string {
  return safeTz(req.headers.get('x-kona-tz'));
}
