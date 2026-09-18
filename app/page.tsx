import { getServerContext } from '../lib/server-context';
import { getProfile } from '../lib/kona-server';
import HomeGate from './HomeGate';

// Auth-gated, per-user content — never statically cache this page.
export const dynamic = 'force-dynamic';

/**
 * Server Component: resolves the signed-in athlete's profile before any HTML
 * is sent, so the client never has to render a "Loading…" placeholder and
 * then fetch /api/profile just to learn which view to show. That extra round
 * trip was pure dead time on a cold load, worst on a phone over cellular.
 */
export default async function Page() {
  const result = await getServerContext();
  const profile = result.ok ? await getProfile(result.ctx) : undefined;

  return <HomeGate initialOnboarded={Boolean(profile?.onboarded_at)} initialUsername={profile?.username} />;
}
