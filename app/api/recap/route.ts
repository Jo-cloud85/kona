import { getSessionRecap } from '../../../lib/kona-server';
import { requireContext, requestTimezone } from '../../../lib/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request): Promise<Response> {
  const c = await requireContext();
  if ('response' in c) return c.response;
  const date = new URL(req.url).searchParams.get('date');
  if (!date || !ISO_DATE.test(date)) return Response.json({ error: 'date (YYYY-MM-DD) is required' }, { status: 400 });
  return Response.json({ recap: await getSessionRecap(c.ctx, date, requestTimezone(req)) });
}
