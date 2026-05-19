import { describe, expect, it, vi } from "vitest";
import { applyPageMedia, chooseMedia, emojiFor, isMediaUrlRejection, type MediaNotionClient } from "../src/media.js";

const baseWork = {
  displayTitle: "Book Title",
  workType: "book",
  ingestSource: "device-export",
  labels: [],
  isArchived: false
} as const;

describe("emojiFor", () => {
  it("maps known work types to emoji", () => {
    expect(emojiFor("book")).toEqual("📚");
    expect(emojiFor("article")).toEqual("📰");
    expect(emojiFor("periodical")).toEqual("🗞️");
    expect(emojiFor("document")).toEqual("📄");
    expect(emojiFor("other")).toEqual("📌");
  });

  it("falls back to 📌 for unknown types", () => {
    expect(emojiFor("podcast")).toEqual("📌");
    expect(emojiFor("")).toEqual("📌");
  });
});

describe("chooseMedia", () => {
  it("returns external_url icon + coverUrl when coverImageUrl is set", () => {
    const result = chooseMedia({ ...baseWork, coverImageUrl: "https://images/abc.jpg" });
    expect(result).toEqual({
      icon: { type: "external_url", url: "https://images/abc.jpg" },
      coverUrl: "https://images/abc.jpg"
    });
  });

  it("returns book emoji + no coverUrl when coverImageUrl is missing", () => {
    const result = chooseMedia({ ...baseWork, coverImageUrl: undefined });
    expect(result).toEqual({
      icon: { type: "emoji", emoji: "📚" },
      coverUrl: undefined
    });
  });

  it("treats whitespace-only coverImageUrl as missing", () => {
    const result = chooseMedia({ ...baseWork, coverImageUrl: "   " });
    expect(result).toEqual({
      icon: { type: "emoji", emoji: "📚" },
      coverUrl: undefined
    });
  });

  it("uses the article emoji for article work type", () => {
    const result = chooseMedia({ ...baseWork, workType: "article", coverImageUrl: undefined });
    expect(result.icon).toEqual({ type: "emoji", emoji: "📰" });
  });
});

function makeClient(overrides: Partial<{
  retrieve: (args: { page_id: string }) => unknown;
}> = {}): {
  client: MediaNotionClient;
  retrieve: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
} {
  const retrieve = vi.fn(overrides.retrieve ?? (async () => ({ icon: null, cover: null })));
  const update = vi.fn(async () => ({}));
  return {
    client: { pages: { retrieve, update } } as MediaNotionClient,
    retrieve,
    update
  };
}

const externalDesired = {
  icon: { type: "external_url" as const, url: "https://images/abc.jpg" },
  coverUrl: "https://images/abc.jpg"
};

const emojiDesired = {
  icon: { type: "emoji" as const, emoji: "📚" },
  coverUrl: undefined
};

