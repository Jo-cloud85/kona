import { getProfile, saveProfile } from '../../../lib/kona-server';
import { validateProfileInput } from '../../../src/domain/profile-input';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const profile = await getProfile();
  return Response.json({ profile: profile ?? null });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const result = validateProfileInput(body);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  try {
    const profile = await saveProfile(result.data);
    return Response.json({ profile });
  } catch (err) {
    console.error('kona profile error', err);
    return Response.json({ error: 'Could not save your profile.' }, { status: 500 });
  }
}
