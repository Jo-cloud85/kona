import { respondToRecommendation } from '../../../../lib/kona-server';
import { requireContext } from '../../../../lib/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request): Promise<Response> {
  const c = await requireContext();
  if ('response' in c) return c.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  if (b.action !== 'accept' && b.action !== 'decline') {
    return Response.json({ error: "action must be 'accept' or 'decline'." }, { status: 400 });
  }
  if (typeof b.recommendation_id !== 'string' || !b.recommendation_id) {
    return Response.json({ error: 'recommendation_id is required.' }, { status: 400 });
  }
  if (typeof b.session_id !== 'string' || !b.session_id) {
    return Response.json({ error: 'session_id is required.' }, { status: 400 });
  }
  if (b.action === 'accept' && (typeof b.to_date !== 'string' || !DATE_RE.test(b.to_date))) {
    return Response.json({ error: 'to_date must be YYYY-MM-DD.' }, { status: 400 });
  }

  const result = await respondToRecommendation(c.ctx, {
    action: b.action,
    recommendation_id: b.recommendation_id,
    session_id: b.session_id,
    to_date: typeof b.to_date === 'string' ? b.to_date : '',
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: 404 });
  return Response.json(result);
}
