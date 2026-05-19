import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dumpAuthArtifactsState } from "../src/validation-report.js";

describe("dumpAuthArtifactsState", () => {
  it("reports both artifacts present with sizes/counts", () => {
    const dir = mkdtempSync(join(tmpdir(), "artifacts-"));
    const storageStatePath = join(dir, "storage-state.json");
    const profilePath = join(dir, "profile");
    mkdirSync(profilePath);
    writeFileSync(storageStatePath, '{"cookies":[]}', "utf8");
    writeFileSync(join(profilePath, "Cookies"), "x".repeat(100), "utf8");
    writeFileSync(join(profilePath, "Preferences"), "{}", "utf8");

    const stats = dumpAuthArtifactsState({ storageStatePath, profilePath });
    expect(stats.storageStateFileExists).toBe(true);
    expect(stats.storageStateFileSizeBytes).toBe(14);
    expect(stats.profileDirExists).toBe(true);
    expect(stats.profileDirEntryCount).toBe(2);

    rmSync(dir, { recursive: true, force: true });
  });

  it("returns zeroed stats when both artifacts are missing", () => {
    const stats = dumpAuthArtifactsState({
      storageStatePath: "/nonexistent/storage-state.json",
      profilePath: "/nonexistent/profile"
    });
    expect(stats).toEqual({
      storageStateFileExists: false,
      storageStateFileSizeBytes: 0,
      profileDirExists: false,
      profileDirEntryCount: 0
    });
  });

  it("returns zeroed profile stats when profilePath is undefined", () => {
    const dir = mkdtempSync(join(tmpdir(), "artifacts-"));
    const storageStatePath = join(dir, "storage-state.json");
    writeFileSync(storageStatePath, '{"cookies":[]}', "utf8");

    const stats = dumpAuthArtifactsState({ storageStatePath });
    expect(stats.storageStateFileExists).toBe(true);
    expect(stats.profileDirExists).toBe(false);
    expect(stats.profileDirEntryCount).toBe(0);

    rmSync(dir, { recursive: true, force: true });
  });
});
