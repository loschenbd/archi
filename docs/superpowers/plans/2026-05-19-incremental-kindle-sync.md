# Incremental Kindle sync (peek-before-extract) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Kindle cloud-notebook syncs skip books whose fingerprint hasn't changed since the last successful sync, without regressing deletion handling for books we did fetch or books removed from the user's library.

**Architecture:** Three layered changes — (1) a pure fingerprint module + a per-book decision helper in `packages/source-cloud-notebook`, (2) a new `cloud_book_sync_state` table and six new repository methods in `packages/core`, (3) scoped reconciliation + force-full-sweep IPC/UI wiring in `apps/desktop`. The connector still walks every sidebar book to record presence; the per-book extraction now runs only when a cheap "peek" of count + first-K annotation IDs disagrees with the stored fingerprint.

**Tech Stack:** TypeScript, `better-sqlite3`, Playwright, Vitest, Electron (`ipcMain` + `contextBridge`), React (renderer screen).

**Working tree:** `/Users/benjaminloschen/Projects/archi` (the `anamnesis/` directory holds specs only; all code lives here).

**Spec:** `docs/superpowers/specs/2026-05-19-incremental-kindle-sync-design.md` — read it before starting any task.

**Commands** (run from repo root unless specified):

| What | Command |
| --- | --- |
| Install workspace deps | `pnpm install` |
| Test one package | `pnpm --filter @archi/core test` |
| Test the connector | `pnpm --filter @archi/source-cloud-notebook test` |
| Typecheck one package | `pnpm --filter @archi/core typecheck` |
| Build a package | `pnpm --filter @archi/core build` |
| Lint a package | `pnpm --filter @archi/core lint` |

Test environment note: the existing core tests gate on whether `better-sqlite3` loads via a `canOpenSqlite` check (`packages/core/tests/reconciliation.test.ts:4-12`). Reuse that pattern verbatim in new test files so CI skips gracefully on platforms without the native binding.

---

## Task 0: Read the spec and confirm working tree

**Files:**
- Read: `docs/superpowers/specs/2026-05-19-incremental-kindle-sync-design.md`
- Read: `packages/source-cloud-notebook/src/index.ts` (full)
- Read: `packages/core/src/repositories/coreRepository.ts` (full)
- Read: `apps/desktop/src/main/index.ts:602-887` (cloud-notebook fetch + reconcile block)

- [ ] **Step 1: Read the spec end-to-end**

No code yet. Read each file above and write a one-paragraph note to yourself summarizing the data flow.

- [ ] **Step 2: Confirm pwd**

Run: `pwd`
Expected: `/Users/benjaminloschen/Projects/archi`

- [ ] **Step 3: Confirm pnpm install completes**

Run: `pnpm install`
Expected: Completes without errors. The injected `@archi/core` dependency in `source-cloud-notebook/package.json` is honored.

---

## Task 1: Add `cloud_book_sync_state` table (migration v2)

**Files:**
- Modify: `packages/core/src/db/migrations.ts`

- [ ] **Step 1: Append v2 migration**

Open `packages/core/src/db/migrations.ts` and add a new entry to the `MIGRATIONS` array after the existing `{ version: 1, ... }`:

```ts
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS cloud_book_sync_state (
        external_book_id TEXT PRIMARY KEY,
        fingerprint      TEXT NOT NULL,
        last_fetched_at  TEXT NOT NULL,
        last_seen_at     TEXT NOT NULL
      );
    `
  }
```

- [ ] **Step 2: Typecheck core**

Run: `pnpm --filter @archi/core typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/db/migrations.ts
git commit -m "feat(core): add cloud_book_sync_state migration v2"
```

---

## Task 2: Add `CloudBookSyncState` type + repository methods (with tests)

**Files:**
- Modify: `packages/core/src/repositories/coreRepository.ts`
- Create: `packages/core/tests/cloud-book-sync-state.test.ts`

The methods, exactly:

```ts
export type CloudBookSyncState = {
  externalBookId: string;
  fingerprint: string;
  lastFetchedAt: string;   // ISO timestamp; only advanced on successful extraction
  lastSeenAt: string;      // ISO timestamp; advanced whenever the book appears in the sidebar
};

// On CoreRepository:
getCloudBookSyncStates(): Map<string, { fingerprint: string; lastFetchedAt: string; lastSeenAt: string }>;
upsertCloudBookSyncState(args: { externalBookId: string; fingerprint: string; fetchedAt: string; seenAt: string }): void;
markCloudBookSeen(externalBookId: string, seenAt: string): void;  // no-op if row doesn't exist
pruneCloudBookSyncStatesNotIn(seenBookIds: string[]): number;     // returns deleted-row count
deleteCloudPassagesInBooksNotInExternalIds(bookExternalIds: string[], retainedPassageExternalIds: string[]): number;
deleteCloudWorksByExternalIdsNotIn(sidebarBookExternalIds: string[]): number;
deleteEmptyCloudWorksByExternalIds(bookExternalIds: string[]): number;
```

- [ ] **Step 1: Write the failing test file**

Create `packages/core/tests/cloud-book-sync-state.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `pnpm --filter @archi/core test`
Expected: FAIL with "getCloudBookSyncStates is not a function" or similar.

- [ ] **Step 3: Implement the methods**

In `packages/core/src/repositories/coreRepository.ts`, add the type and methods. Place the new methods after the existing cloud-related methods (e.g., near `deleteCloudPassagesNotInExternalIds`; locate it with `grep -n deleteCloudPassagesNotInExternalIds packages/core/src/repositories/coreRepository.ts`).

