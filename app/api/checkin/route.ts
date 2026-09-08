import { submitCheckin } from '../../../lib/kona-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FEELS = ['Feeling great!', 'Breezed it', 'Solid grind', 'Survived', 'Dying...', "Didn't happen"];

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const workout_feel = typeof b.workout_feel === 'string' ? b.workout_feel.trim() : '';
  if (!workout_feel || workout_feel.length > 60 || !FEELS.includes(workout_feel)) {
    return Response.json({ error: 'Pick how the workout felt.' }, { status: 400 });
  }
  if (typeof b.went_as_planned !== 'boolean' || typeof b.pains !== 'boolean') {
    return Response.json({ error: 'Answer the yes/no questions.' }, { status: 400 });
  }
  const elaborate =
    typeof b.elaborate === 'string' && b.elaborate.trim() ? b.elaborate.trim().slice(0, 500) : undefined;

  const result = await submitCheckin({
    workout_feel,
    went_as_planned: b.went_as_planned,
    pains: b.pains,
    elaborate,
  });
  if (!result) return Response.json({ error: 'Finish onboarding first.' }, { status: 409 });
  return Response.json(result);
}
