import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaClient } from "../src/ollama/ollamaClient.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchOnce(impl: (url: URL | string, init?: RequestInit) => Promise<Response>): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
}

describe("OllamaClient.detect", () => {
  it("returns not_installed when localhost:11434 refuses the connection", async () => {
    mockFetchOnce(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await new OllamaClient().detect();
    expect(result).toEqual({ status: "not_installed" });
  });

  it("returns no_models when /api/tags is reachable but models list is empty", async () => {
    mockFetchOnce(async () => new Response(JSON.stringify({ models: [] }), { status: 200 }));
    const result = await new OllamaClient().detect();
    expect(result).toEqual({ status: "no_models" });
  });

  it("returns ready with modelCount when /api/tags has models", async () => {
    mockFetchOnce(async () =>
      new Response(
        JSON.stringify({ models: [{ name: "llama3.1:8b", size: 1, modified_at: "x" }] }),
        { status: 200 }
      )
    );
    const result = await new OllamaClient().detect();
    expect(result).toMatchObject({ status: "ready", modelCount: 1 });
  });

  it("returns error when /api/tags is reachable but returns 5xx", async () => {
    mockFetchOnce(async () => new Response("boom", { status: 500 }));
    const result = await new OllamaClient().detect();
    expect(result).toMatchObject({ status: "error" });
  });
});
