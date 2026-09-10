import { createSupabaseServerClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  return Response.json({ ok: true });
}