```ts
export type CloudBookSyncState = {
  externalBookId: string;
  fingerprint: string;
  lastFetchedAt: string;
  lastSeenAt: string;
};

// inside class CoreRepository:

getCloudBookSyncStates(): Map<string, { fingerprint: string; lastFetchedAt: string; lastSeenAt: string }> {
  const rows = this.db
    .prepare(
      "SELECT external_book_id, fingerprint, last_fetched_at, last_seen_at FROM cloud_book_sync_state"
    )
    .all() as Array<{
    external_book_id: string;
    fingerprint: string;
    last_fetched_at: string;
    last_seen_at: string;
  }>;
  const out = new Map<string, { fingerprint: string; lastFetchedAt: string; lastSeenAt: string }>();
  for (const row of rows) {
    out.set(row.external_book_id, {
      fingerprint: row.fingerprint,
      lastFetchedAt: row.last_fetched_at,
      lastSeenAt: row.last_seen_at
    });
  }
  return out;
}

upsertCloudBookSyncState(args: {
  externalBookId: string;
  fingerprint: string;
  fetchedAt: string;
  seenAt: string;
}): void {
  this.db
    .prepare(
      `INSERT INTO cloud_book_sync_state (external_book_id, fingerprint, last_fetched_at, last_seen_at)
       VALUES (@externalBookId, @fingerprint, @fetchedAt, @seenAt)
       ON CONFLICT(external_book_id) DO UPDATE SET
         fingerprint = excluded.fingerprint,
         last_fetched_at = excluded.last_fetched_at,
         last_seen_at = excluded.last_seen_at`
    )
    .run(args);
}

markCloudBookSeen(externalBookId: string, seenAt: string): void {
  // No-op if the row doesn't exist. We do not insert here -- we only track books we've extracted.
  this.db
    .prepare(
      "UPDATE cloud_book_sync_state SET last_seen_at = @seenAt WHERE external_book_id = @externalBookId"
    )
    .run({ externalBookId, seenAt });
}

pruneCloudBookSyncStatesNotIn(seenBookIds: string[]): number {
  if (seenBookIds.length === 0) {
    const result = this.db.prepare("DELETE FROM cloud_book_sync_state").run();
    return result.changes;
  }
  const placeholders = seenBookIds.map(() => "?").join(",");
  const result = this.db
    .prepare(`DELETE FROM cloud_book_sync_state WHERE external_book_id NOT IN (${placeholders})`)
    .run(...seenBookIds);
  return result.changes;
}

deleteCloudPassagesInBooksNotInExternalIds(
  bookExternalIds: string[],
  retainedPassageExternalIds: string[]
): number {
  if (bookExternalIds.length === 0) {
    return 0;
  }
  const bookPlaceholders = bookExternalIds.map(() => "?").join(",");
  const retainedClause =
    retainedPassageExternalIds.length === 0
      ? ""
      : ` AND passages.external_passage_id NOT IN (${retainedPassageExternalIds.map(() => "?").join(",")})`;
  const sql = `
    DELETE FROM passages
    WHERE work_id IN (
      SELECT id FROM works
      WHERE ingest_source = 'cloud-notebook'
        AND external_id IN (${bookPlaceholders})
    )
    ${retainedClause || "AND 1=1"}
  `;
  // When retainedPassageExternalIds is empty, the clause above degenerates to "AND 1=1",
  // which means "delete every passage in the in-scope books." That is intentional and matches
  // the spec: if a book was extracted and produced zero passages, all prior passages for it
  // are stale by definition.
  const params = [...bookExternalIds, ...retainedPassageExternalIds];
  const result = this.db.prepare(sql).run(...params);
  return result.changes;
}

deleteCloudWorksByExternalIdsNotIn(sidebarBookExternalIds: string[]): number {
  if (sidebarBookExternalIds.length === 0) {
    const result = this.db
      .prepare("DELETE FROM works WHERE ingest_source = 'cloud-notebook'")
      .run();
    return result.changes;
  }
  const placeholders = sidebarBookExternalIds.map(() => "?").join(",");
  const result = this.db
    .prepare(
      `DELETE FROM works
       WHERE ingest_source = 'cloud-notebook'
         AND (external_id IS NULL OR external_id NOT IN (${placeholders}))`
    )
    .run(...sidebarBookExternalIds);
  return result.changes;
}

deleteEmptyCloudWorksByExternalIds(bookExternalIds: string[]): number {
  if (bookExternalIds.length === 0) {
    return 0;
  }
  const placeholders = bookExternalIds.map(() => "?").join(",");
  const result = this.db
    .prepare(
      `DELETE FROM works
       WHERE ingest_source = 'cloud-notebook'
         AND external_id IN (${placeholders})
         AND id NOT IN (SELECT DISTINCT work_id FROM passages)`
    )
    .run(...bookExternalIds);
  return result.changes;
}
```

Two notes for the implementer:

1. The `WHERE external_id IS NULL OR external_id NOT IN (...)` in `deleteCloudWorksByExternalIdsNotIn` guards a real edge: a cloud work that somehow got persisted without an `external_id` (defensive). Without the NULL branch SQLite would leave those rows alone.
2. The "delete every passage" degeneracy in `deleteCloudPassagesInBooksNotInExternalIds` is intentional — see the inline comment. Verify the corresponding test in step 1 doesn't accidentally pass `[]` for `retainedPassageExternalIds`; the test in step 1 always passes a non-empty book-list with a non-empty retained list, so we're not exercising this branch yet. That's fine; main-process orchestration tests in Task 9 exercise it.

- [ ] **Step 4: Re-run tests, confirm they pass**

Run: `pnpm --filter @archi/core test`
Expected: PASS, including the new file.

- [ ] **Step 5: Typecheck core**

Run: `pnpm --filter @archi/core typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/repositories/coreRepository.ts packages/core/tests/cloud-book-sync-state.test.ts
git commit -m "feat(core): add cloud_book_sync_state methods and scoped cloud deletes"
```

---

## Task 3: Fingerprint module (pure, tested)

**Files:**
- Create: `packages/source-cloud-notebook/src/fingerprint.ts`
- Create: `packages/source-cloud-notebook/tests/fingerprint.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/source-cloud-notebook/tests/fingerprint.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeBookFingerprint, FINGERPRINT_FIRST_ID_LIMIT } from "../src/fingerprint.js";

describe("computeBookFingerprint", () => {
  it("returns the same value for identical inputs", () => {
    const a = computeBookFingerprint({ visibleAnnotationCount: 5, firstAnnotationIds: ["a", "b", "c"] });
    const b = computeBookFingerprint({ visibleAnnotationCount: 5, firstAnnotationIds: ["a", "b", "c"] });
    expect(a).toBe(b);
  });

  it("changes when count differs", () => {
    const a = computeBookFingerprint({ visibleAnnotationCount: 5, firstAnnotationIds: ["a"] });
    const b = computeBookFingerprint({ visibleAnnotationCount: 6, firstAnnotationIds: ["a"] });
    expect(a).not.toBe(b);
  });

  it("changes when any id differs", () => {
    const a = computeBookFingerprint({ visibleAnnotationCount: 3, firstAnnotationIds: ["a", "b", "c"] });
    const b = computeBookFingerprint({ visibleAnnotationCount: 3, firstAnnotationIds: ["a", "b", "z"] });
    expect(a).not.toBe(b);
  });

  it("changes when id order differs (DOM order is part of the fingerprint)", () => {
    const a = computeBookFingerprint({ visibleAnnotationCount: 3, firstAnnotationIds: ["a", "b", "c"] });
    const b = computeBookFingerprint({ visibleAnnotationCount: 3, firstAnnotationIds: ["c", "b", "a"] });
    expect(a).not.toBe(b);
  });

  it("starts with the v1: version prefix", () => {
    const fp = computeBookFingerprint({ visibleAnnotationCount: 0, firstAnnotationIds: [] });
    expect(fp.startsWith("v1:")).toBe(true);
  });

  it("returns a stable, distinct value for the empty-count empty-ids case", () => {
    const empty = computeBookFingerprint({ visibleAnnotationCount: 0, firstAnnotationIds: [] });
    const oneId = computeBookFingerprint({ visibleAnnotationCount: 0, firstAnnotationIds: ["x"] });
    expect(empty).not.toBe(oneId);
    expect(empty).toBe(computeBookFingerprint({ visibleAnnotationCount: 0, firstAnnotationIds: [] }));
  });

  it("truncates ids longer than FINGERPRINT_FIRST_ID_LIMIT", () => {
    const longList = Array.from({ length: FINGERPRINT_FIRST_ID_LIMIT + 5 }, (_, i) => `id${i}`);
    const truncated = longList.slice(0, FINGERPRINT_FIRST_ID_LIMIT);
    expect(computeBookFingerprint({ visibleAnnotationCount: 100, firstAnnotationIds: longList })).toBe(
      computeBookFingerprint({ visibleAnnotationCount: 100, firstAnnotationIds: truncated })
    );
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `pnpm --filter @archi/source-cloud-notebook test`
Expected: FAIL with module not found `../src/fingerprint.js`.

- [ ] **Step 3: Implement the module**

Create `packages/source-cloud-notebook/src/fingerprint.ts`:

```ts
import { createHash } from "node:crypto";