describe("applyPageMedia", () => {
  it("writes icon+cover without retrieving on a new page with URL", async () => {
    const { client, retrieve, update } = makeClient();

    await applyPageMedia(client, "page_1", externalDesired, { force: false, isNewPage: true });

    expect(retrieve).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: "page_1",
      icon: { type: "external", external: { url: "https://images/abc.jpg" } },
      cover: { type: "external", external: { url: "https://images/abc.jpg" } }
    });
  });

  it("writes emoji icon and no cover on a new page without URL", async () => {
    const { client, retrieve, update } = makeClient();

    await applyPageMedia(client, "page_2", emojiDesired, { force: false, isNewPage: true });

    expect(retrieve).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: "page_2",
      icon: { type: "emoji", emoji: "📚" }
    });
  });

  it("retrieves once and does not update when existing page already matches", async () => {
    const { client, retrieve, update } = makeClient({
      retrieve: async () => ({
        icon: { type: "external", external: { url: "https://images/abc.jpg" } },
        cover: { type: "external", external: { url: "https://images/abc.jpg" } }
      })
    });

    await applyPageMedia(client, "page_3", externalDesired, { force: false, isNewPage: false });

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledWith({ page_id: "page_3" });
    expect(update).not.toHaveBeenCalled();
  });

  it("does not update when existing emoji icon already matches and no URL", async () => {
    const { client, retrieve, update } = makeClient({
      retrieve: async () => ({ icon: { type: "emoji", emoji: "📚" }, cover: null })
    });

    await applyPageMedia(client, "page_4", emojiDesired, { force: false, isNewPage: false });

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("updates icon only when icon differs and cover matches", async () => {
    const { client, update } = makeClient({
      retrieve: async () => ({
        icon: { type: "emoji", emoji: "📚" },
        cover: { type: "external", external: { url: "https://images/abc.jpg" } }
      })
    });

    await applyPageMedia(client, "page_diff_icon", externalDesired, { force: false, isNewPage: false });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: "page_diff_icon",
      icon: { type: "external", external: { url: "https://images/abc.jpg" } }
    });
  });

  it("updates cover only when cover differs and icon matches", async () => {
    const { client, update } = makeClient({
      retrieve: async () => ({
        icon: { type: "external", external: { url: "https://images/abc.jpg" } },
        cover: { type: "external", external: { url: "https://images/old.jpg" } }
      })
    });

    await applyPageMedia(client, "page_diff_cover", externalDesired, { force: false, isNewPage: false });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: "page_diff_cover",
      cover: { type: "external", external: { url: "https://images/abc.jpg" } }
    });
  });

  it("updates both when no current icon or cover and URL present", async () => {
    const { client, update } = makeClient({ retrieve: async () => ({ icon: null, cover: null }) });

    await applyPageMedia(client, "page_blank", externalDesired, { force: false, isNewPage: false });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: "page_blank",
      icon: { type: "external", external: { url: "https://images/abc.jpg" } },
      cover: { type: "external", external: { url: "https://images/abc.jpg" } }
    });
  });

  it("overwrites a user-set emoji with our emoji when URL is absent (trust-on-first-write)", async () => {
    const { client, update } = makeClient({
      retrieve: async () => ({ icon: { type: "emoji", emoji: "⭐" }, cover: null })
    });

    await applyPageMedia(client, "page_user_emoji", emojiDesired, { force: false, isNewPage: false });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: "page_user_emoji",
      icon: { type: "emoji", emoji: "📚" }
    });
  });

  it("rewrites icon+cover on force even when current matches desired", async () => {
    const { client, update } = makeClient({
      retrieve: async () => ({
        icon: { type: "external", external: { url: "https://images/abc.jpg" } },
        cover: { type: "external", external: { url: "https://images/abc.jpg" } }
      })
    });

    await applyPageMedia(client, "page_force", externalDesired, { force: true, isNewPage: false });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: "page_force",
      icon: { type: "external", external: { url: "https://images/abc.jpg" } },
      cover: { type: "external", external: { url: "https://images/abc.jpg" } }
    });
  });

  it("clears cover when force=true and desired has no coverUrl", async () => {
    const { client, update } = makeClient({
      retrieve: async () => ({
        icon: { type: "emoji", emoji: "📚" },
        cover: { type: "external", external: { url: "https://images/old.jpg" } }
      })
    });

    await applyPageMedia(client, "page_force_clear", emojiDesired, { force: true, isNewPage: false });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      page_id: "page_force_clear",
      icon: { type: "emoji", emoji: "📚" },
      cover: null
    });
  });

  it("does NOT clear cover on normal sync when URL disappears", async () => {
    const { client, update } = makeClient({
      retrieve: async () => ({
        icon: { type: "emoji", emoji: "📚" },
        cover: { type: "external", external: { url: "https://images/old.jpg" } }
      })
    });

    await applyPageMedia(client, "page_no_clear", emojiDesired, { force: false, isNewPage: false });

    // Icon matches current emoji, no change. Cover would differ but rule says don't clear on normal sync.
    expect(update).not.toHaveBeenCalled();
  });
});

class FakeNotionError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

describe("isMediaUrlRejection", () => {
  it("returns true for validation_error with 'Invalid image url'", () => {
    expect(isMediaUrlRejection(new FakeNotionError("Invalid image url", "validation_error"))).toBe(true);
  });

  it("returns true for validation_error with 'url is not a valid url'", () => {
    expect(isMediaUrlRejection(new FakeNotionError("url is not a valid url", "validation_error"))).toBe(true);
  });

  it("returns true for validation_error with 'image is too large'", () => {
    expect(isMediaUrlRejection(new FakeNotionError("image is too large", "validation_error"))).toBe(true);
  });

  it("returns true for validation_error with 'unsupported image'", () => {
    expect(isMediaUrlRejection(new FakeNotionError("unsupported image format", "validation_error"))).toBe(true);
  });

  it("returns true for validation_error with 'external url is invalid'", () => {
    expect(isMediaUrlRejection(new FakeNotionError("external url is invalid", "validation_error"))).toBe(true);
  });

  it("returns true for validation_error with 'could not download'", () => {
    expect(isMediaUrlRejection(new FakeNotionError("could not download image", "validation_error"))).toBe(true);
  });

  it("returns false for validation_error with an unrelated message", () => {
    expect(isMediaUrlRejection(new FakeNotionError("title is required", "validation_error"))).toBe(false);
  });

  it("returns false for rate_limited", () => {
    expect(isMediaUrlRejection(new FakeNotionError("Invalid image url", "rate_limited"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isMediaUrlRejection("Invalid image url")).toBe(false);
    expect(isMediaUrlRejection(null)).toBe(false);
    expect(isMediaUrlRejection(undefined)).toBe(false);
  });
});
