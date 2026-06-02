import { describe, expect, it } from "vitest";
import { openCoreDatabase } from "../src/db/client.js";

describe("openCoreDatabase", () => {
  it("loads the sqlite-vec extension and exposes vec_version()", () => {
    const db = openCoreDatabase(":memory:");
    const row = db.prepare("SELECT vec_version() AS v").get() as { v: string };
    expect(row.v).toMatch(/^v?\d+\.\d+/);
    db.close();
  });
});
