import { getWeek } from '../../../lib/kona-server';
import { requireContext, requestTimezone } from '../../../lib/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const c = await requireContext();
  if ('response' in c) return c.response;
  return Response.json({ week: await getWeek(c.ctx, requestTimezone(req)) });
}
