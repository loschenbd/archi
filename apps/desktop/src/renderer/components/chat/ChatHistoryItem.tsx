import { useEffect, useRef, useState } from "react";
import type { ChatConversation } from "@archi/chat";

export type ChatHistoryItemProps = {
  conversation: ChatConversation;
  active: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onRequestDelete: (id: string) => void;
};

export function ChatHistoryItem(props: ChatHistoryItemProps): JSX.Element {
  const { conversation, active, onSelect, onRename, onRequestDelete } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }
  }, [editing]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  const commitRename = async (): Promise<void> => {
    const next = draft.trim();
    if (next && next !== conversation.title) {
      await onRename(conversation.id, next);
    } else {
      setDraft(conversation.title);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="chat-history-item chat-history-item--editing">
        <input
          ref={inputRef}
          className="ui-input ui-input--sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commitRename();
            } else if (e.key === "Escape") {
              setDraft(conversation.title);
              setEditing(false);
            }
          }}
          maxLength={60}
        />
      </div>
    );
  }

  return (
    <div
      className={`chat-history-item${active ? " chat-history-item--active" : ""}`}
    >
      <button
        type="button"
        className="chat-history-item-title"
        onClick={() => onSelect(conversation.id)}
        title={conversation.title}
      >
        {conversation.title}
      </button>
      <div className="chat-history-item-menu">
        <button
          type="button"
          className="ui-btn ui-btn--ghost ui-btn--sm chat-history-item-kebab"
          aria-label="More"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          ⋯
        </button>
        {menuOpen ? (
          <div className="chat-history-item-popup" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="ui-btn ui-btn--ghost ui-btn--sm"
              onClick={() => {
                setMenuOpen(false);
                setDraft(conversation.title);
                setEditing(true);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="ui-btn ui-btn--ghost ui-btn--sm chat-history-item-popup-danger"
              onClick={() => {
                setMenuOpen(false);
                onRequestDelete(conversation.id);
              }}
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
