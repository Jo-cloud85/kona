import { getInsights } from '../../../lib/kona-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return Response.json({ insights: await getInsights() });
}
