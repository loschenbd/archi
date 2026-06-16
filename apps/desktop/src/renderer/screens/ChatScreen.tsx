import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ChatMessage } from "@archi/chat";
import type { SearchResult } from "@archi/search";
import { ChatMessageBubble } from "../components/chat/ChatMessageBubble.js";
import { ChatCitationList } from "../components/chat/ChatCitationList.js";
import { ChatStatusBadge } from "../components/chat/ChatStatusBadge.js";
import { ChatHistoryRail } from "../components/chat/ChatHistoryRail.js";
import { ChatSetupScreen } from "./ChatSetupScreen.js";
import { useChatTurn } from "../hooks/useChatTurn.js";
import { useChatHistory } from "../hooks/useChatHistory.js";
import { toRoman } from "../utils/roman.js";

const PREF_MODEL = "chat.modelName";
const PREF_RAIL_COLLAPSED = "chat.historyRailCollapsed";

type RenderedMessage =
  | { kind: "user"; content: string }
  | {
      kind: "assistant";
      content: string;
      status: "streaming" | "done" | "aborted" | "error" | "skipped";
      citations: SearchResult[];
      errorMessage?: string | null;
      skipReason?: "no_passages" | null;
    };

export type ChatScreenProps = {
  onOpenWork: (workId: string, passageId: string) => void;
};

function jumpToCitation(messageId: string, n: number): void {
  const row = document.getElementById(`citation-${messageId}-${n}`);
  if (!row) return;
  const card = row.querySelector(".search-result-card") as HTMLElement | null;
  const target = card ?? row;
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  target.classList.remove("ui-footnote-flash");
  void target.offsetWidth;
  target.classList.add("ui-footnote-flash");
  window.setTimeout(() => target.classList.remove("ui-footnote-flash"), 2600);
}

