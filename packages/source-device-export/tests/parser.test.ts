import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { computeRecordFingerprint, parseDeviceExport } from "../src/index.js";

describe("parseDeviceExport", () => {
  it("parses highlights and notes from Kindle export format", () => {
    const fixturePath = new URL("./fixtures/sample-clippings.txt", import.meta.url);
    const raw = fs.readFileSync(fixturePath, "utf8");

    const records = parseDeviceExport(raw);
    expect(records).toHaveLength(2);

    expect(records[0]).toMatchObject({
      displayTitle: "Atomic Habits",
      creator: "James Clear",
      positionKind: "location",
      positionStart: "101",
      positionEnd: "102"
    });

    expect(records[1]).toMatchObject({
      displayTitle: "Designing Data-Intensive Applications",
      creator: "Martin Kleppmann",
      positionKind: "page",
      positionStart: "42",
      note: "Revisit this for chapter summary."
    });
  });

  it("generates stable fingerprints for the same semantic record", () => {
    const base = {
      rawTitle: "Book (Author)",
      displayTitle: "Book",
      creator: "Author",
      body: "A quote",
      positionStart: "99"
    };
    const fingerprintA = computeRecordFingerprint(base);
    const fingerprintB = computeRecordFingerprint({
      ...base,
      body: "A    quote"
    });
    expect(fingerprintA).toEqual(fingerprintB);
  });
});
