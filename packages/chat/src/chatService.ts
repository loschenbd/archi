import type { SearchService, SearchResult } from "@archi/search";
import { buildRagPrompt } from "./prompt/buildRagPrompt.js";
import type { LLMClient } from "./llmClient.js";
import type { ChatStore } from "./persistence/chatStore.js";
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

const EMPTY_CONVERSATION_ID = "";

export class ChatService {
  private readonly search: SearchService;
  private readonly llm: LLMClient;
  private readonly store: ChatStore | null;
  private readonly active = new Map<string, AbortController>();

  constructor(opts: { search: SearchService; llm: LLMClient; store?: ChatStore }) {
    this.search = opts.search;
    this.llm = opts.llm;
    this.store = opts.store ?? null;
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

    const conversationId = this.ensureConversationId(req);
    let assistantText = "";
    let citations: SearchResult[] = [];

    const persistTurn = (
      status: "done" | "error" | "aborted" | "skipped",
      opts: { errorCode?: string } = {}
    ): void => {
      if (!this.store || conversationId === EMPTY_CONVERSATION_ID) return;
      try {
        this.store.appendTurn({
          conversationId,
          now: Date.now(),
          userMessage: { content: req.question },
          assistantMessage: {
            content: assistantText,
            citations: citations.map((c) => c.passageId),
            status,
            errorCode: opts.errorCode,
            durationMs: Math.round(performance.now() - started),
          },
        });
      } catch (err) {
        console.error(`${tag} persistence write failed:`, err);
      }
    };

    try {
      console.log(`${tag} start — question="${req.question.slice(0, 80)}" model=${req.modelName}`);
      const topK = req.options?.topK ?? DEFAULT_TOP_K;
      const filters: Parameters<SearchService["query"]>[0]["filters"] = {};
      if (req.options?.includeArchived !== true) filters.isArchived = false;
      if (req.options?.includeHidden !== true) filters.isHidden = false;

      let searchResponse;
      try {
        searchResponse = await this.search.query({
          text: req.question,
          limit: topK,
          filters,
        });
      } catch (err) {
        console.error(`${tag} search threw:`, err);
        persistTurn("error", { errorCode: "unknown" });
        sink({
          type: "error",
          turnId,
          conversationId: conversationId || null,
          code: "unknown",
          message: `Search failed: ${(err as Error).message ?? String(err)}`,
        });
        return;
      }

      if (searchResponse.results.length === 0) {
        persistTurn("skipped");
        sink({
          type: "done",
          turnId,
          conversationId,
          citations: [],
          durationMs: Math.round(performance.now() - started),
          skipped: true,
          skipReason: "no_passages",
        });
        return;
      }

      citations = searchResponse.results;

      let prompt;
      try {
        prompt = buildRagPrompt(req.question, searchResponse.results, req.history);
      } catch (err) {
        console.error(`${tag} buildRagPrompt threw:`, err);
        persistTurn("error", { errorCode: "unknown" });
        sink({
          type: "error",
          turnId,
          conversationId: conversationId || null,
          code: "unknown",
          message: `Prompt build failed: ${(err as Error).message ?? String(err)}`,
        });
        return;
      }

      try {
        let tokenChunks = 0;
        for await (const delta of this.llm.chat({
          model: req.modelName,
          system: prompt.system,
          messages: prompt.messages,
          signal: controller.signal,
        })) {
          if (controller.signal.aborted) {
            persistTurn("aborted");
            sink({ type: "aborted", turnId, conversationId: conversationId || null });
            return;
          }
          if (delta.text) {
            if (tokenChunks === 0) {
              console.log(`${tag} first token after ${Math.round(performance.now() - started)}ms`);
            }
            tokenChunks++;
            assistantText += delta.text;
            sink({ type: "token", turnId, delta: delta.text });
          }
          if (delta.done) break;
        }
        if (controller.signal.aborted) {
          persistTurn("aborted");
          sink({ type: "aborted", turnId, conversationId: conversationId || null });
          return;
        }
      } catch (err) {
        if (controller.signal.aborted) {
          persistTurn("aborted");
          sink({ type: "aborted", turnId, conversationId: conversationId || null });
          return;
        }
        const code = classifyError(err);
        persistTurn("error", { errorCode: code });
        sink({
          type: "error",
          turnId,
          conversationId: conversationId || null,
          code,
          message: (err as Error).message ?? "Unknown error",
        });
        return;
      }

      persistTurn("done");
      sink({
        type: "done",
        turnId,
        conversationId,
        citations,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (err) {
      console.error(`${tag} runTurn threw unexpectedly:`, err);
      persistTurn("error", { errorCode: "unknown" });
      sink({
        type: "error",
        turnId,
        conversationId: conversationId || null,
        code: "unknown",
        message: `Unexpected error: ${(err as Error).message ?? String(err)}`,
      });
    } finally {
      this.active.delete(turnId);
    }
  }

  private ensureConversationId(req: ChatTurnRequest): string {
    if (!this.store) return EMPTY_CONVERSATION_ID;
    if (req.conversationId) return req.conversationId;
    const now = Date.now();
    const conv = this.store.createConversation({
      title: req.question,
      modelName: req.modelName,
      now,
    });
    return conv.id;
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