function renderWithCitations(text: string, messageId: string, maxN: number): ReactNode {
  if (!text || maxN === 0) return text;
  const parts: ReactNode[] = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = match[1];
    if (raw === undefined) continue;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n < 1 || n > maxN) continue;
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <button
        key={`${messageId}-ref-${match.index}-${n}`}
        type="button"
        className="ui-footnote-ref"
        onClick={() => jumpToCitation(messageId, n)}
        aria-label={`Jump to source ${n}`}
      >
        {toRoman(n)}
      </button>
    );
    last = match.index + match[0].length;
  }
  if (parts.length === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function ChatScreen({ onOpenWork }: ChatScreenProps): JSX.Element {
  const [modelName, setModelName] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [transcript, setTranscript] = useState<RenderedMessage[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const turn = useChatTurn();
  const history = useChatHistory();
  const conversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    void (async () => {
      const stored = await window.archi.preferences.get<string | null>(PREF_MODEL, null);
      const railPref = await window.archi.preferences.get<boolean>(PREF_RAIL_COLLAPSED, false);
      setRailCollapsed(railPref);
      const detect = await window.archi.chat.detect();
      if (detect.status !== "ready" || !stored) {
        setNeedsSetup(true);
        return;
      }
      setModelName(stored);
      setNeedsSetup(false);
    })();
  }, []);

  // Keep the ref in sync with the turn-hook's reported conversationId so the
  // first turn's id propagates to follow-ups.
  useEffect(() => {
    if (turn.conversationId && turn.conversationId !== conversationIdRef.current) {
      conversationIdRef.current = turn.conversationId;
      setActiveConversationId(turn.conversationId);
    }
  }, [turn.conversationId]);

  useEffect(() => {
    if (turn.turnId === null) return;
    setTranscript((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.kind === "assistant") {
        next[next.length - 1] = {
          ...last,
          content: turn.text,
          status: turn.status ?? "streaming",
          citations: turn.citations as SearchResult[],
          errorMessage: turn.errorMessage,
          skipReason: turn.skipReason ?? null,
        };
      }
      return next;
    });
  }, [turn.text, turn.status, turn.citations, turn.errorMessage, turn.skipReason, turn.turnId]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  const handleConfigured = useCallback(async (name: string) => {
    await window.archi.preferences.set(PREF_MODEL, name);
    setModelName(name);
    setNeedsSetup(false);
  }, []);

  const handleSend = useCallback(async () => {
    const question = draft.trim();
    if (!question || !modelName) return;
    setDraft("");
    const history: ChatMessage[] = transcript.flatMap<ChatMessage>((m) =>
      m.kind === "user"
        ? [{ role: "user", content: m.content }]
        : m.status === "done"
          ? [{ role: "assistant", content: m.content }]
          : []
    );
    setTranscript((prev) => [
      ...prev,
      { kind: "user", content: question },
      {
        kind: "assistant",
        content: "",
        status: "streaming",
        citations: [],
        errorMessage: null,
        skipReason: null,
      },
    ]);
    await turn.send({
      question,
      history,
      modelName,
      conversationId: conversationIdRef.current ?? undefined,
    });
  }, [draft, modelName, transcript, turn]);

  const handleNewChat = useCallback(() => {
    turn.reset();
    conversationIdRef.current = null;
    setActiveConversationId(null);
    setTranscript([]);
    setDraft("");
  }, [turn]);

  const handleSelectConversation = useCallback(
    async (id: string) => {
      turn.cancel();
      turn.reset();
      const loaded = await window.archi.chat.loadConversation(id);
      conversationIdRef.current = id;
      setActiveConversationId(id);
      setModelName(loaded.conversation.modelName);

      // Collect all passage ids referenced by the assistant messages, hydrate
      // them in a single IPC call, then map back per-message. Hydration is
      // tolerant of missing passages — re-ingestion or deletion silently drops
      // them from the array.
      const allIds: string[] = [];
      for (const m of loaded.messages) {
        if (m.role === "assistant" && m.citations.length > 0) {
          for (const cid of m.citations) {
            if (!allIds.includes(cid)) allIds.push(cid);
          }
        }
      }
      const hydrated = allIds.length > 0
        ? await window.archi.search.getByPassageIds(allIds)
        : [];
      const byPassageId = new Map(hydrated.map((r) => [r.passageId, r]));

      const rebuilt: RenderedMessage[] = [];
      for (const m of loaded.messages) {
        if (m.role === "user") {
          rebuilt.push({ kind: "user", content: m.content });
        } else {
          const citations = m.citations
            .map((cid) => byPassageId.get(cid))
            .filter((r): r is SearchResult => r !== undefined);
          rebuilt.push({
            kind: "assistant",
            content: m.content,
            status: m.status === "done" ? "done" : m.status,
            citations,
            errorMessage: m.status === "error" ? (m.content || m.errorCode) : null,
            skipReason: m.status === "skipped" ? "no_passages" : null,
          });
        }
      }
      setTranscript(rebuilt);
    },
    [turn]
  );

  const handleToggleRail = useCallback(() => {
    setRailCollapsed((prev) => {
      const next = !prev;
      void window.archi.preferences.set(PREF_RAIL_COLLAPSED, next);
      return next;
    });
  }, []);

  if (needsSetup === null) {
    return (
      <div className="chat-screen chat-screen-loading">
        <span className="chat-spinner" aria-hidden="true" />
        <span>Loading chat…</span>
      </div>
    );
  }
  if (needsSetup) {
    return <ChatSetupScreen onConfigured={(name) => void handleConfigured(name)} />;
  }

  const sending = turn.status === "streaming";

  return (
    <div
      className={`chat-screen-with-rail${
        railCollapsed ? " chat-screen-with-rail--collapsed" : ""
      }`}
    >
      <ChatHistoryRail
        conversations={history.conversations}
        activeId={activeConversationId}
        collapsed={railCollapsed}
        onToggleCollapsed={handleToggleRail}
        onSelect={(id) => void handleSelectConversation(id)}
        onNewChat={handleNewChat}
        onRename={history.rename}
        onDelete={history.remove}
      />
      <div className="chat-screen">
        <header className="chat-screen-header">
          <ChatStatusBadge modelName={modelName} />
          <button
            type="button"
            className="ui-btn ui-btn--secondary ui-btn--sm"
            onClick={handleNewChat}
          >
            New chat
          </button>
        </header>
        <div className="chat-transcript" role="log" aria-live="polite" ref={transcriptRef}>
          {transcript.map((m, i) => {
            if (m.kind === "user") {
              return <ChatMessageBubble key={i} role="user" text={m.content} />;
            }
            if (m.status === "skipped") {
              return (
                <ChatMessageBubble
                  key={i}
                  role="assistant"
                  text="No passages in your library matched that. Try a broader question."
                />
              );
            }
            if (m.status === "error") {
              return (
                <ChatMessageBubble
                  key={i}
                  role="assistant"
                  text={m.errorMessage ?? "Something went wrong."}
                />
              );
            }
            if (m.status === "streaming" && !m.content) {
              return (
                <div key={i} className="chat-bubble chat-bubble-assistant chat-bubble-thinking">
                  <span className="chat-typing" aria-label="Thinking">
                    <span className="chat-typing-dot" />
                    <span className="chat-typing-dot" />
                    <span className="chat-typing-dot" />
                  </span>
                  <span className="chat-typing-caption">Thinking…</span>
                </div>
              );
            }
            if (m.status === "aborted" && !m.content) {
              const messageId = `m${i}`;
              const hasCitations = m.citations.length > 0;
              return (
                <div key={i} className="chat-message-block">
                  <ChatMessageBubble
                    role="assistant"
                    text="Stopped before a response."
                    ghosted
                  />
                  {hasCitations ? (
                    <ChatCitationList
                      citations={m.citations}
                      messageId={messageId}
                      onOpenWork={onOpenWork}
                    />
                  ) : null}
                </div>
              );
            }
            if (m.status === "done" && !m.content) {
              const messageId = `m${i}`;
              const hasCitations = m.citations.length > 0;
              return (
                <div key={i} className="chat-message-block">
                  <ChatMessageBubble
                    role="assistant"
                    text="(No response.)"
                    ghosted
                  />
                  {hasCitations ? (
                    <ChatCitationList
                      citations={m.citations}
                      messageId={messageId}
                      onOpenWork={onOpenWork}
                    />
                  ) : null}
                </div>
              );
            }
            const messageId = `m${i}`;
            const hasCitations =
              (m.status === "done" || m.status === "aborted") && m.citations.length > 0;
            const richText = renderWithCitations(m.content, messageId, m.citations.length);
            return (
              <div key={i} className="chat-message-block">
                <ChatMessageBubble
                  role="assistant"
                  text={richText}
                  ghosted={m.status === "aborted"}
                  footer={
                    m.status === "streaming" ? (
                      <span className="chat-typing chat-typing-inline" aria-hidden="true">
                        <span className="chat-typing-dot" />
                        <span className="chat-typing-dot" />
                        <span className="chat-typing-dot" />
                      </span>
                    ) : null
                  }
                />
                {hasCitations ? (
                  <ChatCitationList
                    citations={m.citations}
                    messageId={messageId}
                    onOpenWork={onOpenWork}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
        >
          <textarea
            className="ui-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (!sending && draft.trim()) void handleSend();
              }
            }}
            placeholder="Ask something about your library… (⌘↩ to send)"
            disabled={sending}
            rows={3}
          />
          <div className="chat-composer-actions">
            {sending ? (
              <button
                type="button"
                className="ui-btn ui-btn--secondary"
                onClick={turn.cancel}
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                className="ui-btn ui-btn--primary"
                disabled={!draft.trim()}
              >
                Send
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
