import { describe, expect, it } from "vitest";
import { computeFingerprintHash, finishSyncAttempt, startSyncAttempt } from "../src/index.js";

describe("computeFingerprintHash", () => {
  it("returns same hash for whitespace variants", () => {
    const a = computeFingerprintHash({
      displayTitle: "Book",
      creator: "Author",
      body: "Some quote text",
      positionStart: "12"
    });
    const b = computeFingerprintHash({
      displayTitle: "  book ",
      creator: "author",
      body: "Some   quote  text",
      positionStart: "12"
    });
    expect(a).toEqual(b);
  });

  it("differs when source scope differs", () => {
    const cloudHash = computeFingerprintHash({
      displayTitle: "Book",
      creator: "Author",
      body: "Some quote text",
      positionStart: "12",
      sourceScope: "cloud-notebook:B000123456"
    });
    const deviceHash = computeFingerprintHash({
      displayTitle: "Book",
      creator: "Author",
      body: "Some quote text",
      positionStart: "12",
      sourceScope: "device-export"
    });
    expect(cloudHash).not.toEqual(deviceHash);
  });
});

describe("job state machine", () => {
  it("tracks running and terminal states", () => {
    const started = startSyncAttempt({
      id: "job-1",
      source: "device-export",
      status: "idle"
    });
    expect(started.status).toBe("running");

    const finished = finishSyncAttempt(started, { status: "success" });
    expect(finished.status).toBe("success");
    expect(finished.lastSuccessAt).toBeTruthy();
  });
});