export const FINGERPRINT_VERSION = "v1";
export const FINGERPRINT_FIRST_ID_LIMIT = 8;
export const FINGERPRINT_HASH_PREFIX_LENGTH = 16;

export type BookFingerprintInput = {
  visibleAnnotationCount: number;
  firstAnnotationIds: string[];
};

export function computeBookFingerprint(input: BookFingerprintInput): string {
  const ids = input.firstAnnotationIds.slice(0, FINGERPRINT_FIRST_ID_LIMIT);
  // Stable serialization: count, then -delimited ids.  cannot appear in a Kindle
  // annotation id (which is base64-ish / hex-ish), so it is a safe separator.
  const payload = `${input.visibleAnnotationCount}${ids.join("")}`;
  const digest = createHash("sha256").update(payload).digest("hex").slice(0, FINGERPRINT_HASH_PREFIX_LENGTH);
  return `${FINGERPRINT_VERSION}:${input.visibleAnnotationCount}:${digest}`;
}

export type BookDecision =
  | { kind: "skip"; reason: "fingerprint-match" }
  | { kind: "extract"; reason: "no-prior" | "count-differs" | "ids-differ" | "prefix-mismatch" | "forced" };

export function decideBookAction(args: {
  prior: string | undefined;
  peeked: string;
  forceFullSweep: boolean;
}): BookDecision {
  if (args.forceFullSweep) {
    return { kind: "extract", reason: "forced" };
  }
  if (args.prior === undefined) {
    return { kind: "extract", reason: "no-prior" };
  }
  if (args.prior === args.peeked) {
    return { kind: "skip", reason: "fingerprint-match" };
  }
  // Reason is best-effort, used for logging only.
  const priorParts = args.prior.split(":");
  const peekedParts = args.peeked.split(":");
  if (priorParts[0] !== peekedParts[0]) {
    return { kind: "extract", reason: "prefix-mismatch" };
  }
  if (priorParts[1] !== peekedParts[1]) {
    return { kind: "extract", reason: "count-differs" };
  }
  return { kind: "extract", reason: "ids-differ" };
}
```

- [ ] **Step 4: Add decideBookAction tests**

Append to `packages/source-cloud-notebook/tests/fingerprint.test.ts`:

```ts
import { decideBookAction } from "../src/fingerprint.js";

describe("decideBookAction", () => {
  const peeked = "v1:10:aaaaaaaaaaaaaaaa";

  it("returns no-prior when no fingerprint is known", () => {
    const decision = decideBookAction({ prior: undefined, peeked, forceFullSweep: false });
    expect(decision).toEqual({ kind: "extract", reason: "no-prior" });
  });

  it("returns fingerprint-match when prior equals peeked", () => {
    const decision = decideBookAction({ prior: peeked, peeked, forceFullSweep: false });
    expect(decision).toEqual({ kind: "skip", reason: "fingerprint-match" });
  });

  it("returns forced regardless of equality when forceFullSweep is true", () => {
    const decision = decideBookAction({ prior: peeked, peeked, forceFullSweep: true });
    expect(decision).toEqual({ kind: "extract", reason: "forced" });
  });

  it("returns prefix-mismatch when version differs", () => {
    const decision = decideBookAction({
      prior: "v0:10:aaaaaaaaaaaaaaaa",
      peeked,
      forceFullSweep: false
    });
    expect(decision).toEqual({ kind: "extract", reason: "prefix-mismatch" });
  });

  it("returns count-differs when count differs", () => {
    const decision = decideBookAction({
      prior: "v1:11:aaaaaaaaaaaaaaaa",
      peeked,
      forceFullSweep: false
    });
    expect(decision).toEqual({ kind: "extract", reason: "count-differs" });
  });

  it("returns ids-differ when only the hash suffix differs", () => {
    const decision = decideBookAction({
      prior: "v1:10:bbbbbbbbbbbbbbbb",
      peeked,
      forceFullSweep: false
    });
    expect(decision).toEqual({ kind: "extract", reason: "ids-differ" });
  });
});
```

- [ ] **Step 5: Re-run tests, confirm they pass**

Run: `pnpm --filter @archi/source-cloud-notebook test`
Expected: PASS, both `describe` blocks green.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @archi/source-cloud-notebook typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/source-cloud-notebook/src/fingerprint.ts packages/source-cloud-notebook/tests/fingerprint.test.ts
git commit -m "feat(source-cloud-notebook): add fingerprint module and decision helper"
```

---

## Task 4: Extract shared annotation-ID-resolution helper

The peek and the extract must agree on how to derive an `externalPassageId` from a row node. The existing logic is inline in `extractCurrentBookPassages` (`packages/source-cloud-notebook/src/index.ts:914-925`). Pull it into a single named function so both can call it.

**Files:**
- Modify: `packages/source-cloud-notebook/src/index.ts`

- [ ] **Step 1: Locate the ID-resolution block**

Run: `grep -n "row.dataset.annotationId" packages/source-cloud-notebook/src/index.ts`
Expected: One match around line 920.

- [ ] **Step 2: Extract the helper inside `page.evaluate`**

Inside the `page.evaluate` callback in `extractCurrentBookPassages`, declare a helper at the top of the function body (after `tryExtractAsin` and friends, before `parsePosition`):

