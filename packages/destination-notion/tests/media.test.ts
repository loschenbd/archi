import { describe, expect, it, vi } from "vitest";
import { applyPageMedia, chooseMedia, emojiFor, type MediaNotionClient } from "../src/media.js";

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
});
