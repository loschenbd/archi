import { ChatService, OllamaClient, type LLMClient } from "@archi/chat";
import type { SearchService } from "@archi/search";

export type ChatModule = {
  llm: LLMClient;
  service: ChatService;
};

export function createChatModule(opts: { search: SearchService }): ChatModule {
  const llm = new OllamaClient();
  const service = new ChatService({ search: opts.search, llm });
  return { llm, service };
}
