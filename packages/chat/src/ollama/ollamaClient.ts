import type { DetectResult, ModelInfo, PullProgress, ChatDelta } from "../types.js";
import type { ChatRequest, LLMClient } from "../llmClient.js";
import { OLLAMA_BASE_URL, type OllamaTagsResponse } from "./ollamaTypes.js";
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

  pullModel(_name: string): AsyncIterable<PullProgress> {
    throw new Error("not implemented");
  }

  chat(_req: ChatRequest): AsyncIterable<ChatDelta> {
    throw new Error("not implemented");
  }
}
