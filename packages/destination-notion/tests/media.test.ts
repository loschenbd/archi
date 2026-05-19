import { describe, expect, it } from "vitest";
import { chooseMedia, emojiFor } from "../src/media.js";

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
