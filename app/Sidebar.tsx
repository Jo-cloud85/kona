'use client';

export interface ConversationRow {
  id: string;
  title: string;
  message_count: number;
  updated_at: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  open,
  onClose,
}: {
  conversations: ConversationRow[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  open: boolean;
  onClose: () => void;
}) {
  const rows = conversations.filter((c) => c.message_count > 0);
  const hasActiveRow = rows.some((c) => c.id === activeId);

  return (
    <>
      {open && <div className="sidebar-scrim" onClick={onClose} />}
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-head">
          <span>Chats</span>
          <button className="new-chat" onClick={onNew}>
            + New chat
          </button>
        </div>
        <nav className="conv-list">
          {!hasActiveRow && (
            <button className="conv-row active" aria-current="true">
              <span className="conv-title">New chat</span>
              <span className="conv-meta">unsaved</span>
            </button>
          )}
          {rows.map((c) => (
            <button
              key={c.id}
              className={`conv-row${c.id === activeId ? ' active' : ''}`}
              onClick={() => onSelect(c.id)}
              aria-current={c.id === activeId ? 'true' : undefined}
            >
              <span className="conv-title">{c.title || 'Untitled'}</span>
              <span className="conv-meta">
                {relativeTime(c.updated_at)} · {c.message_count}
              </span>
            </button>
          ))}
          {rows.length === 0 && hasActiveRow && <p className="conv-empty">No past chats yet.</p>}
        </nav>
      </aside>
    </>
  );
}
