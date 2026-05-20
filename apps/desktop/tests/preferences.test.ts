import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PreferencesStore } from "../src/main/preferences.js";

describe("PreferencesStore", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archi-prefs-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the fallback when no file exists", () => {
    const store = new PreferencesStore(tmpDir);
    expect(store.get("foo", "default")).toBe("default");
    expect(store.get("missing", false)).toBe(false);
  });

  it("persists and reads back values across instances", () => {
    const a = new PreferencesStore(tmpDir);
    a.set("support.promptShown", true);
    const b = new PreferencesStore(tmpDir);
    expect(b.get("support.promptShown", false)).toBe(true);
  });

  it("returns the fallback when the file is corrupted", () => {
    fs.writeFileSync(path.join(tmpDir, "prefs.json"), "{not json");
    const store = new PreferencesStore(tmpDir);
    expect(store.get("foo", "fallback")).toBe("fallback");
  });

  it("supports overwriting a value", () => {
    const store = new PreferencesStore(tmpDir);
    store.set("k", 1);
    store.set("k", 2);
    expect(store.get("k", 0)).toBe(2);
  });
});