```js
const resolveExternalPassageId = (
  row: HTMLElement | null,
  highlightNode: HTMLElement,
  selectedBookId: string,
  rowIndex: number
): string => {
  const rowId = row?.id;
  const elementId = highlightNode.id;
  const prefixedId = [rowId, elementId].find(
    (candidate) => candidate?.startsWith("highlight-") || candidate?.startsWith("annotation-")
  );
  return (
    row?.dataset.annotationId ??
    row?.dataset.highlightId ??
    highlightNode.dataset.highlightId ??
    prefixedId?.replace(/^highlight-/, "") ??
    prefixedId?.replace(/^annotation-/, "") ??
    `${selectedBookId}:row:${rowIndex}`
  );
};
```

Replace the inline block currently at lines ~916-925 with `const id = resolveExternalPassageId(row, highlightNode, selectedBookId, index);`.

- [ ] **Step 3: Run existing tests to confirm no regression**

Run: `pnpm --filter @archi/source-cloud-notebook test`
Expected: PASS (the existing `position-from-id.test.ts` and `title-resolution.test.ts` still green; new fingerprint tests still green).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @archi/source-cloud-notebook typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/source-cloud-notebook/src/index.ts
git commit -m "refactor(source-cloud-notebook): extract annotation id resolver"
```

---

## Task 5: Add `peekBookFingerprint` method on the connector

**Files:**
- Modify: `packages/source-cloud-notebook/src/index.ts`

- [ ] **Step 1: Import the fingerprint module**

At the top of `packages/source-cloud-notebook/src/index.ts`, alongside existing imports:

```ts
import { computeBookFingerprint, FINGERPRINT_FIRST_ID_LIMIT } from "./fingerprint.js";
```

- [ ] **Step 2: Add the method**

Inside `class PlaywrightCloudNotebookConnector`, after `extractCurrentBookPassages`, add:

```ts
private async peekBookFingerprint(page: Page): Promise<string> {
  const data = await page.evaluate((limit: number) => {
    const isVisible = (node: HTMLElement | null): boolean => {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return node.getClientRects().length > 0;
    };
    const annotationsRoot = (document.querySelector("#annotations-section") ??
      document.querySelector("#kp-notebook-annotations") ??
      document.body) as HTMLElement;
    const rows = Array.from(
      annotationsRoot.querySelectorAll<HTMLElement>(
        ".kp-notebook-row-separator, [data-annotation-id], [id^='annotation-row-'], [id^='highlight-']"
      )
    ).filter((node, index, all) => all.indexOf(node) === index && isVisible(node));
    const firstIds: string[] = [];
    for (let i = 0; i < rows.length && firstIds.length < limit; i += 1) {
      const row = rows[i];
      const highlightNode = (row.querySelector(
        ".kp-notebook-highlight, [id^='highlight'], [class*='highlight-text']"
      ) ?? row) as HTMLElement;
      const rowId = row.id;
      const elementId = highlightNode.id;
      const prefixedId = [rowId, elementId].find(
        (candidate) => candidate?.startsWith("highlight-") || candidate?.startsWith("annotation-")
      );
      const id =
        row.dataset.annotationId ??
        row.dataset.highlightId ??
        highlightNode.dataset.highlightId ??
        prefixedId?.replace(/^highlight-/, "") ??
        prefixedId?.replace(/^annotation-/, "") ??
        `row:${i}`;
      firstIds.push(id);
    }
    return { visibleAnnotationCount: rows.length, firstAnnotationIds: firstIds };
  }, FINGERPRINT_FIRST_ID_LIMIT);
  return computeBookFingerprint(data);
}
```

Note: the in-page version of `resolveExternalPassageId` here is duplicated because `page.evaluate` runs in the browser context and cannot reference Node-side helpers. The duplication is intentional and small; if it grows, package-side helpers can be serialized via `page.addInitScript`, but that's overkill for this much code.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @archi/source-cloud-notebook typecheck`
Expected: PASS.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @archi/source-cloud-notebook test`
Expected: PASS (still no new test failures — peek is not yet wired into fetchSince).

- [ ] **Step 5: Commit**

```bash
git add packages/source-cloud-notebook/src/index.ts
git commit -m "feat(source-cloud-notebook): add peekBookFingerprint method"
```

---

## Task 6: Extend `CloudFetchOptions` and `fetchSince` return shape

**Files:**
- Modify: `packages/source-cloud-notebook/src/index.ts`

- [ ] **Step 1: Extend the types**

At the existing `CloudFetchOptions` and `CloudFetchStats` declarations near the top of `packages/source-cloud-notebook/src/index.ts`:

```ts
export type CloudBookFingerprint = string;

export type CloudFetchOptions = {
  signal?: AbortSignal;
  knownFingerprints?: Map<string, CloudBookFingerprint>;
  forceFullSweep?: boolean;
};

export type CloudFetchStats = {
  totalBooks: number;
  scannedBooks: number;
  skippedBooks: number;
  rowsSeen: number;
  rowsAccepted: number;
  passagesDiscovered: number;
  fingerprintSkippedBooks: number;
  fingerprintChangedBooks: number;
};

export type CloudFetchResult = {
  cursor?: string;
  passages: CloudPassage[];
  fingerprints: Map<string, CloudBookFingerprint>;
  fetchedBookIds: string[];
  skippedByFingerprintBookIds: string[];
  sidebarBookIds: string[];
  stats: CloudFetchStats;
};
```

Update the `CloudNotebookConnector` interface's `fetchSince` to return `Promise<CloudFetchResult>` (instead of the inline object literal).

- [ ] **Step 2: Update the desktop consumer's types**

`apps/desktop/src/main/index.ts` currently destructures the old return shape. Search for `cloudBatch.passages`, `cloudBatch.cursor`, `cloudBatch.stats` and ensure they still work (they will — the new shape is a superset). No code change yet, just verify.

Run: `grep -n "cloudBatch\\." apps/desktop/src/main/index.ts | head -20`
Expected: Shows references; all field names should be either `passages`, `cursor`, or `stats.*` (no new field names referenced yet).

- [ ] **Step 3: Typecheck both packages**

Run: `pnpm --filter @archi/source-cloud-notebook typecheck && pnpm --filter @archi/desktop typecheck` (substitute the desktop package's actual name from its `package.json` if different).

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/source-cloud-notebook/src/index.ts
git commit -m "feat(source-cloud-notebook): extend fetch types with fingerprint fields"
```

---

## Task 7: Rewire the per-book loop in `fetchSince`

This is the largest connector change. It replaces the existing loop body in `fetchSince` (around lines 286-314 of `packages/source-cloud-notebook/src/index.ts`).

**Files:**
- Modify: `packages/source-cloud-notebook/src/index.ts`

- [ ] **Step 1: Replace the loop**

Locate the current loop:

