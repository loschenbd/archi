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
    const tag = `[chat:${turnId.slice(0, 8)}]`;
    try {
      console.log(`${tag} start — question="${req.question.slice(0, 80)}" model=${req.modelName}`);
      const topK = req.options?.topK ?? DEFAULT_TOP_K;
      const filters: Parameters<SearchService["query"]>[0]["filters"] = {};
      if (req.options?.includeArchived !== true) filters.isArchived = false;
      if (req.options?.includeHidden !== true) filters.isHidden = false;

      let searchResponse;
      try {
        console.log(`${tag} searching (topK=${topK})`);
        searchResponse = await this.search.query({
          text: req.question,
          limit: topK,
          filters,
        });
        console.log(
          `${tag} search returned ${searchResponse.results.length} passage(s) in ${searchResponse.durationMs}ms`
        );
      } catch (err) {
        console.error(`${tag} search threw:`, err);
        sink({
          type: "error",
          turnId,
          conversationId: req.conversationId ?? null,
          code: "unknown",
          message: `Search failed: ${(err as Error).message ?? String(err)}`,
        });
        return;
      }

      if (searchResponse.results.length === 0) {
        console.log(`${tag} no passages matched — emitting skipped`);
        sink({
          type: "done",
          turnId,
          conversationId: req.conversationId ?? "",
          citations: [],
          durationMs: Math.round(performance.now() - started),
          skipped: true,
          skipReason: "no_passages",
        });
        return;
      }

      let prompt;
      try {
        prompt = buildRagPrompt(req.question, searchResponse.results, req.history);
      } catch (err) {
        console.error(`${tag} buildRagPrompt threw:`, err);
        sink({
          type: "error",
          turnId,
          conversationId: req.conversationId ?? null,
          code: "unknown",
          message: `Prompt build failed: ${(err as Error).message ?? String(err)}`,
        });
        return;
      }

      console.log(
        `${tag} calling Ollama (system=${prompt.system.length}ch, messages=${prompt.messages.length})`
      );
      try {
        let tokenChunks = 0;
        for await (const delta of this.llm.chat({
          model: req.modelName,
          system: prompt.system,
          messages: prompt.messages,
          signal: controller.signal,
        })) {
          if (controller.signal.aborted) {
            console.log(`${tag} aborted mid-stream`);
            sink({ type: "aborted", turnId, conversationId: req.conversationId ?? null });
            return;
          }
          if (delta.text) {
            if (tokenChunks === 0) {
              console.log(`${tag} first token after ${Math.round(performance.now() - started)}ms`);
            }
            tokenChunks++;
            sink({ type: "token", turnId, delta: delta.text });
          }
          if (delta.done) break;
        }
        if (controller.signal.aborted) {
          sink({ type: "aborted", turnId, conversationId: req.conversationId ?? null });
          return;
        }
        console.log(
          `${tag} stream done — ${tokenChunks} chunks, total ${Math.round(performance.now() - started)}ms`
        );
      } catch (err) {
        if (controller.signal.aborted) {
          sink({ type: "aborted", turnId, conversationId: req.conversationId ?? null });
          return;
        }
        console.error(`${tag} llm.chat threw:`, err);
        sink({
          type: "error",
          turnId,
          conversationId: req.conversationId ?? null,
          code: classifyError(err),
          message: (err as Error).message ?? "Unknown error",
        });
        return;
      }

      sink({
        type: "done",
        turnId,
        conversationId: req.conversationId ?? "",
        citations: searchResponse.results,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (err) {
      // Belt-and-suspenders: anything that escapes the per-phase catches still
      // surfaces as an error event instead of hanging the UI on "Thinking…".
      console.error(`${tag} runTurn threw unexpectedly:`, err);
      sink({
        type: "error",
        turnId,
        conversationId: req.conversationId ?? null,
        code: "unknown",
        message: `Unexpected error: ${(err as Error).message ?? String(err)}`,
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
