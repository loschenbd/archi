import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaClient } from "../src/ollama/ollamaClient.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OllamaClient.listModels", () => {
  it("returns model info mapped from /api/tags, with recommended flag set", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({
          models: [
            { name: "llama3.1:8b", size: 4_700_000_000, modified_at: "2026-06-01" },
            { name: "mistral:7b", size: 4_000_000_000, modified_at: "2026-05-01" },
          ],
        }),
        { status: 200 }
      )
    );
    const result = await new OllamaClient().listModels();
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: "llama3.1:8b",
      size: 4_700_000_000,
      modifiedAt: "2026-06-01",
      recommended: true,
    });
    expect(result[1].recommended).toBeUndefined();
  });

  it("throws a readable error when /api/tags is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(new OllamaClient().listModels()).rejects.toThrow(/ollama/i);
  });
});
