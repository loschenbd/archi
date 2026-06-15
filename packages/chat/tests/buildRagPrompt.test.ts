import { describe, expect, it } from "vitest";
import type { SearchResult } from "@archi/search";
import { buildRagPrompt } from "../src/prompt/buildRagPrompt.js";
import { SYSTEM_PROMPT } from "../src/prompt/systemPrompt.js";
import {
  HISTORY_WINDOW_TURNS,
  MAX_PASSAGE_BODY_TOKENS,
  type ChatMessage,
} from "../src/types.js";

type FakeResultInput = {
  id: string;
  body?: string;
  creator?: string;
  workTitle?: string;
  snippet?: string;
};

function fakeResult(input: FakeResultInput): SearchResult {
  return {
    passageId: input.id,
    body: input.body ?? "passage body text",
    snippet: input.snippet ?? input.body ?? "",
    work: {
      id: `w-${input.id}`,
      displayTitle: input.workTitle ?? "Untitled",
      creator: input.creator ?? "Unknown",
    },
    labels: [],
    isStarred: false,
    scores: { fused: 0 },
    matchedVia: "vector",
  };
}

describe("buildRagPrompt", () => {
  it("returns the system prompt verbatim", () => {
    const out = buildRagPrompt("q", [fakeResult({ id: "1" })], []);
    expect(out.system).toBe(SYSTEM_PROMPT);
  });

  it("formats the user message with numbered passages and the question", () => {
    const passages = [
      fakeResult({ id: "a", creator: "Marcus Aurelius", workTitle: "Meditations", body: "Body A" }),
      fakeResult({ id: "b", creator: "Seneca", workTitle: "Letters", body: "Body B" }),
    ];
    const out = buildRagPrompt("what about death?", passages, []);
    const last = out.messages[out.messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toContain("[1] (Marcus Aurelius — Meditations) \"Body A\"");
    expect(last.content).toContain("[2] (Seneca — Letters) \"Body B\"");
    expect(last.content).toContain("Question: what about death?");
  });

  it("includes history turns in order, ending with the new user message", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "first-answer" },
    ];
    const out = buildRagPrompt("second", [fakeResult({ id: "1" })], history);
    expect(out.messages.length).toBe(3);
    expect(out.messages[0]).toEqual(history[0]);
    expect(out.messages[1]).toEqual(history[1]);
    expect(out.messages[2].role).toBe("user");
    expect(out.messages[2].content).toContain("Question: second");
  });

  it(`truncates history to the last ${HISTORY_WINDOW_TURNS} messages, dropping oldest first`, () => {
    const history: ChatMessage[] = Array.from({ length: HISTORY_WINDOW_TURNS + 4 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `m${i}`,
    }));
    const out = buildRagPrompt("q", [fakeResult({ id: "1" })], history);
    expect(out.messages.length).toBe(HISTORY_WINDOW_TURNS + 1);
    expect(out.messages[0].content).toBe(`m${4}`);
  });

  it(`truncates a single passage body if it exceeds ${MAX_PASSAGE_BODY_TOKENS} tokens (approx by chars / 4)`, () => {
    const huge = "x".repeat(MAX_PASSAGE_BODY_TOKENS * 4 + 1000);
    const out = buildRagPrompt("q", [fakeResult({ id: "1", body: huge })], []);
    const last = out.messages[out.messages.length - 1].content;
    expect(last).toMatch(/\[1\] \(.+\) "x+…"/);
    expect(last.length).toBeLessThan(huge.length);
  });
});
