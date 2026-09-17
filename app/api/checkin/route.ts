import { submitCheckin } from '../../../lib/kona-server';
import { requireContext } from '../../../lib/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LEGS = ['fresh', 'normal', 'heavy'];
const SLEEP_LEVELS = ['poor', 'ok', 'good'];
const MOOD_LEVELS = ['low', 'ok', 'good'];
const OUTCOMES = ['better', 'worse', 'same'];

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

  const legs = typeof b.legs === 'string' ? b.legs.trim().toLowerCase() : '';
  if (!LEGS.includes(legs)) {
    return Response.json({ error: 'Pick how the legs felt.' }, { status: 400 });
  }
  if (typeof b.went_as_planned !== 'boolean' || typeof b.pains !== 'boolean') {
    return Response.json({ error: 'Answer the yes/no questions.' }, { status: 400 });
  }
  const sleep_quality =
    typeof b.sleep_quality === 'string' && SLEEP_LEVELS.includes(b.sleep_quality)
      ? (b.sleep_quality as 'poor' | 'ok' | 'good')
      : undefined;
  const mood = typeof b.mood === 'string' && MOOD_LEVELS.includes(b.mood) ? (b.mood as 'low' | 'ok' | 'good') : undefined;
  const elaborate =
    typeof b.elaborate === 'string' && b.elaborate.trim() ? b.elaborate.trim().slice(0, 500) : undefined;

  // M24.5 — optional: only present when Home showed a real Kona Briefing
  // action for today and the athlete answered the follow-up.
  const followed_recommendation = typeof b.followed_recommendation === 'boolean' ? b.followed_recommendation : undefined;
  const recommendation_outcome =
    followed_recommendation === true && typeof b.recommendation_outcome === 'string' && OUTCOMES.includes(b.recommendation_outcome)
      ? (b.recommendation_outcome as 'better' | 'worse' | 'same')
      : undefined;
  const category =
    followed_recommendation === true && typeof b.category === 'string' && b.category ? b.category : undefined;

  try {
    const result = await submitCheckin(c.ctx, {
      legs: legs as 'fresh' | 'normal' | 'heavy',
      went_as_planned: b.went_as_planned,
      pains: b.pains,
      sleep_quality,
      mood,
      elaborate,
      followed_recommendation,
      recommendation_outcome,
      category,
    });
    if (!result) return Response.json({ error: 'Finish onboarding first.' }, { status: 409 });
    return Response.json(result);
  } catch (err) {
    // An uncaught throw here (e.g. a DB error) was reaching the client as a
    // non-JSON 500 page, which res.json() then failed to parse — surfacing
    // as a generic, unhelpful "Network error" (founder report, M27.4).
    console.error('kona checkin error', err);
    return Response.json({ error: 'Could not save that check-in — try again.' }, { status: 500 });
  }
}
