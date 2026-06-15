import type { DetectResult, ModelInfo, PullProgress, ChatDelta } from "../types.js";
import type { ChatRequest, LLMClient } from "../llmClient.js";
import {
  OLLAMA_BASE_URL,
  type OllamaPullEvent,
  type OllamaTagsResponse,
} from "./ollamaTypes.js";
import { isRecommended } from "../recommendations.js";

export class OllamaClient implements LLMClient {
  private readonly baseUrl: string;

  constructor(opts: { baseUrl?: string } = {}) {
    this.baseUrl = opts.baseUrl ?? OLLAMA_BASE_URL;
  }

  async detect(): Promise<DetectResult> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/tags`, { method: "GET" });
    } catch {
      return { status: "not_installed" };
    }
    if (!response.ok) {
      return { status: "error", message: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as OllamaTagsResponse;
    if (!body.models || body.models.length === 0) {
      return { status: "no_models" };
    }
    return { status: "ready", modelCount: body.models.length };
  }

  async listModels(): Promise<ModelInfo[]> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/tags`, { method: "GET" });
    } catch (err) {
      throw new Error(`Ollama is unreachable at ${this.baseUrl}: ${(err as Error).message}`);
    }
    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status} from /api/tags`);
    }
    const body = (await response.json()) as OllamaTagsResponse;
    return (body.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      modifiedAt: m.modified_at,
      recommended: isRecommended(m.name) || undefined,
    }));
  }

  pullModel(name: string): AsyncIterable<PullProgress> {
    const url = `${this.baseUrl}/api/pull`;
    const body = JSON.stringify({ name, stream: true });
    return this.streamPull(url, body, name);
  }

  private async *streamPull(
    url: string,
    body: string,
    name: string
  ): AsyncGenerator<PullProgress> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (err) {
      yield { name, status: "error", done: true, error: (err as Error).message };
      return;
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let message = text;
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed.error === "string") message = parsed.error;
      } catch {
        // keep raw text
      }
      yield { name, status: "error", done: true, error: message || `HTTP ${response.status}` };
      return;
    }
    for await (const event of readNdjsonStream(response.body)) {
      const isSuccess = event.status === "success";
      yield {
        name,
        status: event.status,
        completed: event.completed,
        total: event.total,
        done: isSuccess,
        error: event.error,
      };
      if (isSuccess) break;
    }
  }

  chat(_req: ChatRequest): AsyncIterable<ChatDelta> {
    throw new Error("not implemented");
  }
}

async function* readNdjsonStream(
  body: ReadableStream<Uint8Array> | null
): AsyncGenerator<OllamaPullEvent> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line) as OllamaPullEvent;
      } catch {
        // ignore malformed line
      }
    }
  }
  const tail = buffer.trim();
  if (tail) {
    try {
      yield JSON.parse(tail) as OllamaPullEvent;
    } catch {
      // ignore
    }
  }
}
