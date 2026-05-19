import { describe, expect, it, vi } from "vitest";
import { applyPageMedia, isMediaUrlRejection, type MediaNotionClient } from "../src/media.js";

class FakeNotionError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

describe("URL-rejection fallback policy", () => {
  it("applyPageMedia surfaces the Notion error so callers can classify it", async () => {
    const update = vi.fn(async () => {
      throw new FakeNotionError("Invalid image url", "validation_error");
    });
    const client: MediaNotionClient = {
      pages: { retrieve: vi.fn(), update }
    };

    let caught: unknown;
    try {
      await applyPageMedia(
        client,
        "page_bad_url",
        { icon: { type: "external_url", url: "https://bad/img.jpg" }, coverUrl: "https://bad/img.jpg" },
        { force: false, isNewPage: true }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(FakeNotionError);
    expect(isMediaUrlRejection(caught)).toBe(true);
  });

  it("isMediaUrlRejection lets rate_limited bubble up (not a URL rejection)", async () => {
    const update = vi.fn(async () => {
      throw new FakeNotionError("rate limited; retry later", "rate_limited");
    });
    const client: MediaNotionClient = {
      pages: { retrieve: vi.fn(), update }
    };

    let caught: unknown;
    try {
      await applyPageMedia(
        client,
        "page_rate_limited",
        { icon: { type: "external_url", url: "https://ok/img.jpg" }, coverUrl: "https://ok/img.jpg" },
        { force: false, isNewPage: true }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(FakeNotionError);
    expect(isMediaUrlRejection(caught)).toBe(false);
  });
});
