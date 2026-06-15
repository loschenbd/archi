import type {
  ChatDelta,
  ChatMessage,
  DetectResult,
  ModelInfo,
  PullProgress,
} from "./types.js";

export type ChatRequest = {
  model: string;
  system: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
};

export interface LLMClient {
  detect(): Promise<DetectResult>;
  listModels(): Promise<ModelInfo[]>;
  pullModel(name: string): AsyncIterable<PullProgress>;
  chat(req: ChatRequest): AsyncIterable<ChatDelta>;
}
