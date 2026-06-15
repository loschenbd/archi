import { useMemo, useState } from "react";
import type { ChatConversation } from "@archi/chat";
import { ChatHistoryItem } from "./ChatHistoryItem.js";
import { ChatHistoryDeleteModal } from "./ChatHistoryDeleteModal.js";

export type ChatHistoryRailProps = {
  conversations: ChatConversation[];
  activeId: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

type Bucket = { label: string; rows: ChatConversation[] };

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketize(conversations: ChatConversation[]): Bucket[] {
  const now = Date.now();
  const today = startOfDay(now);
  const yesterday = today - 24 * 60 * 60 * 1000;
  const buckets: Bucket[] = [
    { label: "Today", rows: [] },
    { label: "Yesterday", rows: [] },
    { label: "Earlier", rows: [] },
  ];
  for (const c of conversations) {
    if (c.updatedAt >= today) buckets[0]!.rows.push(c);
    else if (c.updatedAt >= yesterday) buckets[1]!.rows.push(c);
    else buckets[2]!.rows.push(c);
  }
  return buckets.filter((b) => b.rows.length > 0);
}

export function ChatHistoryRail(props: ChatHistoryRailProps): JSX.Element {
  const {
    conversations,
    activeId,
    collapsed,
    onToggleCollapsed,
    onSelect,
    onNewChat,
    onRename,
    onDelete,
  } = props;
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const buckets = useMemo(() => bucketize(conversations), [conversations]);
  const pendingDelete = useMemo(
    () => conversations.find((c) => c.id === pendingDeleteId) ?? null,
    [pendingDeleteId, conversations]
  );

  if (collapsed) {
    return (
      <aside className="chat-history-rail chat-history-rail--collapsed" aria-label="Chat history">
        <button
          type="button"
          className="ui-btn ui-btn--ghost chat-history-rail-new chat-history-rail-new--icon"
          onClick={onNewChat}
          aria-label="New chat"
          title="New chat"
        >
          +
        </button>
        <div className="chat-history-rail-dots" aria-hidden="true">
          {conversations.slice(0, 24).map((c) => (
            <span
              key={c.id}
              className={`chat-history-rail-dot${
                c.id === activeId ? " chat-history-rail-dot--active" : ""
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          className="ui-btn ui-btn--ghost chat-history-rail-toggle"
          onClick={onToggleCollapsed}
          aria-label="Expand history"
          title="Expand history"
        >
          »
        </button>
      </aside>
    );
  }

  return (
    <aside className="chat-history-rail" aria-label="Chat history">
      <button
        type="button"
        className="ui-btn ui-btn--secondary chat-history-rail-new"
        onClick={onNewChat}
      >
        + New chat
      </button>
      <div className="chat-history-rail-list">
        {buckets.length === 0 ? (
          <div className="chat-history-rail-empty">
            <span className="ui-fleuron" aria-hidden="true" />
            <p>Your conversations will appear here.</p>
          </div>
        ) : (
          buckets.map((b) => (
            <section key={b.label} className="chat-history-rail-group">
              <div className="ui-card__eyebrow chat-history-rail-group-label">{b.label}</div>
              {b.rows.map((c) => (
                <ChatHistoryItem
                  key={c.id}
                  conversation={c}
                  active={c.id === activeId}
                  onSelect={onSelect}
                  onRename={onRename}
                  onRequestDelete={(id) => setPendingDeleteId(id)}
                />
              ))}
            </section>
          ))
        )}
      </div>
      <button
        type="button"
        className="ui-btn ui-btn--ghost chat-history-rail-toggle"
        onClick={onToggleCollapsed}
        aria-label="Collapse history"
        title="Collapse history"
      >
        «
      </button>
      {pendingDelete ? (
        <ChatHistoryDeleteModal
          title={pendingDelete.title}
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={() => {
            const id = pendingDelete.id;
            setPendingDeleteId(null);
            void onDelete(id);
          }}
        />
      ) : null}
    </aside>
  );
}
