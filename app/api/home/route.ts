import { getHome } from '../../../lib/kona-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const date = new URL(req.url).searchParams.get('date');
  const valid = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  return Response.json({ home: await getHome(valid) });
}
