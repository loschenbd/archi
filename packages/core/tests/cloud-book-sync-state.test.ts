import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CoreRepository,
  openCoreDatabase,
  type Passage,
  type Work
} from "../src/index.js";

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
  return {
    id: "passage-default",
    workId: "work-default",
    body: "quote",
    labels: [],
    isStarred: false,
    isHidden: false,
    isArchived: false,
    ingestedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    fingerprintHash: "fp-default",
    ...overrides
  };
}

describe("cloud_book_sync_state repository methods", () => {
  let repo: CoreRepository;
  let db: ReturnType<typeof openCoreDatabase>;

  beforeEach(() => {
    if (!canOpenSqlite) return;
    db = openCoreDatabase(":memory:");
    repo = new CoreRepository(db);
  });

  afterEach(() => {
    if (!canOpenSqlite) return;
    db.close();
  });

  testIfSqliteAvailable("getCloudBookSyncStates returns empty map for empty table", () => {
    expect(repo.getCloudBookSyncStates().size).toBe(0);
  });

  testIfSqliteAvailable("upsertCloudBookSyncState inserts then updates the same row", () => {
    repo.upsertCloudBookSyncState({
      externalBookId: "B001",
      fingerprint: "v1:10:abcd",
      fetchedAt: "2026-05-19T10:00:00.000Z",
      seenAt: "2026-05-19T10:00:00.000Z"
    });
    let map = repo.getCloudBookSyncStates();
    expect(map.get("B001")).toEqual({
      fingerprint: "v1:10:abcd",
      lastFetchedAt: "2026-05-19T10:00:00.000Z",
      lastSeenAt: "2026-05-19T10:00:00.000Z"
    });

    repo.upsertCloudBookSyncState({
      externalBookId: "B001",
      fingerprint: "v1:11:efgh",
      fetchedAt: "2026-05-19T11:00:00.000Z",
      seenAt: "2026-05-19T11:00:00.000Z"
    });
    map = repo.getCloudBookSyncStates();
    expect(map.get("B001")).toEqual({
      fingerprint: "v1:11:efgh",
      lastFetchedAt: "2026-05-19T11:00:00.000Z",
      lastSeenAt: "2026-05-19T11:00:00.000Z"
    });
  });

  testIfSqliteAvailable("markCloudBookSeen advances last_seen_at only", () => {
    repo.upsertCloudBookSyncState({
      externalBookId: "B001",
      fingerprint: "v1:10:abcd",
      fetchedAt: "2026-05-19T10:00:00.000Z",
      seenAt: "2026-05-19T10:00:00.000Z"
    });
    repo.markCloudBookSeen("B001", "2026-05-19T12:00:00.000Z");
    const map = repo.getCloudBookSyncStates();
    expect(map.get("B001")).toEqual({
      fingerprint: "v1:10:abcd",
      lastFetchedAt: "2026-05-19T10:00:00.000Z",
      lastSeenAt: "2026-05-19T12:00:00.000Z"
    });
  });

  testIfSqliteAvailable("markCloudBookSeen is a no-op when the row does not exist", () => {
    repo.markCloudBookSeen("B999", "2026-05-19T12:00:00.000Z");
    expect(repo.getCloudBookSyncStates().size).toBe(0);
  });

  testIfSqliteAvailable("pruneCloudBookSyncStatesNotIn deletes rows outside the seen set", () => {
    for (const id of ["B001", "B002", "B003"]) {
      repo.upsertCloudBookSyncState({
        externalBookId: id,
        fingerprint: `v1:1:${id}`,
        fetchedAt: "2026-05-19T10:00:00.000Z",
        seenAt: "2026-05-19T10:00:00.000Z"
      });
    }
    const removed = repo.pruneCloudBookSyncStatesNotIn(["B001", "B003"]);
    expect(removed).toBe(1);
    const remaining = Array.from(repo.getCloudBookSyncStates().keys()).sort();
    expect(remaining).toEqual(["B001", "B003"]);
  });

  testIfSqliteAvailable("pruneCloudBookSyncStatesNotIn with empty input deletes all rows", () => {
    repo.upsertCloudBookSyncState({
      externalBookId: "B001",
      fingerprint: "v1:1:x",
      fetchedAt: "2026-05-19T10:00:00.000Z",
      seenAt: "2026-05-19T10:00:00.000Z"
    });
    expect(repo.pruneCloudBookSyncStatesNotIn([])).toBe(1);
    expect(repo.getCloudBookSyncStates().size).toBe(0);
  });
});

