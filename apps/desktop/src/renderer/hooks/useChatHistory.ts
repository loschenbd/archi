import { useCallback, useEffect, useState } from "react";
import type { ChatConversation } from "@archi/chat";

export type UseChatHistoryResult = {
  conversations: ChatConversation[];
  refresh: () => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export function useChatHistory(): UseChatHistoryResult {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);

  const refresh = useCallback(async () => {
    const list = await window.archi.chat.listConversations();
    setConversations(list);
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.archi.chat.onHistoryChanged(() => void refresh());
    return () => off();
  }, [refresh]);

  const rename = useCallback(
    async (id: string, title: string) => {
      await window.archi.chat.renameConversation(id, title);
      // historyChanged broadcast will refresh; no need to await.
    },
    []
  );

  const remove = useCallback(async (id: string) => {
    await window.archi.chat.deleteConversation(id);
  }, []);

  return { conversations, refresh, rename, remove };
}
