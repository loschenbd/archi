import { describe, expect, it } from "vitest";
import { CloudValidationLog } from "../src/main/connections.js";

describe("CloudValidationLog", () => {
  it("keeps the most recent N reports (ring buffer of 20)", () => {
    const writes: unknown[] = [];
    const log = new CloudValidationLog({ persist: (r) => writes.push(r) });

    for (let i = 0; i < 25; i += 1) {
      log.record({
        timestamp: `2026-05-19T12:00:${String(i).padStart(2, "0")}.000Z`,
        phase: "fetch",
        headless: true,
        finalUrl: "https://read.amazon.com/kp/notebook",
        urlClassification: "notebook",
        loginFormVisible: false,
        notebookDomPresent: true,
        cookieJarSize: 5,
        hasAtMainCookie: true,
        hasUbidMainCookie: true,
        storageStateFileExists: true,
        storageStateFileSizeBytes: 1024,
        profileDirExists: true,
        profileDirEntryCount: 10,
        outcome: "connected",
        decisionReasonCode: "ok"
      });
    }

    expect(log.recent(50)).toHaveLength(20);
    expect(log.recent(5)).toHaveLength(5);
    expect(log.latest()?.timestamp).toBe("2026-05-19T12:00:24.000Z");
  });

  it("persists every report via the persist callback", () => {
    const writes: unknown[] = [];
    const log = new CloudValidationLog({ persist: (r) => writes.push(r) });
    log.record({
      timestamp: "2026-05-19T12:00:00.000Z",
      phase: "startup",
      headless: false,
      finalUrl: "",
      urlClassification: "unknown",
      loginFormVisible: false,
      notebookDomPresent: false,
      cookieJarSize: 0,
      hasAtMainCookie: false,
      hasUbidMainCookie: false,
      storageStateFileExists: false,
      storageStateFileSizeBytes: 0,
      profileDirExists: false,
      profileDirEntryCount: 0,
      outcome: "transient",
      decisionReasonCode: "ok"
    });
    expect(writes).toHaveLength(1);
  });

  it("returns recent reports in newest-first order", () => {
    const log = new CloudValidationLog({ persist: () => undefined });
    log.record({
      timestamp: "2026-05-19T12:00:00.000Z",
      phase: "startup",
      headless: true,
      finalUrl: "",
      urlClassification: "unknown",
      loginFormVisible: false,
      notebookDomPresent: false,
      cookieJarSize: 0,
      hasAtMainCookie: false,
      hasUbidMainCookie: false,
      storageStateFileExists: false,
      storageStateFileSizeBytes: 0,
      profileDirExists: false,
      profileDirEntryCount: 0,
      outcome: "transient",
      decisionReasonCode: "ok"
    });
    log.record({
      timestamp: "2026-05-19T12:00:01.000Z",
      phase: "fetch",
      headless: true,
      finalUrl: "https://read.amazon.com/kp/notebook",
      urlClassification: "notebook",
      loginFormVisible: false,
      notebookDomPresent: true,
      cookieJarSize: 5,
      hasAtMainCookie: true,
      hasUbidMainCookie: true,
      storageStateFileExists: true,
      storageStateFileSizeBytes: 1024,
      profileDirExists: true,
      profileDirEntryCount: 10,
      outcome: "connected",
      decisionReasonCode: "ok"
    });
    const recent = log.recent(5);
    expect(recent[0].timestamp).toBe("2026-05-19T12:00:01.000Z");
    expect(recent[1].timestamp).toBe("2026-05-19T12:00:00.000Z");
  });
});
