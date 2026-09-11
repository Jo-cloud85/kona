import { editMessage, getStarter, listMessages, llmName, sendMessage } from '../../../lib/kona-server';
import { requireContext } from '../../../lib/route-helpers';

// The core uses node:crypto and an in-memory store — must run on the Node runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MESSAGE_LEN = 2000;
const CONV_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MSG_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export async function GET(req: Request): Promise<Response> {
  const c = await requireContext();
  if ('response' in c) return c.response;

  const conversationId = new URL(req.url).searchParams.get('conversationId') ?? '';
  if (!CONV_ID_RE.test(conversationId)) {
    return Response.json({ error: 'invalid conversationId' }, { status: 400 });
  }
  const messages = await listMessages(c.ctx, conversationId);
  return Response.json({
    llm: llmName(),
    messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, at: m.created_at })),
    starter: messages.length === 0 ? await getStarter(c.ctx) : null,
  });
}

export async function POST(req: Request): Promise<Response> {
  const c = await requireContext();
  if ('response' in c) return c.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const { message, conversationId, editMessageId } = (body ?? {}) as {
    message?: unknown;
    conversationId?: unknown;
    editMessageId?: unknown;
  };

  if (typeof message !== 'string' || message.trim().length === 0) {
    return Response.json({ error: 'message is required' }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return Response.json({ error: `message exceeds ${MAX_MESSAGE_LEN} characters` }, { status: 400 });
  }
  const convId = typeof conversationId === 'string' && conversationId ? conversationId : 'web';
  if (!CONV_ID_RE.test(convId)) {
    return Response.json({ error: 'invalid conversationId' }, { status: 400 });
  }
  let editId: string | undefined;
  if (editMessageId !== undefined && editMessageId !== null) {
    if (typeof editMessageId !== 'string' || !MSG_ID_RE.test(editMessageId)) {
      return Response.json({ error: 'invalid editMessageId' }, { status: 400 });
    }
    editId = editMessageId;
  }

  try {
    const { turn, session_prompts, reconciled } = editId
      ? await editMessage(c.ctx, convId, editId, message.trim())
      : await sendMessage(c.ctx, convId, message.trim());
    return Response.json({
      reply: turn.reply,
      intent: turn.intent,
      safety_escalated: turn.safety.escalate,
      clarifying_question: turn.clarifying_question ?? null,
      session_prompts,
      user_message_id: turn.user_message_id,
      assistant_message_id: turn.assistant_message_id,
      ...(reconciled ? { reconciled } : {}),
    });
  } catch (err) {
    console.error('kona chat error', err);
    const raw = err instanceof Error ? err.message : String(err);
    // The Anthropic SDK throws with a `status` field for API errors.
    const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : undefined;
    const apiIssue = status !== undefined || /anthropic|credit balance|invalid_request_error|authentication_error|rate.?limit|overloaded/i.test(raw);
    const error = apiIssue
      ? `The AI service returned an error${status ? ` (${status})` : ''}. Check the server console — for a billing or API-key problem, fix that or run without ANTHROPIC_API_KEY to use the built-in deterministic mode.`
      : 'Kona hit an error handling that message.';
    return Response.json({ error, detail: raw }, { status: 502 });
  }
}
