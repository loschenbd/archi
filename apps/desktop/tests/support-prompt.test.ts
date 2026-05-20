import { describe, expect, it } from "vitest";
import { shouldShowSupportPrompt } from "../src/renderer/support-prompt.js";

const baseEvent = {
  phase: "sync_complete" as const,
  status: "success" as const,
  counts: { passages: 5 }
};

describe("shouldShowSupportPrompt", () => {
  it("returns true on first successful sync that imported passages", () => {
    expect(shouldShowSupportPrompt(baseEvent, false)).toBe(true);
  });

  it("returns false when the prompt has already been shown", () => {
    expect(shouldShowSupportPrompt(baseEvent, true)).toBe(false);
  });

  it("returns false when the event is not sync_complete", () => {
    expect(shouldShowSupportPrompt({ ...baseEvent, phase: "sync_start" }, false)).toBe(false);
  });

  it("returns false when the sync failed", () => {
    expect(shouldShowSupportPrompt({ ...baseEvent, status: "failed" }, false)).toBe(false);
  });

  it("returns true when the sync is partial_success and imported >=1 passage", () => {
    expect(shouldShowSupportPrompt({ ...baseEvent, status: "partial_success" }, false)).toBe(true);
  });

  it("returns false when no passages were imported", () => {
    expect(shouldShowSupportPrompt({ ...baseEvent, counts: { passages: 0 } }, false)).toBe(false);
  });

  it("returns false when counts is undefined", () => {
    expect(shouldShowSupportPrompt({ ...baseEvent, counts: undefined }, false)).toBe(false);
  });
});
