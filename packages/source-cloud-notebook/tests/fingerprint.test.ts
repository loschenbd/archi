import { describe, expect, it } from "vitest";
import {
  computeBookFingerprint,
  decideBookAction,
  FINGERPRINT_FIRST_ID_LIMIT,
  summarizeBookOutcomes,
  type BookOutcome
} from "../src/fingerprint.js";

describe("computeBookFingerprint", () => {
  it("returns the same value for identical inputs", () => {
    const a = computeBookFingerprint({ visibleAnnotationCount: 5, firstAnnotationIds: ["a", "b", "c"] });
    const b = computeBookFingerprint({ visibleAnnotationCount: 5, firstAnnotationIds: ["a", "b", "c"] });
    expect(a).toBe(b);
  });

  it("changes when count differs", () => {
    const a = computeBookFingerprint({ visibleAnnotationCount: 5, firstAnnotationIds: ["a"] });
    const b = computeBookFingerprint({ visibleAnnotationCount: 6, firstAnnotationIds: ["a"] });
    expect(a).not.toBe(b);
  });

  it("changes when any id differs", () => {
    const a = computeBookFingerprint({ visibleAnnotationCount: 3, firstAnnotationIds: ["a", "b", "c"] });
    const b = computeBookFingerprint({ visibleAnnotationCount: 3, firstAnnotationIds: ["a", "b", "z"] });
    expect(a).not.toBe(b);
  });

  it("changes when id order differs (DOM order is part of the fingerprint)", () => {
    const a = computeBookFingerprint({ visibleAnnotationCount: 3, firstAnnotationIds: ["a", "b", "c"] });
    const b = computeBookFingerprint({ visibleAnnotationCount: 3, firstAnnotationIds: ["c", "b", "a"] });
    expect(a).not.toBe(b);
  });

  it("starts with the v1: version prefix", () => {
    const fp = computeBookFingerprint({ visibleAnnotationCount: 0, firstAnnotationIds: [] });
    expect(fp.startsWith("v1:")).toBe(true);
  });

  it("returns a stable, distinct value for the empty-count empty-ids case", () => {
    const empty = computeBookFingerprint({ visibleAnnotationCount: 0, firstAnnotationIds: [] });
    const oneId = computeBookFingerprint({ visibleAnnotationCount: 0, firstAnnotationIds: ["x"] });
    expect(empty).not.toBe(oneId);
    expect(empty).toBe(computeBookFingerprint({ visibleAnnotationCount: 0, firstAnnotationIds: [] }));
  });

  it("truncates ids longer than FINGERPRINT_FIRST_ID_LIMIT", () => {
    const longList = Array.from({ length: FINGERPRINT_FIRST_ID_LIMIT + 5 }, (_, i) => `id${i}`);
    const truncated = longList.slice(0, FINGERPRINT_FIRST_ID_LIMIT);
    expect(computeBookFingerprint({ visibleAnnotationCount: 100, firstAnnotationIds: longList })).toBe(
      computeBookFingerprint({ visibleAnnotationCount: 100, firstAnnotationIds: truncated })
    );
  });
});

describe("decideBookAction", () => {
  const peeked = "v1:10:aaaaaaaaaaaaaaaa";

  it("returns no-prior when no fingerprint is known", () => {
    const decision = decideBookAction({ prior: undefined, peeked, forceFullSweep: false });
    expect(decision).toEqual({ kind: "extract", reason: "no-prior" });
  });

  it("returns fingerprint-match when prior equals peeked", () => {
    const decision = decideBookAction({ prior: peeked, peeked, forceFullSweep: false });
    expect(decision).toEqual({ kind: "skip", reason: "fingerprint-match" });
  });

  it("returns forced regardless of equality when forceFullSweep is true", () => {
    const decision = decideBookAction({ prior: peeked, peeked, forceFullSweep: true });
    expect(decision).toEqual({ kind: "extract", reason: "forced" });
  });

  it("returns prefix-mismatch when version differs", () => {
    const decision = decideBookAction({
      prior: "v0:10:aaaaaaaaaaaaaaaa",
      peeked,
      forceFullSweep: false
    });
    expect(decision).toEqual({ kind: "extract", reason: "prefix-mismatch" });
  });

  it("returns count-differs when count differs", () => {
    const decision = decideBookAction({
      prior: "v1:11:aaaaaaaaaaaaaaaa",
      peeked,
      forceFullSweep: false
    });
    expect(decision).toEqual({ kind: "extract", reason: "count-differs" });
  });

  it("returns ids-differ when only the hash suffix differs", () => {
    const decision = decideBookAction({
      prior: "v1:10:bbbbbbbbbbbbbbbb",
      peeked,
      forceFullSweep: false
    });
    expect(decision).toEqual({ kind: "extract", reason: "ids-differ" });
  });
});

describe("summarizeBookOutcomes", () => {
  it("classifies each outcome correctly", () => {
    const outcomes: BookOutcome[] = [
      { bookId: "B1", outcome: "extracted", fingerprint: "v1:1:a" },
      { bookId: "B2", outcome: "skipped", fingerprint: "v1:2:b" },
      { bookId: "B3", outcome: "select-failed" },
      { bookId: "B4", outcome: "extract-failed", fingerprint: "v1:4:d" },
      { bookId: "B5", outcome: "peek-failed-extracted" }
    ];
    const s = summarizeBookOutcomes(outcomes);
    expect(s.sidebarBookIds).toEqual(["B1", "B2", "B3", "B4", "B5"]);
    expect(s.fetchedBookIds).toEqual(["B1", "B5"]);
    expect(s.skippedByFingerprintBookIds).toEqual(["B2"]);
    expect(s.selectFailedBookIds).toEqual(["B3"]);
    expect(s.fingerprints.get("B1")).toBe("v1:1:a");
    expect(s.fingerprints.get("B2")).toBe("v1:2:b");
    expect(s.fingerprints.has("B3")).toBe(false);
    expect(s.fingerprints.has("B4")).toBe(false);
    expect(s.fingerprints.has("B5")).toBe(false);
  });

  it("handles empty input", () => {
    const s = summarizeBookOutcomes([]);
    expect(s.sidebarBookIds).toEqual([]);
    expect(s.fetchedBookIds).toEqual([]);
    expect(s.skippedByFingerprintBookIds).toEqual([]);
    expect(s.selectFailedBookIds).toEqual([]);
    expect(s.fingerprints.size).toBe(0);
  });
});
