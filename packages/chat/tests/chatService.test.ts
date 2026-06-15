import { describe, expect, it, vi } from "vitest";
import { ChatService } from "../src/chatService.js";
import type { LLMClient, ChatRequest } from "../src/llmClient.js";
import type { ChatDelta, ChatTurnRequest } from "../src/types.js";

function passage(id: string, body = "body"): import("@archi/search").SearchResult {
  return {
    passageId: id,
    body,
    snippet: "",
    work: { id: `w-${id}`, displayTitle: "T", creator: "C" },
    labels: [],
    isStarred: false,
    scores: { fused: 0 },
    matchedVia: "vector" as const,
  };
}

type Event =
  | { type: "token"; turnId: string; delta: string }
  | { type: "done"; turnId: string; citations: unknown; skipped?: boolean; skipReason?: string }
  | { type: "error"; turnId: string; code: string; message: string }
  | { type: "aborted"; turnId: string };

function makeLLM(stream: ChatDelta[]): LLMClient {
  return {
    detect: vi.fn(),
    listModels: vi.fn(),
    pullModel: vi.fn(),
    chat: vi.fn(async function* () {
      for (const d of stream) yield d;
    }) as unknown as LLMClient["chat"],
  };
}

function makeSearch(results: unknown[]) {
  return {
    query: vi.fn(async () => ({
      query: "",
      filters: {},
      results,
      totalCandidates: results.length,
      durationMs: 1,
    })),
  };
}

function makeRequest(overrides: Partial<ChatTurnRequest> = {}): ChatTurnRequest {
  return {
    turnId: "t1",
    question: "what about death?",
    history: [],
    modelName: "llama3.1:8b",
    ...overrides,
  };
}

describe("ChatService.runTurn", () => {
  it("emits token events for each chat delta and a done event with citations", async () => {
    const events: Event[] = [];
    const passages = [passage("p1", "body")];
    const service = new ChatService({
      search: makeSearch(passages) as never,
      llm: makeLLM([
        { text: "Hello", done: false },
        { text: " there", done: true },
      ]),
    });
    await service.runTurn(makeRequest(), (e) => events.push(e as Event));
    const tokens = events.filter((e) => e.type === "token").map((e) => (e as { delta: string }).delta);
    expect(tokens.join("")).toBe("Hello there");
    const done = events.find((e) => e.type === "done") as { citations: unknown[] };
    expect(done.citations).toEqual(passages);
  });

  it("skips the LLM call when search returns zero results", async () => {
    const events: Event[] = [];
    const llm = makeLLM([]);
    const service = new ChatService({ search: makeSearch([]) as never, llm });
    await service.runTurn(makeRequest(), (e) => events.push(e as Event));
    expect(llm.chat).not.toHaveBeenCalled();
    const done = events.find((e) => e.type === "done") as { skipped: boolean; skipReason: string };
    expect(done.skipped).toBe(true);
    expect(done.skipReason).toBe("no_passages");
  });

  it("passes the system prompt and history to the LLM via buildRagPrompt", async () => {
    const passages = [passage("p1", "B")];
    const llm = makeLLM([{ text: "x", done: true }]);
    const service = new ChatService({ search: makeSearch(passages) as never, llm });
    await service.runTurn(
      makeRequest({
        history: [
          { role: "user", content: "earlier" },
          { role: "assistant", content: "answer" },
        ],
      }),
      () => undefined
    );
    const call = (llm.chat as unknown as { mock: { calls: ChatRequest[][] } }).mock.calls[0][0];
    expect(call.system).toMatch(/Answer ONLY/);
    expect(call.messages[0]).toEqual({ role: "user", content: "earlier" });
    expect(call.messages[call.messages.length - 1].content).toContain("Question: what about death?");
  });

  it("emits aborted when the cancel method is called mid-stream", async () => {
    const events: Event[] = [];
    let resolveChunk: () => void = () => undefined;
    const stalledStream: ChatDelta[] = [];
    const llm: LLMClient = {
      detect: vi.fn(),
      listModels: vi.fn(),
      pullModel: vi.fn(),
      chat: vi.fn(async function* () {
        yield { text: "first", done: false };
        await new Promise<void>((res) => {
          resolveChunk = res;
        });
        yield* stalledStream;
      }) as unknown as LLMClient["chat"],
    };
    const service = new ChatService({ search: makeSearch([passage("p1")]) as never, llm });
    const p = service.runTurn(makeRequest(), (e) => events.push(e as Event));
    await new Promise((r) => setTimeout(r, 5));
    service.cancel("t1");
    resolveChunk();
    await p;
    expect(events.some((e) => e.type === "aborted")).toBe(true);
  });

  it("emits error with code=ollama_unreachable when the LLM throws a network error", async () => {
    const events: Event[] = [];
    const llm: LLMClient = {
      detect: vi.fn(),
      listModels: vi.fn(),
      pullModel: vi.fn(),
      chat: vi.fn(() => {
        throw new TypeError("fetch failed");
      }) as unknown as LLMClient["chat"],
    };
    const service = new ChatService({ search: makeSearch([passage("p1")]) as never, llm });
    await service.runTurn(makeRequest(), (e) => events.push(e as Event));
    const err = events.find((e) => e.type === "error") as { code: string };
    expect(err.code).toBe("ollama_unreachable");
  });
});
