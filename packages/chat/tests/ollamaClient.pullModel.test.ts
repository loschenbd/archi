import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaClient } from "../src/ollama/ollamaClient.js";
import type { PullProgress } from "../src/types.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function streamResponse(lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + "\n"));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

describe("OllamaClient.pullModel", () => {
  it("yields PullProgress events parsed from NDJSON", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      streamResponse([
        JSON.stringify({ status: "pulling manifest" }),
        JSON.stringify({ status: "downloading", completed: 100, total: 1000 }),
        JSON.stringify({ status: "success" }),
      ])
    );
    const events: PullProgress[] = [];
    for await (const e of new OllamaClient().pullModel("llama3.1:8b")) {
      events.push(e);
    }
    expect(events.length).toBe(3);
    expect(events[0]).toMatchObject({ name: "llama3.1:8b", status: "pulling manifest", done: false });
    expect(events[1]).toMatchObject({ status: "downloading", completed: 100, total: 1000, done: false });
    expect(events[2]).toMatchObject({ status: "success", done: true });
  });

  it("yields a single error event when Ollama returns 4xx", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ error: "model not found" }), { status: 404 })
    );
    const events: PullProgress[] = [];
    for await (const e of new OllamaClient().pullModel("noexist:1")) {
      events.push(e);
    }
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ done: true, error: expect.stringContaining("model not found") });
  });
});
