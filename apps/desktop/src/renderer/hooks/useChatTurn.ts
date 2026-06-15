import { useEffect, useRef, useState, useCallback } from "react";
import type {
  ChatTurnDoneEvent,
  ChatTurnRequest,
} from "@archi/chat";

type TurnStatus = "streaming" | "done" | "aborted" | "error" | "skipped";

export type UseChatTurnResult = {
  turnId: string | null;
  conversationId: string | null;
  status: TurnStatus | null;
  text: string;
  citations: ChatTurnDoneEvent["citations"];
  errorMessage: string | null;
  skipReason: ChatTurnDoneEvent["skipReason"] | null;
  send: (req: Omit<ChatTurnRequest, "turnId">) => Promise<void>;
  cancel: () => void;
  reset: () => void;
};

function uuid(): string {
  return crypto.randomUUID();
}

export function useChatTurn(): UseChatTurnResult {
  const [turnId, setTurnId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [status, setStatus] = useState<TurnStatus | null>(null);
  const [text, setText] = useState("");
  const [citations, setCitations] = useState<ChatTurnDoneEvent["citations"]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState<ChatTurnDoneEvent["skipReason"] | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);

  useEffect(() => {
    const offToken = window.archi.chat.onToken((e) => {
      if (e.turnId !== activeTurnIdRef.current) return;
      setText((prev) => prev + e.delta);
    });
    const offDone = window.archi.chat.onDone((e) => {
      if (e.turnId !== activeTurnIdRef.current) return;
      setCitations(e.citations);
      setConversationId(e.conversationId);
      if (e.skipped) {
        setStatus("skipped");
        setSkipReason(e.skipReason ?? null);
      } else {
        setStatus("done");
      }
    });
    const offError = window.archi.chat.onError((e) => {
      if (e.turnId !== activeTurnIdRef.current) return;
      if (e.conversationId) setConversationId(e.conversationId);
      setStatus("error");
      setErrorMessage(e.message);
    });
    const offAborted = window.archi.chat.onAborted((e) => {
      if (e.turnId !== activeTurnIdRef.current) return;
      if (e.conversationId) setConversationId(e.conversationId);
      setStatus("aborted");
    });
    return () => {
      offToken();
      offDone();
      offError();
      offAborted();
    };
  }, []);

  const reset = useCallback(() => {
    activeTurnIdRef.current = null;
    setTurnId(null);
    setConversationId(null);
    setStatus(null);
    setText("");
    setCitations([]);
    setErrorMessage(null);
    setSkipReason(null);
  }, []);

  const send = useCallback(
    async (req: Omit<ChatTurnRequest, "turnId">) => {
      const id = uuid();
      activeTurnIdRef.current = id;
      setTurnId(id);
      setStatus("streaming");
      setText("");
      setCitations([]);
      setErrorMessage(null);
      setSkipReason(null);
      await window.archi.chat.turn({ ...req, turnId: id });
    },
    []
  );

  const cancel = useCallback(() => {
    const id = activeTurnIdRef.current;
    if (!id) return;
    void window.archi.chat.cancel(id);
  }, []);

  return {
    turnId,
    conversationId,
    status,
    text,
    citations,
    errorMessage,
    skipReason,
    send,
    cancel,
    reset,
  };
}
