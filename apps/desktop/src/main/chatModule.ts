import path from "node:path";
import {
  ChatService,
  ChatStore,
  OllamaClient,
  openChatDatabase,
  type ChatDatabase,
  type LLMClient,
} from "@archi/chat";
import type { SearchService } from "@archi/search";

export type ChatModule = {
  llm: LLMClient;
  service: ChatService;
  store: ChatStore;
  db: ChatDatabase;
};

export function createChatModule(opts: {
  search: SearchService;
  userDataPath: string;
}): ChatModule {
  const db = openChatDatabase(path.join(opts.userDataPath, "chat.sqlite"));
  const store = new ChatStore(db);
  const llm = new OllamaClient();
  const service = new ChatService({ search: opts.search, llm, store });
  return { llm, service, store, db };
}