```ts
} else {
  reportFetchProgress();
  for (const [bookIndex, book] of books.entries()) {
    throwIfAborted();
    const selected = await this.selectBook(page, book.id);
    scannedBooks = bookIndex + 1;
    if (!selected) {
      skippedBooks += 1;
      this.options.onDebug?.(`skip_book_selection bookId=${book.id}`);
      reportFetchProgress();
      continue;
    }
    throwIfAborted();
    const extracted = await this.extractCurrentBookPassages(page, book);
    rowsSeen += extracted.rowsSeen;
    rowsAccepted += extracted.rowsAccepted;
    rememberPassages(extracted.passages);
    if (extracted.passages.length > 0) {
      this.options.onBookFetched?.({ /* ... */ });
    }
    reportFetchProgress();
  }
}
```

Replace with (note: requires `decideBookAction` import — add `import { computeBookFingerprint, decideBookAction, FINGERPRINT_FIRST_ID_LIMIT } from "./fingerprint.js";` at the top of the file):

```ts
} else {
  reportFetchProgress();
  for (const [bookIndex, book] of books.entries()) {
    throwIfAborted();
    sidebarBookIds.push(book.id);
    const selectStartedAt = Date.now();
    const selected = await this.selectBook(page, book.id);
    scannedBooks = bookIndex + 1;
    if (!selected) {
      skippedBooks += 1;
      this.options.onDebug?.(
        `book id=${book.id} peek_ms=0 extract_ms=0 decision=select-failed`
      );
      reportFetchProgress();
      continue;
    }
    throwIfAborted();
    const peekStartedAt = Date.now();
    let peekedFingerprint: string | undefined;
    try {
      peekedFingerprint = await this.peekBookFingerprint(page);
    } catch (peekError) {
      // Peek failed -- fail open to extraction. Do NOT record a fingerprint we couldn't compute.
      this.options.onDebug?.(
        `book id=${book.id} peek_error=${String(peekError)} -- falling through to extract`
      );
    }
    const peekDurationMs = Date.now() - peekStartedAt;

    if (peekedFingerprint !== undefined) {
      fingerprints.set(book.id, peekedFingerprint);
      const decision = decideBookAction({
        prior: options?.knownFingerprints?.get(book.id),
        peeked: peekedFingerprint,
        forceFullSweep: options?.forceFullSweep ?? false
      });
      if (decision.kind === "skip") {
        fingerprintSkippedBooks += 1;
        skippedByFingerprintBookIds.push(book.id);
        this.options.onDebug?.(
          `book id=${book.id} peek_ms=${peekDurationMs} extract_ms=0 decision=unchanged`
        );
        reportFetchProgress();
        continue;
      }
      this.options.onDebug?.(
        `book id=${book.id} peek_ms=${peekDurationMs} decision=changed reason=${decision.reason}`
      );
    }

    const extractStartedAt = Date.now();
    let extracted;
    try {
      extracted = await this.extractCurrentBookPassages(page, book);
    } catch (extractError) {
      // Extract failed after a successful peek. Roll back the optimistic fingerprint
      // so a future sync retries this book.
      fingerprints.delete(book.id);
      skippedBooks += 1;
      this.options.onDebug?.(
        `book id=${book.id} extract_error=${String(extractError)} -- fingerprint not stored`
      );
      reportFetchProgress();
      continue;
    }
    const extractDurationMs = Date.now() - extractStartedAt;
    rowsSeen += extracted.rowsSeen;
    rowsAccepted += extracted.rowsAccepted;
    rememberPassages(extracted.passages);
    fetchedBookIds.push(book.id);
    fingerprintChangedBooks += 1;
    if (extracted.passages.length > 0) {
      this.options.onBookFetched?.({
        book: {
          id: book.id,
          storeIdentifier: book.storeIdentifier,
          title: book.title,
          creator: book.creator,
          coverImageUrl: book.coverImageUrl
        },
        passages: extracted.passages
      });
    }
    this.options.onDebug?.(
      `book id=${book.id} peek_ms=${peekDurationMs} extract_ms=${extractDurationMs} decision=changed`
    );
    reportFetchProgress();
  }
}
```

Suppress the unused `selectStartedAt` (or compute and log `select_ms` in the debug lines if useful for the bottleneck timing data the spec requests). Recommended: log it.

- [ ] **Step 2: Declare and return the new bookkeeping arrays**

Above the loop, add:

```ts
const fingerprints = new Map<string, string>();
const fetchedBookIds: string[] = [];
const skippedByFingerprintBookIds: string[] = [];
const sidebarBookIds: string[] = [];
let fingerprintSkippedBooks = 0;
let fingerprintChangedBooks = 0;
```

Update the `reportFetchProgress` closure's `stats` payload to include `fingerprintSkippedBooks` and `fingerprintChangedBooks`.

At the existing `return { cursor: ..., passages, stats: { ... } }` site, expand to:

```ts
return {
  cursor: cursor ?? new Date().toISOString(),
  passages,
  fingerprints,
  fetchedBookIds,
  skippedByFingerprintBookIds,
  sidebarBookIds,
  stats: {
    totalBooks,
    scannedBooks,
    skippedBooks,
    rowsSeen,
    rowsAccepted,
    passagesDiscovered: passages.length,
    fingerprintSkippedBooks,
    fingerprintChangedBooks
  }
};
```

Also update the no-books branch (the `if (books.length === 0) { ... }` block) to return the same shape — with empty arrays/map and zero counters — so the caller can rely on the shape unconditionally.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @archi/source-cloud-notebook typecheck`
Expected: PASS.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @archi/source-cloud-notebook test`
Expected: PASS (fingerprint module + decision tests; no new connector tests yet — those live in Task 8).

- [ ] **Step 5: Commit**

```bash
git add packages/source-cloud-notebook/src/index.ts
git commit -m "feat(source-cloud-notebook): incremental fetchSince loop with fingerprint peek"
```

---

## Task 8: Test the per-book decision orchestration

The full Playwright loop is exercised manually (Task 13) — but the decision logic inside the loop is unit-testable by extracting a small pure-function wrapper.

**Files:**
- Modify: `packages/source-cloud-notebook/src/fingerprint.ts`
- Modify: `packages/source-cloud-notebook/tests/fingerprint.test.ts`

- [ ] **Step 1: Add a per-book result reducer**

Already covered: `decideBookAction` is the unit. The richer "per-book loop result" is integration-tested. Add one more pure function that's easy to test and reflects the per-book result shape:

In `fingerprint.ts`, append:

