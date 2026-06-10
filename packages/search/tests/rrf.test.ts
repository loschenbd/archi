import { describe, expect, it } from "vitest";
import { fuseRrf } from "../src/query/rrf.js";

describe("fuseRrf", () => {
  it("returns top items by combined rank", () => {
    const vec = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const fts = [{ id: "b" }, { id: "a" }, { id: "d" }];
    const fused = fuseRrf([vec, fts], (item) => item.id, { k: 60, limit: 10 });
    expect(fused.map((f) => f.key)).toEqual(["a", "b", "c", "d"]);
  });

  it("preserves source tags", () => {
    const vec = [{ id: "a" }, { id: "b" }];
    const fts = [{ id: "b" }, { id: "c" }];
    const fused = fuseRrf([vec, fts], (item) => item.id, { k: 60, limit: 10 });
    const byKey = new Map(fused.map((f) => [f.key, f.sourceIndices.sort()]));
    expect(byKey.get("a")).toEqual([0]);
    expect(byKey.get("b")).toEqual([0, 1]);
    expect(byKey.get("c")).toEqual([1]);
  });

  it("respects the limit", () => {
    const lists = [[{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]];
    const fused = fuseRrf(lists, (item) => item.id, { k: 60, limit: 2 });
    expect(fused.length).toBe(2);
  });
});
