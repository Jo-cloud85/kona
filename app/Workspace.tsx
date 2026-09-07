'use client';

import { useCallback, useEffect, useState } from 'react';
import Chat from './Chat';
import Sidebar, { type ConversationRow } from './Sidebar';

const CONV_KEY = 'kona.conversationId';

function newConversationId(): string {
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function initialConversationId(): string {
  if (typeof window === 'undefined') return 'web';
  try {
    const stored = window.localStorage.getItem(CONV_KEY);
    if (stored) return stored;
    const id = newConversationId();
    window.localStorage.setItem(CONV_KEY, id);
    return id;
  } catch {
    return newConversationId();
  }
}

export default function Workspace({ greetingName }: { greetingName?: string }) {
  const [conversationId, setConversationId] = useState('web');
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const refreshList = useCallback(() => {
    fetch('/api/conversations')
      .then((r) => r.json())
      .then((d: { conversations?: ConversationRow[] }) => setConversations(d.conversations ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setConversationId(initialConversationId());
    refreshList();
  }, [refreshList]);

  const persist = (id: string) => {
    try {
      window.localStorage.setItem(CONV_KEY, id);
    } catch {
      /* ignore */
    }
    setConversationId(id);
    setSidebarOpen(false);
  };

  return (
    <div className="workspace">
      <Sidebar
        conversations={conversations}
        activeId={conversationId}
        onSelect={persist}
        onNew={() => persist(newConversationId())}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <Chat
        conversationId={conversationId}
        greetingName={greetingName}
        onActivity={refreshList}
        onMenu={() => setSidebarOpen(true)}
      />
    </div>
  );
}
