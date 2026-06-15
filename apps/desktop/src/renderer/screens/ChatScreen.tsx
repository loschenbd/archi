import { useCallback, useEffect, useState } from "react";
import type { ChatMessage } from "@archi/chat";
import type { SearchResult } from "@archi/search";
import { ChatMessageBubble } from "../components/chat/ChatMessageBubble.js";
import { ChatCitationList } from "../components/chat/ChatCitationList.js";
import { ChatStatusBadge } from "../components/chat/ChatStatusBadge.js";
import { ChatSetupScreen } from "./ChatSetupScreen.js";
import { useChatTurn } from "../hooks/useChatTurn.js";

const PREF_MODEL = "chat.modelName";

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

export function ChatScreen({ onOpenWork }: ChatScreenProps): JSX.Element {
  const [modelName, setModelName] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [transcript, setTranscript] = useState<RenderedMessage[]>([]);
  const turn = useChatTurn();

  useEffect(() => {
    void (async () => {
      const stored = await window.archi.preferences.get<string | null>(PREF_MODEL, null);
      const detect = await window.archi.chat.detect();
      if (detect.status !== "ready" || !stored) {
        setNeedsSetup(true);
        return;
      }
      setModelName(stored);
      setNeedsSetup(false);
    })();
  }, []);

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
    await turn.send({ question, history, modelName });
  }, [draft, modelName, transcript, turn]);

  const handleNewChat = useCallback(() => {
    turn.reset();
    setTranscript([]);
    setDraft("");
  }, [turn]);

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
    <div className="chat-screen">
      <header className="chat-screen-header">
        <ChatStatusBadge modelName={modelName} />
        <button type="button" className="chat-screen-new" onClick={handleNewChat}>
          New chat
        </button>
      </header>
      <div className="chat-screen-empty-hint">
        Conversations are not saved — close this window and they're gone.
      </div>
      <div className="chat-transcript" role="log" aria-live="polite">
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
          return (
            <div key={i}>
              <ChatMessageBubble
                role="assistant"
                text={m.content}
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
              {m.status === "done" || m.status === "aborted" ? (
                <ChatCitationList citations={m.citations} onOpenWork={onOpenWork} />
              ) : null}
            </div>
          );
        })}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask something about your library…"
          disabled={sending}
          rows={3}
        />
        {sending ? (
          <button type="button" onClick={turn.cancel}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!draft.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}
