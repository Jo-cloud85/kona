import { listConversations } from '../../../lib/kona-server';
import { requireContext } from '../../../lib/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const c = await requireContext();
  if ('response' in c) return c.response;
  return Response.json({ conversations: await listConversations(c.ctx) });
}
