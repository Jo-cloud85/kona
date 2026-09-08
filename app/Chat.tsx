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

interface SPOption {
  label: string;
  value: string;
  minutes?: number;
}

interface SessionPrompt {
  date: string;
  weekday_label: string;
  sport: string;
  session_index: number;
  label: string;
  ask_intensity: boolean;
  ask_size: boolean;
  ask_time: boolean;
  intensity_options: SPOption[];
  size_options: SPOption[];
  time_options: SPOption[];
}

export default function Chat({
  conversationId,
  greetingName,
  initialPrefill,
  onPrefillConsumed,
  onActivity,
  onMenu,
}: {
  conversationId: string;
  greetingName?: string;
  initialPrefill?: string;
  onPrefillConsumed?: () => void;
  onActivity?: () => void;
  onMenu?: () => void;
}) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [starter, setStarter] = useState<Starter | null>(null);
  const [prompts, setPrompts] = useState<SessionPrompt[]>([]);
  const [picks, setPicks] = useState<Record<string, { intensity?: string; size?: string; time?: string }>>({});
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [llm, setLlm] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEntries([]);
    setStarter(null);
    setPrompts([]);
    setPicks({});
    fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`)
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
  }, [conversationId]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [entries, busy, prompts]);

  const send = useCallback(
    async (text?: string) => {
      const message = (text ?? draft).trim();
      if (!message || busy) return;
      setDraft('');
      setStarter(null);
      setPrompts([]);
      setPicks({});
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
        if (res.ok && Array.isArray(data.session_prompts) && data.session_prompts.length) {
          setPrompts(data.session_prompts as SessionPrompt[]);
        }
        onActivity?.();
      } catch {
        setEntries((prev) => [...prev, { role: 'assistant', content: 'Network error — try again.', intent: 'error' }]);
      } finally {
        setBusy(false);
      }
    },
    [draft, busy, conversationId, onActivity],
  );

  const usePrompt = useCallback((prefill: string) => {
    setDraft(prefill);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(prefill.length, prefill.length);
      }
    });
  }, []);

  // A prefill handed in from another tab ("Add a workout in chat") drops into
  // the composer once, then the parent clears it.
  useEffect(() => {
    if (initialPrefill && initialPrefill.trim()) {
      usePrompt(initialPrefill);
      onPrefillConsumed?.();
    }
  }, [initialPrefill, onPrefillConsumed, usePrompt]);

  const key = (p: SessionPrompt) => `${p.date}#${p.session_index}`;
  const pick = (p: SessionPrompt, field: 'intensity' | 'size' | 'time', value: string) =>
    setPicks((prev) => {
      const cur = prev[key(p)] ?? {};
      return { ...prev, [key(p)]: { ...cur, [field]: cur[field] === value ? undefined : value } };
    });

  const answeredCount = prompts.filter((p) => {
    const s = picks[key(p)];
    return s && (s.intensity || s.size || s.time);
  }).length;

  const submitPicks = () => {
    const clauses = prompts
      .map((p) => {
        const s = picks[key(p)];
        if (!s || (!s.intensity && !s.size && !s.time)) return null;
        const bits = [s.intensity, s.size ? `~${s.size}` : '', s.time].filter(Boolean).join(', ');
        return `${p.weekday_label} ${p.sport}: ${bits}`;
      })
      .filter(Boolean);
    if (clauses.length) void send(clauses.join('. ') + '.');
  };

  return (
    <div className="chat">
      <header className="header">
        {onMenu && (
          <button className="menu-btn" aria-label="Conversations" onClick={onMenu}>
            ☰
          </button>
        )}
        <div className="header-title">
          <h1>Kona</h1>
          <p>
            {greetingName ? `Hi ${greetingName} — ` : ''}your AI endurance companion
            {llm ? ` · ${llm}` : ''}
          </p>
        </div>
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

        {prompts.length > 0 && !busy && (
          <div className="row assistant">
            <div className="prompt-panel">
              <p className="prompt-panel-title">Set the effort, length and time for each session:</p>
              {prompts.map((p) => (
                <div key={key(p)} className="prompt-row">
                  <span className="prompt-label">{p.label}</span>
                  {p.ask_intensity && (
                    <div className="opts">
                      {p.intensity_options.map((o) => (
                        <button
                          key={o.value}
                          className={picks[key(p)]?.intensity === o.value ? 'on' : ''}
                          onClick={() => pick(p, 'intensity', o.value)}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {p.ask_size && (
                    <div className="opts">
                      {p.size_options.map((o) => (
                        <button
                          key={o.value}
                          className={picks[key(p)]?.size === o.value ? 'on' : ''}
                          onClick={() => pick(p, 'size', o.value)}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {p.ask_time && (
                    <div className="opts">
                      {p.time_options.map((o) => (
                        <button
                          key={o.value}
                          className={picks[key(p)]?.time === o.value ? 'on' : ''}
                          onClick={() => pick(p, 'time', o.value)}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <button className="cta prompt-save" disabled={answeredCount === 0} onClick={submitPicks}>
                {answeredCount === 0
                  ? 'Pick some options above'
                  : `Save ${answeredCount} session${answeredCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}

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
