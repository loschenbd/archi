import type { SearchResult } from "@archi/search";

export type DetectResult =
  | { status: "ready"; modelCount: number; ollamaVersion?: string }
  | { status: "no_models" }
  | { status: "not_installed" }
  | { status: "error"; message: string };

export type ModelInfo = {
  name: string;
  size: number;
  modifiedAt: string;
  recommended?: boolean;
};

// Mirrors Ollama's /api/pull NDJSON event shape. status is an arbitrary string from Ollama (e.g., "pulling manifest", "downloading digest …", "success"); we forward it verbatim rather than enumerating.
export type PullProgress = {
  name: string;
  status: string;
  completed?: number;
  total?: number;
  done: boolean;
  error?: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatTurnOptions = {
  topK?: number;
  includeArchived?: boolean;
  includeHidden?: boolean;
};

export type ChatTurnRequest = {
  turnId: string;
  conversationId?: string;
  question: string;
  history: ChatMessage[];
  modelName: string;
  options?: ChatTurnOptions;
};

export type ChatTurnDoneEvent = {
  turnId: string;
  conversationId: string;
  citations: SearchResult[];
  durationMs: number;
  skipped?: boolean;
  skipReason?: "no_passages";
};

export type ChatTurnErrorEvent = {
  turnId: string;
  conversationId: string | null;
  code: "ollama_unreachable" | "model_missing" | "context_overflow" | "unknown";
  message: string;
};

export type ChatTurnTokenEvent = {
  turnId: string;
  delta: string;
};

export type ChatTurnAbortedEvent = {
  turnId: string;
  conversationId: string | null;
};

export type ChatDelta = {
  text: string;
  done: boolean;
};

export type ChatRequestMessages = {
  system: string;
  messages: ChatMessage[];
};

export const DEFAULT_TOP_K = 8;
export const HISTORY_WINDOW_TURNS = 6;
export const MAX_PASSAGE_BODY_TOKENS = 1500;
export const SYSTEM_PROMPT_VERSION = 1;
