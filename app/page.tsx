'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
  intent?: string;
  safety?: boolean;
}

const CONV_KEY = 'kona.conversationId';

function getConversationId(): string {
  if (typeof window === 'undefined') return 'web';
  let id = window.localStorage.getItem(CONV_KEY);
  if (!id) {
    id = `web-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(CONV_KEY, id);
  }
  return id;
}

export default function Page() {
  const [conversationId, setConversationId] = useState('web');
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [llm, setLlm] = useState<string>('');
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = getConversationId();
    setConversationId(id);
    fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data: { llm?: string; messages?: ChatEntry[] }) => {
        if (data.llm) setLlm(data.llm);
        if (data.messages?.length) setEntries(data.messages.map((m) => ({ role: m.role, content: m.content })));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [entries, busy]);

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || busy) return;
    setDraft('');
    setEntries((prev) => [...prev, { role: 'user', content: message }]);
    setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, conversationId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEntries((prev) => [
          ...prev,
          { role: 'assistant', content: data.error ?? 'Something went wrong.', intent: 'error' },
        ]);
      } else {
        setEntries((prev) => [
          ...prev,
          { role: 'assistant', content: data.reply, intent: data.intent, safety: data.safety_escalated },
        ]);
      }
    } catch {
      setEntries((prev) => [...prev, { role: 'assistant', content: 'Network error — try again.', intent: 'error' }]);
    } finally {
      setBusy(false);
    }
  }, [draft, busy, conversationId]);

  return (
    <div className="app">
      <header className="header">
        <h1>Kona</h1>
        <p>Your AI fueling companion for training{llm ? ` · ${llm}` : ''}</p>
      </header>

      <div className="thread" ref={threadRef}>
        {entries.length === 0 && (
          <div className="empty">
            Tell Kona about a session, e.g. <code>Tomorrow I&apos;m doing an 18km run at 6am.</code>
          </div>
        )}
        {entries.map((e, i) => (
          <div key={i} className={`row ${e.role}`}>
            <div>
              <div className="bubble">{e.content}</div>
              {e.role === 'assistant' && (e.intent || e.safety) && (
                <div className={`meta${e.safety ? ' safety' : ''}`}>
                  {e.safety ? 'safety escalation' : e.intent}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="row assistant">
            <div className="bubble">…</div>
          </div>
        )}
      </div>

      <div className="composer">
        <textarea
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
