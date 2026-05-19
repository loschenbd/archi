import { describe, expect, it } from "vitest";
import { CoreRepository, openCoreDatabase, type Passage, type Work } from "../src/index.js";

const canOpenSqlite = (() => {
  try {
    const db = openCoreDatabase(":memory:");
    db.close();
    return true;
  } catch {
    return false;
  }
})();

const testIfSqliteAvailable = canOpenSqlite ? it : it.skip;

function makeWork(overrides: Partial<Work> = {}): Work {
  return {
    id: "work-default",
    ingestSource: "cloud-notebook",
    displayTitle: "Book",
    rawTitle: "Book",
    workType: "book",
    labels: [],
    isArchived: false,
    firstIngestedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function makePassage(overrides: Partial<Passage> = {}): Passage {
  const passageId = overrides.id ?? "passage-default";
  return {
    id: passageId,
    workId: "work-default",
    body: "Quote body",
    labels: [],
    isStarred: false,
    isHidden: false,
    isArchived: false,
    ingestedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    fingerprintHash: `fingerprint-${passageId}`,
    ...overrides
  };
}

describe("cloud reconciliation deletes", () => {
  testIfSqliteAvailable("deletes cloud passages when allow-list is empty", () => {
    const db = openCoreDatabase(":memory:");
    const repo = new CoreRepository(db);
    repo.upsertWork(makeWork({ id: "cloud-work", ingestSource: "cloud-notebook" }));
    repo.upsertWork(makeWork({ id: "device-work", ingestSource: "device-export" }));
    repo.upsertPassage(makePassage({ id: "cloud-pass", workId: "cloud-work", externalPassageId: "cloud::1", fingerprintHash: "fp-cloud" }));
    repo.upsertPassage(makePassage({ id: "device-pass", workId: "device-work", fingerprintHash: "fp-device" }));

    const removed = repo.deleteCloudPassagesNotInExternalIds([]);

    expect(removed).toBe(1);
    expect(repo.listPassages().map((p) => p.id)).toEqual(["device-pass"]);
  });

  testIfSqliteAvailable("keeps allow-listed cloud passages", () => {
    const db = openCoreDatabase(":memory:");
    const repo = new CoreRepository(db);
    repo.upsertWork(makeWork({ id: "cloud-work", ingestSource: "cloud-notebook" }));
    repo.upsertPassage(makePassage({ id: "keep", workId: "cloud-work", externalPassageId: "cloud::keep", fingerprintHash: "fp-keep" }));
    repo.upsertPassage(makePassage({ id: "drop", workId: "cloud-work", externalPassageId: "cloud::drop", fingerprintHash: "fp-drop" }));

    const removed = repo.deleteCloudPassagesNotInExternalIds(["cloud::keep"]);

    expect(removed).toBe(1);
    expect(repo.listPassages().map((p) => p.id)).toEqual(["keep"]);
  });

  testIfSqliteAvailable("deletes empty cloud works only", () => {
    const db = openCoreDatabase(":memory:");
    const repo = new CoreRepository(db);
    repo.upsertWork(makeWork({ id: "cloud-empty", ingestSource: "cloud-notebook", displayTitle: "Cloud Empty", rawTitle: "Cloud Empty" }));
    repo.upsertWork(makeWork({ id: "cloud-keep", ingestSource: "cloud-notebook", displayTitle: "Cloud Keep", rawTitle: "Cloud Keep" }));
    repo.upsertWork(makeWork({ id: "device-keep", ingestSource: "device-export", displayTitle: "Device Keep", rawTitle: "Device Keep" }));
    repo.upsertPassage(makePassage({ id: "keep-pass", workId: "cloud-keep", externalPassageId: "cloud::keep", fingerprintHash: "fp-keep-pass" }));

    const removedWorks = repo.deleteEmptyCloudWorks();

    expect(removedWorks).toBe(1);
    const remainingWorkIds = repo.listWorks().map((work) => work.id).sort();
    expect(remainingWorkIds).toEqual(["cloud-keep", "device-keep"]);
  });
});
