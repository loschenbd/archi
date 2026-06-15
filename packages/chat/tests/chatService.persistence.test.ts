import { describe, expect, it } from "vitest";
import { ChatService } from "../src/chatService.js";
import { ChatStore } from "../src/persistence/chatStore.js";
import { openChatDatabase } from "../src/persistence/openChatDatabase.js";
import type { LLMClient } from "../src/llmClient.js";
import type { ChatDelta, ChatTurnRequest } from "../src/types.js";

function passage(id: string): import("@archi/search").SearchResult {
  return {
    passageId: id,
    body: "body",
    snippet: "",
    work: { id: `w-${id}`, displayTitle: "T", creator: "C" },
    labels: [],
    isStarred: false,
    scores: { fused: 0 },
    matchedVia: "vector" as const,
  };
}

function makeLLM(stream: ChatDelta[]): LLMClient {
  return {
    detect: async () => ({ status: "ready", modelCount: 1 }),
    listModels: async () => [],
    pullModel: async function* () {},
    chat: async function* () {
      for (const d of stream) yield d;
    },
  } as unknown as LLMClient;
}

function makeSearch(results: unknown[]) {
  return {
    query: async () => ({
      query: "",
      filters: {},
      results,
      totalCandidates: results.length,
      durationMs: 1,
    }),
  };
}

function makeRequest(overrides: Partial<ChatTurnRequest> = {}): ChatTurnRequest {
  return {
    turnId: "t1",
    question: "What is wisdom?",
    history: [],
    modelName: "llama3.1:8b",
    ...overrides,
  };
}

function makeStore(): ChatStore {
  return new ChatStore(openChatDatabase(":memory:"));
}

describe("ChatService persistence", () => {
  it("creates a conversation on first turn when no conversationId is provided", async () => {
    const store = makeStore();
    const events: Array<{ type: string; conversationId?: string | null }> = [];
    const passages = [passage("p1")];
    const service = new ChatService({
      search: makeSearch(passages) as never,
      llm: makeLLM([{ text: "hi", done: true }]),
      store,
    });
    await service.runTurn(makeRequest(), (e) => events.push(e));
    const done = events.find((e) => e.type === "done");
    expect(done?.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    const list = store.listConversations();
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe("What is wisdom?");
  });

  it("reuses the provided conversationId on follow-up turns", async () => {
    const store = makeStore();
    const conv = store.createConversation({
      title: "Pre-existing",
      modelName: "m",
      now: 1,
    });
    const events: Array<{ type: string; conversationId?: string | null }> = [];
    const service = new ChatService({
      search: makeSearch([passage("p1")]) as never,
      llm: makeLLM([{ text: "a", done: true }]),
      store,
    });
    await service.runTurn(
      makeRequest({ conversationId: conv.id }),
      (e) => events.push(e)
    );
    const done = events.find((e) => e.type === "done");
    expect(done?.conversationId).toBe(conv.id);
    const loaded = store.loadConversation(conv.id);
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[1]?.citations).toEqual(["p1"]);
  });

  it("persists the user + skipped assistant when no passages match", async () => {
    const store = makeStore();
    const events: Array<{ type: string; conversationId?: string | null }> = [];
    const service = new ChatService({
      search: makeSearch([]) as never,
      llm: makeLLM([]),
      store,
    });
    await service.runTurn(makeRequest(), (e) => events.push(e));
    const list = store.listConversations();
    expect(list).toHaveLength(1);
    const loaded = store.loadConversation(list[0]!.id);
    expect(loaded.messages[1]?.status).toBe("skipped");
  });

  it("persists the user + error assistant on llm failure", async () => {
    const store = makeStore();
    const llm = {
      detect: async () => ({ status: "ready", modelCount: 1 }),
      listModels: async () => [],
      pullModel: async function* () {},
      chat: async function* () {
        throw new Error("ECONNREFUSED");
      },
    } as unknown as LLMClient;
    const events: Array<{ type: string; conversationId?: string | null }> = [];
    const service = new ChatService({
      search: makeSearch([passage("p1")]) as never,
      llm,
      store,
    });
    await service.runTurn(makeRequest(), (e) => events.push(e));
    const err = events.find((e) => e.type === "error");
    expect(err?.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    const loaded = store.loadConversation((err as { conversationId: string }).conversationId);
    expect(loaded.messages[1]?.status).toBe("error");
    expect(loaded.messages[1]?.errorCode).toBe("ollama_unreachable");
  });

  it("works without a store (existing pre-persistence behavior)", async () => {
    const events: Array<{ type: string; conversationId?: string | null }> = [];
    const service = new ChatService({
      search: makeSearch([passage("p1")]) as never,
      llm: makeLLM([{ text: "x", done: true }]),
    });
    await service.runTurn(makeRequest(), (e) => events.push(e));
    const done = events.find((e) => e.type === "done");
    expect(done?.conversationId).toBe(""); // no store → empty string sentinel
  });
});
