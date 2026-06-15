import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaClient } from "../src/ollama/ollamaClient.js";
import type { ChatDelta } from "../src/types.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function streamResponse(lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line + "\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

describe("OllamaClient.chat", () => {
  it("yields ChatDelta chunks parsed from the Ollama chat stream", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      streamResponse([
        JSON.stringify({ model: "m", message: { role: "assistant", content: "Hello" }, done: false }),
        JSON.stringify({ model: "m", message: { role: "assistant", content: " world" }, done: false }),
        JSON.stringify({ model: "m", message: { role: "assistant", content: "" }, done: true }),
      ])
    );
    const deltas: ChatDelta[] = [];
    for await (const d of new OllamaClient().chat({
      model: "m",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
    })) {
      deltas.push(d);
    }
    expect(deltas.map((d) => d.text).join("")).toBe("Hello world");
    expect(deltas[deltas.length - 1].done).toBe(true);
  });

  it("sends model + messages + stream=true in the request body, with system prepended", async () => {
    const captured: Array<{ url: string; body: unknown }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      captured.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
      return streamResponse([JSON.stringify({ model: "m", message: { role: "assistant", content: "x" }, done: true })]);
    });
    const iter = new OllamaClient().chat({
      model: "llama3.1:8b",
      system: "SYS",
      messages: [{ role: "user", content: "hello" }],
    });
    for await (const _ of iter) {
      // drain
    }
    expect(captured[0].url).toMatch(/\/api\/chat$/);
    expect(captured[0].body).toMatchObject({
      model: "llama3.1:8b",
      stream: true,
      messages: [
        { role: "system", content: "SYS" },
        { role: "user", content: "hello" },
      ],
    });
  });

  it("aborts when the provided signal fires, yielding no further chunks", async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      // Throw if abort was already signaled before the fetch call.
      if (init?.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      return streamResponse([JSON.stringify({ model: "m", message: { role: "assistant", content: "x" }, done: true })]);
    });
    controller.abort();
    await expect(async () => {
      for await (const _ of new OllamaClient().chat({
        model: "m",
        system: "",
        messages: [{ role: "user", content: "hi" }],
        signal: controller.signal,
      })) {
        // empty
      }
    }).rejects.toThrow(/abort/i);
  });
});
