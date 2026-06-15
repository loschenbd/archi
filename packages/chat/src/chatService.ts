import type { SearchService } from "@archi/search";
import { buildRagPrompt } from "./prompt/buildRagPrompt.js";
import type { LLMClient } from "./llmClient.js";
import {
  DEFAULT_TOP_K,
  type ChatTurnAbortedEvent,
  type ChatTurnDoneEvent,
  type ChatTurnErrorEvent,
  type ChatTurnRequest,
  type ChatTurnTokenEvent,
} from "./types.js";

export type ChatServiceEvent =
  | ({ type: "token" } & ChatTurnTokenEvent)
  | ({ type: "done" } & ChatTurnDoneEvent)
  | ({ type: "error" } & ChatTurnErrorEvent)
  | ({ type: "aborted" } & ChatTurnAbortedEvent);

export type ChatEventSink = (event: ChatServiceEvent) => void;

export class ChatService {
  private readonly search: SearchService;
  private readonly llm: LLMClient;
  private readonly active = new Map<string, AbortController>();

  constructor(opts: { search: SearchService; llm: LLMClient }) {
    this.search = opts.search;
    this.llm = opts.llm;
  }

  cancel(turnId: string): void {
    this.active.get(turnId)?.abort();
  }

  async runTurn(req: ChatTurnRequest, sink: ChatEventSink): Promise<void> {
    const { turnId } = req;
    const started = performance.now();
    const controller = new AbortController();
    this.active.set(turnId, controller);
    try {
      const topK = req.options?.topK ?? DEFAULT_TOP_K;
      const filters: Parameters<SearchService["query"]>[0]["filters"] = {};
      if (req.options?.includeArchived !== true) filters.isArchived = false;
      if (req.options?.includeHidden !== true) filters.isHidden = false;
      const searchResponse = await this.search.query({
        text: req.question,
        limit: topK,
        filters,
      });
      if (searchResponse.results.length === 0) {
        sink({
          type: "done",
          turnId,
          citations: [],
          durationMs: Math.round(performance.now() - started),
          skipped: true,
          skipReason: "no_passages",
        });
        return;
      }
      const { system, messages } = buildRagPrompt(req.question, searchResponse.results, req.history);
      try {
        for await (const delta of this.llm.chat({
          model: req.modelName,
          system,
          messages,
          signal: controller.signal,
        })) {
          if (controller.signal.aborted) {
            sink({ type: "aborted", turnId });
            return;
          }
          if (delta.text) {
            sink({ type: "token", turnId, delta: delta.text });
          }
          if (delta.done) break;
        }
        if (controller.signal.aborted) {
          sink({ type: "aborted", turnId });
          return;
        }
      } catch (err) {
        if (controller.signal.aborted) {
          sink({ type: "aborted", turnId });
          return;
        }
        sink({
          type: "error",
          turnId,
          code: classifyError(err),
          message: (err as Error).message ?? "Unknown error",
        });
        return;
      }
      sink({
        type: "done",
        turnId,
        citations: searchResponse.results,
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      this.active.delete(turnId);
    }
  }
}

function classifyError(err: unknown): ChatTurnErrorEvent["code"] {
  const msg = (err as Error)?.message ?? "";
  if (err instanceof TypeError || /fetch failed|ECONNREFUSED/i.test(msg)) {
    return "ollama_unreachable";
  }
  if (/HTTP 404|model.*not found/i.test(msg)) return "model_missing";
  if (/context|tokens?\b.*length/i.test(msg)) return "context_overflow";
  return "unknown";
}
