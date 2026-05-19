import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendValidationReport,
  type CloudValidationReport
} from "../src/validation-report.js";

function makeReport(overrides: Partial<CloudValidationReport> = {}): CloudValidationReport {
  return {
    timestamp: "2026-05-19T12:00:00.000Z",
    phase: "startup",
    headless: true,
    finalUrl: "https://read.amazon.com/kp/notebook",
    urlClassification: "notebook",
    loginFormVisible: false,
    notebookDomPresent: true,
    cookieJarSize: 12,
    hasAtMainCookie: true,
    hasUbidMainCookie: true,
    storageStateFileExists: true,
    storageStateFileSizeBytes: 5120,
    profileDirExists: true,
    profileDirEntryCount: 42,
    outcome: "connected",
    decisionReasonCode: "ok",
    ...overrides
  };
}

describe("appendValidationReport", () => {
  it("appends one JSONL line per call", () => {
    const dir = mkdtempSync(join(tmpdir(), "cloud-val-"));
    const logPath = join(dir, "cloud-validation.log");

    appendValidationReport(logPath, makeReport());
    appendValidationReport(logPath, makeReport({ outcome: "needs_auth", decisionReasonCode: "login_form_visible" }));

    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).outcome).toBe("connected");
    expect(JSON.parse(lines[1]).outcome).toBe("needs_auth");
  });

  it("rotates to .log.1 when current file exceeds 1 MB", () => {
    const dir = mkdtempSync(join(tmpdir(), "cloud-val-"));
    const logPath = join(dir, "cloud-validation.log");
    writeFileSync(logPath, "x".repeat(1024 * 1024 + 1), "utf8");

    appendValidationReport(logPath, makeReport({ decisionReasonCode: "ok" }));

    expect(existsSync(`${logPath}.1`)).toBe(true);
    const newSize = statSync(logPath).size;
    expect(newSize).toBeLessThan(2048);
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).decisionReasonCode).toBe("ok");
  });

  it("overwrites an existing .log.1 on rotation (single generation)", () => {
    const dir = mkdtempSync(join(tmpdir(), "cloud-val-"));
    const logPath = join(dir, "cloud-validation.log");
    writeFileSync(`${logPath}.1`, "old-generation\n", "utf8");
    writeFileSync(logPath, "y".repeat(1024 * 1024 + 1), "utf8");

    appendValidationReport(logPath, makeReport());

    expect(readFileSync(`${logPath}.1`, "utf8")).not.toContain("old-generation");
  });

  it("does not throw on write failures", () => {
    expect(() => appendValidationReport("/this/path/does/not/exist/log", makeReport())).not.toThrow();
  });
});
