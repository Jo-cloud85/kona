'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
  intent?: string;
  safety?: boolean;
  detail?: string;
}

interface Starter {
  greeting: string;
  prompts: { label: string; prefill: string }[];
}

const CONV_KEY = 'kona.conversationId';

function getConversationId(): string {
  if (typeof window === 'undefined') return 'web';
  try {
    let id = window.localStorage.getItem(CONV_KEY);
    if (!id) {
      id = `web-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(CONV_KEY, id);
    }
    return id;
  } catch {
    return `web-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export default function Chat({ greetingName }: { greetingName?: string }) {
  const [conversationId, setConversationId] = useState('web');
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [starter, setStarter] = useState<Starter | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [llm, setLlm] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const id = getConversationId();
    setConversationId(id);
    fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data: { llm?: string; messages?: ChatEntry[]; starter?: Starter | null }) => {
        if (data.llm) setLlm(data.llm);
        if (data.messages?.length) {
          setEntries(data.messages.map((m) => ({ role: m.role, content: m.content })));
        } else if (data.starter) {
          setStarter(data.starter);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [entries, busy]);

  const send = useCallback(
    async (text?: string) => {
      const message = (text ?? draft).trim();
      if (!message || busy) return;
      setDraft('');
      setStarter(null);
      setEntries((prev) => [...prev, { role: 'user', content: message }]);
      setBusy(true);
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message, conversationId }),
        });
        const data = await res.json();
        setEntries((prev) => [
          ...prev,
          res.ok
            ? { role: 'assistant', content: data.reply, intent: data.intent, safety: data.safety_escalated }
            : {
                role: 'assistant',
                content: data.error ?? 'Something went wrong.',
                intent: 'error',
                detail: typeof data.detail === 'string' ? data.detail : undefined,
              },
        ]);
      } catch {
        setEntries((prev) => [...prev, { role: 'assistant', content: 'Network error — try again.', intent: 'error' }]);
      } finally {
        setBusy(false);
      }
    },
    [draft, busy, conversationId],
  );

  const usePrompt = (prefill: string) => {
    setDraft(prefill);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(prefill.length, prefill.length);
      }
    });
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Kona</h1>
        <p>
          {greetingName ? `Hi ${greetingName} — ` : ''}your AI fueling companion for training
          {llm ? ` · ${llm}` : ''}
        </p>
      </header>

      <div className="thread" ref={threadRef}>
        {entries.length === 0 && !starter && (
          <div className="empty">
            Tell Kona about a session, e.g. <code>Tomorrow I&apos;m doing an 18km run at 6am.</code>
          </div>
        )}

        {entries.length === 0 && starter && (
          <div className="row assistant">
            <div className="bubble">{starter.greeting}</div>
            <div className="starters">
              {starter.prompts.map((p) => (
                <button key={p.label} className="starter-chip" onClick={() => usePrompt(p.prefill)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {entries.map((e, i) => (
          <div key={i} className={`row ${e.role}`}>
            <div className="bubble">{e.content}</div>
            {e.role === 'assistant' && e.detail && <div className="detail">{e.detail}</div>}
            {e.role === 'assistant' && (e.intent || e.safety) && (
              <div className={`meta${e.safety ? ' safety' : ''}`}>
                {e.safety ? 'safety escalation' : e.intent}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="row assistant">
            <div className="bubble typing" aria-label="Kona is typing">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}
      </div>

      <div className="composer">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' && !ev.shiftKey) {
              ev.preventDefault();
              void send();
            }
          }}
          placeholder="Message Kona…"
          rows={1}
        />
        <button onClick={() => void send()} disabled={busy || draft.trim().length === 0}>
          Send
        </button>
      </div>
    </div>
  );
}
