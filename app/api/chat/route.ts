import { listMessages, llmName, sendMessage } from '../../../lib/kona-server';

// The core uses node:crypto and an in-memory store — must run on the Node runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MESSAGE_LEN = 2000;
const CONV_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export async function GET(req: Request): Promise<Response> {
  const conversationId = new URL(req.url).searchParams.get('conversationId') ?? '';
  if (!CONV_ID_RE.test(conversationId)) {
    return Response.json({ error: 'invalid conversationId' }, { status: 400 });
  }
  const messages = await listMessages(conversationId);
  return Response.json({
    llm: llmName(),
    messages: messages.map((m) => ({ role: m.role, content: m.content, at: m.created_at })),
  });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const { message, conversationId } = (body ?? {}) as { message?: unknown; conversationId?: unknown };

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

  try {
    const turn = await sendMessage(convId, message.trim());
    return Response.json({
      reply: turn.reply,
      intent: turn.intent,
      safety_escalated: turn.safety.escalate,
      clarifying_question: turn.clarifying_question ?? null,
    });
  } catch (err) {
    console.error('kona chat error', err);
    return Response.json(
      { error: 'Kona hit an error handling that message.', detail: err instanceof Error ? err.message : undefined },
      { status: 500 },
    );
  }
}
