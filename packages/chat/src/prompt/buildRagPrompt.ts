import type { SearchResult } from "@archi/search";
import {
  HISTORY_WINDOW_TURNS,
  MAX_PASSAGE_BODY_TOKENS,
  type ChatMessage,
  type ChatRequestMessages,
} from "../types.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";

const APPROX_CHARS_PER_TOKEN = 4;
const MAX_PASSAGE_CHARS = MAX_PASSAGE_BODY_TOKENS * APPROX_CHARS_PER_TOKEN;

function truncateBody(body: string): string {
  if (body.length <= MAX_PASSAGE_CHARS) return body;
  return body.slice(0, MAX_PASSAGE_CHARS) + "…";
}

function formatPassageLine(result: SearchResult, index: number): string {
  const creator = result.work.creator ?? "Unknown";
  const title = result.work.displayTitle ?? "Untitled";
  const body = truncateBody(result.body ?? "");
  return `[${index + 1}] (${creator} — ${title}) "${body}"`;
}

export function buildRagPrompt(
  question: string,
  passages: SearchResult[],
  history: ChatMessage[]
): ChatRequestMessages {
  const passageBlock = passages.map(formatPassageLine).join("\n");
  const userContent = `Passages:\n${passageBlock}\n\nQuestion: ${question}`;

  const windowed =
    history.length > HISTORY_WINDOW_TURNS
      ? history.slice(history.length - HISTORY_WINDOW_TURNS)
      : history;

  return {
    system: SYSTEM_PROMPT,
    messages: [...windowed, { role: "user", content: userContent }],
  };
}