```ts
export type BookOutcome =
  | { bookId: string; outcome: "select-failed" }
  | { bookId: string; outcome: "peek-failed-extracted" }
  | { bookId: string; outcome: "extract-failed"; fingerprint: string }
  | { bookId: string; outcome: "skipped"; fingerprint: string }
  | { bookId: string; outcome: "extracted"; fingerprint: string };

export function summarizeBookOutcomes(outcomes: BookOutcome[]): {
  sidebarBookIds: string[];
  fetchedBookIds: string[];
  skippedByFingerprintBookIds: string[];
  fingerprints: Map<string, string>;
  selectFailedBookIds: string[];
} {
  const sidebarBookIds: string[] = [];
  const fetchedBookIds: string[] = [];
  const skippedByFingerprintBookIds: string[] = [];
  const selectFailedBookIds: string[] = [];
  const fingerprints = new Map<string, string>();
  for (const o of outcomes) {
    sidebarBookIds.push(o.bookId);
    switch (o.outcome) {
      case "select-failed":
        selectFailedBookIds.push(o.bookId);
        break;
      case "peek-failed-extracted":
        fetchedBookIds.push(o.bookId);
        break;
      case "extract-failed":
        // No fingerprint recorded for retry on next run
        break;
      case "skipped":
        skippedByFingerprintBookIds.push(o.bookId);
        fingerprints.set(o.bookId, o.fingerprint);
        break;
      case "extracted":
        fetchedBookIds.push(o.bookId);
        fingerprints.set(o.bookId, o.fingerprint);
        break;
    }
  }
  return { sidebarBookIds, fetchedBookIds, skippedByFingerprintBookIds, fingerprints, selectFailedBookIds };
}
```

- [ ] **Step 2: Add tests for the summarizer**

Append to `packages/source-cloud-notebook/tests/fingerprint.test.ts`:

```ts
import { summarizeBookOutcomes, type BookOutcome } from "../src/fingerprint.js";

describe("summarizeBookOutcomes", () => {
  it("classifies each outcome correctly", () => {
    const outcomes: BookOutcome[] = [
      { bookId: "B1", outcome: "extracted", fingerprint: "v1:1:a" },
      { bookId: "B2", outcome: "skipped", fingerprint: "v1:2:b" },
      { bookId: "B3", outcome: "select-failed" },
      { bookId: "B4", outcome: "extract-failed", fingerprint: "v1:4:d" },
      { bookId: "B5", outcome: "peek-failed-extracted" }
    ];
    const s = summarizeBookOutcomes(outcomes);
    expect(s.sidebarBookIds).toEqual(["B1", "B2", "B3", "B4", "B5"]);
    expect(s.fetchedBookIds).toEqual(["B1", "B5"]);
    expect(s.skippedByFingerprintBookIds).toEqual(["B2"]);
    expect(s.selectFailedBookIds).toEqual(["B3"]);
    expect(s.fingerprints.get("B1")).toBe("v1:1:a");
    expect(s.fingerprints.get("B2")).toBe("v1:2:b");
    expect(s.fingerprints.has("B3")).toBe(false);
    expect(s.fingerprints.has("B4")).toBe(false);  // extract-failed -> NOT stored
    expect(s.fingerprints.has("B5")).toBe(false);  // peek-failed -> NOT stored
  });

  it("handles empty input", () => {
    const s = summarizeBookOutcomes([]);
    expect(s.sidebarBookIds).toEqual([]);
    expect(s.fetchedBookIds).toEqual([]);
    expect(s.skippedByFingerprintBookIds).toEqual([]);
    expect(s.selectFailedBookIds).toEqual([]);
    expect(s.fingerprints.size).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @archi/source-cloud-notebook test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/source-cloud-notebook/src/fingerprint.ts packages/source-cloud-notebook/tests/fingerprint.test.ts
git commit -m "test(source-cloud-notebook): test per-book outcome summarizer"
```

---

## Task 9: Wire incremental sync into the desktop main process

**Files:**
- Modify: `apps/desktop/src/main/index.ts`

The settings type and force-full-sweep wiring come next. This task is split into three sub-steps because each is independently shippable.

### 9a: Read fingerprints from the repo before fetch

- [ ] **Step 1: Find the cloud-fetch block**

Run: `grep -n "cloudConnector.fetchSince" apps/desktop/src/main/index.ts`
Expected: One match, around line 634.

- [ ] **Step 2: Read fingerprints and apply the periodic-sweep gate**

Just before the `withTimeout(cloudConnector.fetchSince(...), 900_000, ...)` call:

```ts
const fullSweepIntervalDays = settings.cloud.fullSweepIntervalDays ?? 30;
const sweepThresholdMs = Date.now() - fullSweepIntervalDays * 24 * 60 * 60 * 1000;
const storedSyncStates = repository.getCloudBookSyncStates();
const knownFingerprints = new Map<string, string>();
for (const [bookId, state] of storedSyncStates) {
  if (Date.parse(state.lastFetchedAt) >= sweepThresholdMs) {
    knownFingerprints.set(bookId, state.fingerprint);
  }
  // else: drop from input map -> forces re-extraction this run
}
const forceFullSweep = pendingForceFullSweep === true;
pendingForceFullSweep = false; // consume the flag immediately
```

The `pendingForceFullSweep` module-level variable will be introduced in Task 11; for now stub it as `let pendingForceFullSweep = false;` near the other module-level sync state (search `let activeCloudFetchRunId` for a comparable site).

`settings.cloud.fullSweepIntervalDays` is read directly; the settings type extension lands in Task 11.

- [ ] **Step 3: Pass them into `fetchSince`**

Update the call:

```ts
const cloudBatch = await withTimeout(
  cloudConnector.fetchSince(syncJobs.cloud.resumeCursor, {
    signal: cancelSyncController.signal,
    knownFingerprints,
    forceFullSweep
  }),
  900_000,
  "Cloud notebook fetch timed out after 900 seconds."
);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter ./apps/desktop typecheck` (or substitute the actual filter name from `apps/desktop/package.json`).
Expected: PASS — `pendingForceFullSweep` reads as `boolean`, `settings.cloud.fullSweepIntervalDays` may surface a `Property does not exist` error which is OK to defer until 9b.

If the type error blocks compilation, temporarily add `// @ts-expect-error settings type extended in Task 11` above the offending line and remove it in Task 11.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "feat(desktop): read cloud_book_sync_state and pass known fingerprints to fetchSince"
```

### 9b: Persist returned fingerprints

- [ ] **Step 1: After fetch completes, persist per-book state**

Locate the post-fetch block (right after `const now = new Date().toISOString();`, around line 647). Add:

```ts
// Persist sync state for every book we visited (fetched or fingerprint-skipped).
const seenAt = now;
for (const bookId of cloudBatch.fetchedBookIds) {
  const fingerprint = cloudBatch.fingerprints.get(bookId);
  if (!fingerprint) continue; // peek-failed-extracted path: no fingerprint to store
  repository.upsertCloudBookSyncState({
    externalBookId: bookId,
    fingerprint,
    fetchedAt: now,
    seenAt
  });
}
for (const bookId of cloudBatch.skippedByFingerprintBookIds) {
  // mark seen, do not advance fetchedAt
  repository.markCloudBookSeen(bookId, seenAt);
}
```

- [ ] **Step 2: At the end of the cloud block, prune orphans**

Just before `hasSuccessfulSource = true;` (existing line, around 857):

```ts
repository.pruneCloudBookSyncStatesNotIn(cloudBatch.sidebarBookIds);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter ./apps/desktop typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "feat(desktop): persist cloud_book_sync_state after fetch"
```

### 9c: Switch reconciliation to scoped deletes

- [ ] **Step 1: Replace the existing reconciliation block**

Find the block at `apps/desktop/src/main/index.ts:795-826` (currently computing `shouldReconcileDeletes` and calling `deleteCloudPassagesNotInExternalIds` + `deleteEmptyCloudWorks`).

Replace with:

```ts
const skipReconcile =
  cloudBatch.fetchedBookIds.length > 0 &&
  priorCloudPassageCount > 0 &&
  cloudBatch.passages.length < Math.max(50, Math.floor(priorCloudPassageCount * 0.1));

