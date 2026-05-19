import { describe, expect, it } from "vitest";
import { looksLikeNotebookMetadataTitle, resolveReadableNotebookTitle } from "../src/index.js";

describe("looksLikeNotebookMetadataTitle", () => {
  it("detects notebook highlight metadata labels", () => {
    expect(looksLikeNotebookMetadataTitle("Yellow highlight | Page: 9")).toBe(true);
    expect(looksLikeNotebookMetadataTitle("Location: 1,240")).toBe(true);
    expect(looksLikeNotebookMetadataTitle("Loc 412")).toBe(true);
  });

  it("does not flag normal human-readable titles", () => {
    expect(looksLikeNotebookMetadataTitle("A Wizard of Earthsea")).toBe(false);
    expect(looksLikeNotebookMetadataTitle("12 Rules for Life")).toBe(false);
  });
});

describe("resolveReadableNotebookTitle", () => {
  it("prefers first non-metadata, non-ASIN title", () => {
    const title = resolveReadableNotebookTitle(["Yellow highlight | Page: 9", "B000FC1JAI", "A Wizard of Earthsea"]);
    expect(title).toBe("A Wizard of Earthsea");
  });

  it("returns undefined when no trustworthy title candidates exist", () => {
    const title = resolveReadableNotebookTitle(["Yellow highlight | Location: 12", "B000FC1JAI"]);
    expect(title).toBeUndefined();
  });
});