describe("scoped cloud deletion methods", () => {
  let repo: CoreRepository;
  let db: ReturnType<typeof openCoreDatabase>;

  beforeEach(() => {
    if (!canOpenSqlite) return;
    db = openCoreDatabase(":memory:");
    repo = new CoreRepository(db);
  });

  afterEach(() => {
    if (!canOpenSqlite) return;
    db.close();
  });

  testIfSqliteAvailable("deleteCloudPassagesInBooksNotInExternalIds only touches in-scope books", () => {
    repo.upsertWork(makeWork({ id: "workA", externalId: "B001" }));
    repo.upsertWork(makeWork({ id: "workB", externalId: "B002" }));
    repo.upsertPassage(makePassage({
      id: "pA1", workId: "workA", externalPassageId: "B001::p1", fingerprintHash: "fpA1"
    }));
    repo.upsertPassage(makePassage({
      id: "pA2", workId: "workA", externalPassageId: "B001::p2", fingerprintHash: "fpA2"
    }));
    repo.upsertPassage(makePassage({
      id: "pB1", workId: "workB", externalPassageId: "B002::p1", fingerprintHash: "fpB1"
    }));

    // Run scope = only workA; retained = only pA1. pA2 should die. pB1 must NOT die.
    const removed = repo.deleteCloudPassagesInBooksNotInExternalIds(["B001"], ["B001::p1"]);
    expect(removed).toBe(1);
    expect(repo.listPassages().map((p) => p.id).sort()).toEqual(["pA1", "pB1"]);
  });

  testIfSqliteAvailable("deleteCloudPassagesInBooksNotInExternalIds ignores non-cloud works", () => {
    repo.upsertWork(makeWork({ id: "workA", externalId: "B001", ingestSource: "device-export" }));
    repo.upsertPassage(makePassage({
      id: "pA1", workId: "workA", externalPassageId: "B001::p1", fingerprintHash: "fpA1"
    }));
    const removed = repo.deleteCloudPassagesInBooksNotInExternalIds(["B001"], []);
    expect(removed).toBe(0);
    expect(repo.listPassages().map((p) => p.id)).toEqual(["pA1"]);
  });

  testIfSqliteAvailable("deleteCloudWorksByExternalIdsNotIn removes vanished cloud works only", () => {
    repo.upsertWork(makeWork({ id: "workCloud", externalId: "B001", ingestSource: "cloud-notebook" }));
    repo.upsertWork(makeWork({ id: "workDevice", externalId: "B002", ingestSource: "device-export" }));
    repo.upsertPassage(makePassage({ id: "pC", workId: "workCloud", externalPassageId: "B001::p1", fingerprintHash: "fpC" }));
    repo.upsertPassage(makePassage({ id: "pD", workId: "workDevice", externalPassageId: "B002::p1", fingerprintHash: "fpD" }));

    // Sidebar list omits B001. Cloud workCloud should die; device workDevice should remain.
    const removed = repo.deleteCloudWorksByExternalIdsNotIn(["B003"]);
    expect(removed).toBe(1);
    const works = repo.listWorks().map((w) => w.id).sort();
    expect(works).toEqual(["workDevice"]);
    expect(repo.listPassages().map((p) => p.id)).toEqual(["pD"]); // FK cascade dropped pC
  });

  testIfSqliteAvailable("deleteEmptyCloudWorksByExternalIds drops empty in-scope works only", () => {
    repo.upsertWork(makeWork({ id: "workEmpty", externalId: "B001", ingestSource: "cloud-notebook" }));
    repo.upsertWork(makeWork({ id: "workFull",  externalId: "B002", ingestSource: "cloud-notebook" }));
    repo.upsertWork(makeWork({ id: "workOutOfScope", externalId: "B003", ingestSource: "cloud-notebook" }));
    repo.upsertPassage(makePassage({ id: "pF", workId: "workFull", externalPassageId: "B002::p1", fingerprintHash: "fpF" }));

    // Scope = [B001, B002]. workEmpty empty -> dies. workFull has passage -> lives. workOutOfScope empty but
    // not in scope -> lives.
    const removed = repo.deleteEmptyCloudWorksByExternalIds(["B001", "B002"]);
    expect(removed).toBe(1);
    const works = repo.listWorks().map((w) => w.id).sort();
    expect(works).toEqual(["workFull", "workOutOfScope"]);
  });
});