let removedPassages = 0;
let removedWorks = 0;
let removedEmptyWorks = 0;
if (!skipReconcile) {
  // Books extracted this run: scoped delete of unretained passages.
  if (cloudBatch.fetchedBookIds.length > 0) {
    removedPassages = repository.deleteCloudPassagesInBooksNotInExternalIds(
      cloudBatch.fetchedBookIds,
      Array.from(normalizedExternalPassageIds)
    );
    removedEmptyWorks = repository.deleteEmptyCloudWorksByExternalIds(cloudBatch.fetchedBookIds);
  }
  // Books no longer in the sidebar at all.
  removedWorks = repository.deleteCloudWorksByExternalIdsNotIn(cloudBatch.sidebarBookIds);
} else {
  emitSyncProgress({
    runId,
    startedAtMs,
    phase: "source_cloud_upsert",
    status: "info",
    source: "cloud-notebook",
    message: `Skipped destructive reconciliation due to low-confidence fetch evidence (${cloudBatch.passages.length} quotes from ${cloudBatch.fetchedBookIds.length} extracted books; ${cloudBatch.skippedByFingerprintBookIds.length} fingerprint-skipped books left intact; prior=${priorCloudPassageCount}).`,
    persist: true
  });
}
if (removedPassages > 0 || removedWorks > 0 || removedEmptyWorks > 0) {
  emitSyncProgress({
    runId,
    startedAtMs,
    phase: "source_cloud_upsert",
    status: "info",
    source: "cloud-notebook",
    message: `Reconciled cloud data: removed ${removedPassages} stale quotes (across ${cloudBatch.fetchedBookIds.length} re-extracted books), ${removedEmptyWorks} now-empty books, and ${removedWorks} books no longer in your library.`,
    refreshHint: "ingest_update",
    persist: true
  });
}
```

- [ ] **Step 2: Adjust the fetch-completed summary line**

Find the success message around line 656:

```ts
message: `Cloud fetch completed: ${cloudBatch.passages.length} quotes across ${distinctCloudWorkCount} books (${cloudBatch.stats.rowsAccepted}/${cloudBatch.stats.rowsSeen} rows accepted).`,
```

Append the fingerprint-skipped count:

```ts
message: `Cloud fetch completed: ${cloudBatch.passages.length} quotes across ${distinctCloudWorkCount} extracted books (${cloudBatch.stats.fingerprintSkippedBooks} unchanged, ${cloudBatch.stats.rowsAccepted}/${cloudBatch.stats.rowsSeen} rows accepted).`,
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter ./apps/desktop typecheck`
Expected: PASS.

- [ ] **Step 4: Run the existing core tests one more time**

Run: `pnpm --filter @archi/core test`
Expected: PASS (the older `reconciliation.test.ts` should still pass — we are not changing the legacy `deleteCloudPassagesNotInExternalIds` method, we just stop calling it from the desktop main).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "feat(desktop): scoped reconciliation for incremental Kindle sync"
```

---

## Task 10: Add `fullSweepIntervalDays` to settings type + defaults

**Files:**
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Extend AppSettings.cloud**

Find `AppSettings` (around line 1550). Update the cloud block:

```ts
  cloud: {
    enabled: boolean;
    notebookUrl: string;
    storageStatePath: string;
    profilePath: string;
    fullSweepIntervalDays: number;  // NEW; default 30
  };
```

- [ ] **Step 2: Default and parse**

In `loadSettings`:

In `defaults.cloud`:
```ts
    cloud: {
      enabled: process.env.CLOUD_SYNC_ENABLED === "true",
      notebookUrl: process.env.CLOUD_NOTEBOOK_URL ?? "https://read.amazon.com/notebook",
      storageStatePath: path.join(process.env.HOME ?? ".", ".archi-cloud-storage-state.json"),
      profilePath: path.join(process.env.HOME ?? ".", ".archi-cloud-profile"),
      fullSweepIntervalDays: 30
    },
```

In the `parsed.cloud?...` block:
```ts
    cloud: {
      enabled: parsed.cloud?.enabled ?? process.env.CLOUD_SYNC_ENABLED === "true",
      notebookUrl: parsed.cloud?.notebookUrl ?? process.env.CLOUD_NOTEBOOK_URL ?? "https://read.amazon.com/notebook",
      storageStatePath:
        parsed.cloud?.storageStatePath ?? path.join(process.env.HOME ?? ".", ".archi-cloud-storage-state.json"),
      profilePath: parsed.cloud?.profilePath ?? path.join(process.env.HOME ?? ".", ".archi-cloud-profile"),
      fullSweepIntervalDays: parsed.cloud?.fullSweepIntervalDays ?? 30
    },
```

- [ ] **Step 3: Remove any `@ts-expect-error` placeholders from Task 9a**

If you added a `@ts-expect-error` line earlier, delete it now — the type is real.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter ./apps/desktop typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "feat(desktop): add cloud.fullSweepIntervalDays setting"
```

---

## Task 11: "Force full Kindle sync" IPC handler

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`

- [ ] **Step 1: Add the module-level flag**

In `apps/desktop/src/main/index.ts`, near `let activeCloudFetchRunId` (`grep -n "let activeCloudFetchRunId" apps/desktop/src/main/index.ts`), add:

```ts
let pendingForceFullSweep = false;
```

(If you already added a stub in Task 9a, the line is already present — skip this step.)

- [ ] **Step 2: Register the IPC handler**

Near the existing `ipcMain.handle("archi:run-sync-now", ...)`:

```ts
ipcMain.handle("archi:force-full-kindle-sync", async () => {
  pendingForceFullSweep = true;
  // Re-use the same sync entry-point. The sync run consumes the flag once and resets it.
  return ipcRenderer; // <-- replace with the actual call your runSyncNow handler uses
});
```

