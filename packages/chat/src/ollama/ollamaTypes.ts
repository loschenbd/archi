export type OllamaTag = {
  name: string;
  size: number;
  modified_at: string;
};

export type OllamaTagsResponse = {
  models: OllamaTag[];
};

export type OllamaPullEvent = {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
};

export type OllamaChatStreamEvent = {
  model: string;
  message?: { role: string; content: string };
  done: boolean;
  done_reason?: string;
};

export const OLLAMA_BASE_URL = "http://localhost:11434";