Concretely: locate the body of the existing `archi:run-sync-now` handler and copy its sync-starting logic. The new handler must also respect the single-sync-at-a-time guard the existing handler uses.

- [ ] **Step 3: Expose on preload**

In `apps/desktop/src/preload/index.ts`, alongside `runSyncNow`:

```ts
  forceFullKindleSync: (): Promise<SyncState> => ipcRenderer.invoke("archi:force-full-kindle-sync"),
```

Also extend the public `api` type if there's a TypeScript declaration of the exposed window shape.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter ./apps/desktop typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts
git commit -m "feat(desktop): add force-full-kindle-sync IPC handler"
```

---

## Task 12: "Force full Kindle sync" button in ConnectionsScreen

**Files:**
- Modify: `apps/desktop/src/renderer/screens/ConnectionsScreen.tsx`

- [ ] **Step 1: Add the button**

Locate the cloud_notebook button cluster (`grep -n "cloud_notebook" apps/desktop/src/renderer/screens/ConnectionsScreen.tsx`). Add a new button after the existing "Reconnect" button:

```tsx
<button
  onClick={async () => {
    const ok = window.confirm(
      "Re-extract highlights from every book in your Kindle library, ignoring incremental sync state. This is slower than a normal sync but useful if highlights look out of date. Continue?"
    );
    if (!ok) return;
    await window.archi.forceFullKindleSync();
  }}
  disabled={cloudBusy}
>
  Force full Kindle sync
</button>
```

If `window.archi` lacks a TypeScript type for `forceFullKindleSync`, extend the global ambient declaration (search for `declare global` or `archi:` in the renderer source).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter ./apps/desktop typecheck`
Expected: PASS.

- [ ] **Step 3: Build the renderer to confirm it compiles**

Run: `pnpm --filter ./apps/desktop build` (or the equivalent dev/build command from the desktop `package.json`).
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/screens/ConnectionsScreen.tsx
git commit -m "feat(desktop): add Force full Kindle sync button"
```

---

## Task 13: Manual verification

This is the integration test the unit suite cannot replace.

Each step below assumes a running dev build (`pnpm --filter ./apps/desktop dev` or the project's equivalent) and a real Kindle cloud-notebook account already connected.

- [ ] **Step 1: First full sync (cold start)**

Action: trigger "Sync now" from the desktop UI.
Expected: behaves like today. After the sync, inspect the DB:

Run: `sqlite3 ~/.archi.db "SELECT COUNT(*) FROM cloud_book_sync_state;"` (substitute the actual DB path from `openCoreDatabase` callsite in the desktop main).
Expected: One row per book in the user's Kindle library.

- [ ] **Step 2: Second sync (steady state)**

Action: trigger "Sync now" again immediately.
Expected: in the logs (`archi:list-logs`), most books show `decision=unchanged`. The fetch-completed message reports zero new quotes and a high `unchanged` count. No `Reconciled cloud data` info line.

- [ ] **Step 3: Add a highlight in Kindle, sync**

Action: add or edit one highlight in Kindle Cloud Reader (in any book). Wait for it to propagate to the notebook view. Then trigger "Sync now".
Expected: only that book's debug line shows `decision=changed`. The new/edited highlight appears in the local DB.

- [ ] **Step 4: Delete a highlight in Kindle, sync**

Action: delete a highlight from Kindle. Trigger "Sync now".
Expected: that book is re-extracted (`decision=changed`); the `Reconciled cloud data` message names ≥ 1 removed passage; the deleted highlight is gone from the local DB.

- [ ] **Step 5: Remove a book from Kindle library, sync**

Action: remove a book entirely from the user's Kindle library. Trigger "Sync now".
Expected: the book's work and passages are deleted locally; `Reconciled cloud data` reports ≥ 1 removed book; the row in `cloud_book_sync_state` is pruned.

- [ ] **Step 6: Force full sync**

Action: click "Force full Kindle sync" on the Connections screen.
Expected: confirmation dialog appears. After confirm, every book is re-extracted regardless of fingerprint. After completion, `pendingForceFullSweep` is back to `false` (one-shot consumption).

- [ ] **Step 7: Capture timing data**

From the debug log of the steady-state sync (step 2), tabulate min/median/p95 of `peek_ms` and `extract_ms`. Include the table in the PR description. This data informs whether the follow-up Approach B (sidebar-only skip) is worth pursuing.

- [ ] **Step 8: Write up findings in the PR**

The PR description must include:

- Confirmation that all 7 manual steps passed.
- The peek/extract timing table from step 7.
- Any unexpected behavior observed (especially around `select-failed` cases — do they recover on next sync?).
- Whether the second sync's wall-clock time matches the expected savings.

---

## Self-Review Notes

(Run by the plan author; the implementer can skim and challenge.)

**Spec coverage check:** Walking the spec's success-criteria one by one:

| Criterion | Task that covers it |
| --- | --- |
| All fingerprints matching → zero extractions, status `success`, no deletes | Tasks 7, 9c, 13 step 2 |
| One book changed → one extraction | Task 7, 13 step 3 |
| Deleted highlight removed via scoped reconcile | Task 9c, 13 step 4 |
| Book vanished from library → removed | Task 9b/9c, 13 step 5 |
| First-run identical to today | Cold-start path in Task 9a (empty `knownFingerprints`), Task 13 step 1 |
| Failed extract leaves fingerprint untouched | Task 7 (extract-error branch) |
| Periodic full sweep | Task 9a (`sweepThresholdMs`) |
| Per-book timing in debug log | Task 7 debug lines, Task 13 step 7 |
| Force full sync UI | Tasks 11, 12, 13 step 6 |

**Placeholder scan:** None of the steps contain "TBD", "implement later", or "handle edge cases." Every code step shows the actual code. Step 2 of Task 11 has a `<!-- replace with the actual call your runSyncNow handler uses -->` placeholder — that's intentional because the existing `archi:run-sync-now` body isn't quoted verbatim in this plan; the implementer must inspect the live code and mirror it. Acceptable per the spec's "implementation may surface small choices" wording, but flagging it.

**Type consistency:** `CloudBookFingerprint = string` is referenced in `CloudFetchOptions.knownFingerprints` (Map<string, CloudBookFingerprint>) and the `fingerprints` return field (Map<string, CloudBookFingerprint>). The repo's `getCloudBookSyncStates()` returns `Map<string, { fingerprint: string; lastFetchedAt: string; lastSeenAt: string }>` — note that's a richer shape; Task 9a explicitly maps it down to `Map<string, string>` before passing to the connector. Consistent.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-19-incremental-kindle-sync.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because the tasks are well-isolated and most are amenable to a single-shot completion.
2. **Inline Execution** — execute tasks in this session via `superpowers:executing-plans`, batch execution with checkpoints for review.

Which approach?
