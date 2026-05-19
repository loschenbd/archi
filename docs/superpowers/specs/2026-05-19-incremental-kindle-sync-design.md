# Incremental Kindle sync (peek-before-extract): design

**Date:** 2026-05-19
**Author:** Archi maintainers (drafted via brainstorming session)
**Status:** Draft, awaiting user review before implementation planning
**Scope:** `packages/source-cloud-notebook/src/index.ts`, `packages/source-cloud-notebook/tests/`; `packages/core/src/repositories/coreRepository.ts` and `packages/core/tests/`; `apps/desktop/src/main/index.ts` (sync orchestration + reconciliation); minor `apps/desktop/src/preload/index.ts` and one renderer surface for the "Force full sync" control.

## Problem

Every Kindle cloud-notebook sync walks the full library: select each book in turn via Playwright, wait for the annotations panel to render, scroll/extract every highlight, then upsert. For a library of N books the floor cost is ~N navigations even when nothing has changed since the last sync. The connector exposes `fetchSince(cursor)` already, but the parameter is ignored — every call is a full sweep.

Users with stable libraries pay this cost on every scheduled sync. We want incremental syncs to be cheap when most books are unchanged, without sacrificing correctness for the books that *did* change and without breaking the destructive reconciliation that catches highlight deletions.

## Goals

- A sync where no book has changed produces zero highlight extractions, while still verifying connectivity and library presence.
- A sync where only one book has changed produces one extraction (that book) and leaves the rest untouched.
- A highlight deleted in Kindle is still removed from the local store and from Notion on the next sync of *that* book — incremental sync does not regress deletion handling for fetched books.
- A book removed from a user's Kindle library is removed locally, even though we will never extract it again.
- First-run / cold-start behavior is identical to today's full scrape.
- Per-book timing data is captured automatically, so we can decide whether the dominant cost is `selectBook` or `extractCurrentBookPassages` — and therefore whether a future sidebar-only skip is worth pursuing.

## Success criteria

- A sync run with all fingerprints matching the prior run:
  - Calls `extractCurrentBookPassages` zero times.
  - Returns `status: success` (not `partial_success`, not low-confidence info).
  - Issues no `delete*` calls on the cloud passages table.
- A sync run that finds N books changed and the rest unchanged calls `extractCurrentBookPassages` exactly N times.
- A book whose `external_book_id` no longer appears in the Kindle sidebar has its work row and passages removed by the end of the run.
- A book whose extraction throws does not get its stored fingerprint updated; the next sync retries it as "changed".
- After M consecutive incremental syncs where the same book's fingerprint matched (M tunable; default behavior: any book whose `last_fetched_at` is older than `cloudFullSweepIntervalDays` is force-extracted) the book is re-extracted regardless of fingerprint match.
- Per-book debug log lines include `peek_ms`, `extract_ms` (0 when skipped), and the decision reason. These are emitted via the existing `onDebug` callback; no new log destinations.

## Non-goals

- Sidebar-only skip (Approach B). Deferred until timing data shows extraction time is small relative to selection time, in which case a follow-up spec adds it.
- Within-book early-exit on annotation scroll (Approach C). Deferred for the same reason.
- Changing the destination-side Notion sync, the passage fingerprint hash, or the cross-book identity logic (`toCloudWorkIdentity`). Those remain authoritative.
- Multi-source sync state. The new state table is cloud-specific by name and intent; device-export does not participate.
- Approach to surfacing per-book sync state in the UI beyond a single "Force full sync" button. A richer per-book status view can come later.
- Resuming a partial sync run mid-flight. If the run is cancelled, the books that completed have their fingerprints updated; the rest will be retried on the next run. No checkpoint format beyond per-book commits.

## Approach

Three layered changes: per-book peek/fingerprint inside the connector; per-book sync state in `core`; per-book-scoped reconciliation in the desktop main process.

### 1. Connector: peek before extract

`PlaywrightCloudNotebookConnector.fetchSince` gains an additive option `knownFingerprints` and returns additional fields. No breaking changes.

```ts
export type CloudBookFingerprint = string; // opaque hash, see computeBookFingerprint

export type CloudFetchOptions = {
  signal?: AbortSignal;
  knownFingerprints?: Map<string, CloudBookFingerprint>; // bookId -> fingerprint from prior run
  forceFullSweep?: boolean;                              // ignore all known fingerprints
};

export type CloudFetchStats = {
  totalBooks: number;
  scannedBooks: number;     // unchanged: # of books we entered (peeked or extracted)
  skippedBooks: number;     // unchanged meaning: failed to select; NOT "fingerprint-skipped"
  rowsSeen: number;
  rowsAccepted: number;
  passagesDiscovered: number;
  fingerprintSkippedBooks: number;  // NEW: books we peeked, fingerprint matched, did not extract
  fingerprintChangedBooks: number;  // NEW: books we peeked and then extracted
};

// fetchSince return type extends:
{
  cursor?: string;
  passages: CloudPassage[];
  fingerprints: Map<string, CloudBookFingerprint>; // bookId -> fingerprint, for every visited book
  fetchedBookIds: string[];                        // books we fully extracted this run
  skippedByFingerprintBookIds: string[];           // books we peeked, fingerprint matched
  sidebarBookIds: string[];                        // every book that appeared in the sidebar this run
  stats: CloudFetchStats;
}
```

Note: `skippedByFingerprintBookIds` ⊆ `sidebarBookIds`; `fetchedBookIds` ⊆ `sidebarBookIds`; and `skippedByFingerprintBookIds ∩ fetchedBookIds = ∅`. Books whose select failed appear in `sidebarBookIds` but neither of the other two — they contribute to `stats.skippedBooks`.

#### Per-book loop (inside `fetchSince`)

```
collect sidebar books -> books[]
for book in books:
  if signal.aborted: throw
  sidebarBookIds.push(book.id)                         # before select: presence in
                                                       # the sidebar is what matters,
                                                       # not whether we could enter it
  ok = selectBook(book.id)
  if not ok:
    stats.skippedBooks += 1
    continue
  fingerprint = peekBookFingerprint(page)              # NEW
  fingerprints.set(book.id, fingerprint)
  prior = knownFingerprints?.get(book.id)
  if not forceFullSweep and prior == fingerprint:
    stats.fingerprintSkippedBooks += 1
    skippedByFingerprintBookIds.push(book.id)
    onDebug(`book id=${book.id} peek_ms=${ms} extract_ms=0 decision=unchanged`)
    continue
  extracted = extractCurrentBookPassages(page, book)
  rememberPassages(extracted.passages)
  fetchedBookIds.push(book.id)
  stats.fingerprintChangedBooks += 1
  onBookFetched({ book, passages: extracted.passages })
  onDebug(`book id=${book.id} peek_ms=${ms} extract_ms=${ms2} decision=changed reason=${reason}`)
```

The order matters: `sidebarBookIds` reflects what the user has in their library; `selectBook` failing is a transient extraction problem, not evidence the book is gone. If a book is visible in the sidebar but unselectable today, we want `deleteCloudWorksByExternalIdsNotIn(sidebarBookIds)` to leave it alone, not nuke it.

#### Fingerprint definition

```ts
function computeBookFingerprint(input: {
  visibleAnnotationCount: number;
  firstAnnotationIds: string[];   // first K=8 visible external_passage_ids, in DOM order
}): CloudBookFingerprint {
  // Stable string concat then sha256 hex; format: `v1:<count>:<sha256-prefix-16>`
}
```

- `v1:` prefix is a forward-compat version tag. A future change to fingerprint inputs bumps to `v2:` and invalidates all stored fingerprints automatically (since the prefix won't match).
- `K=8` is documented as a constant; small enough to be in the initial annotations render without forcing a scroll.
- The "reason" for a fingerprint miss is one of: `prefix-mismatch`, `count-differs`, `ids-differ`, or `no-prior` — derived inside the connector for logging only; not persisted.

#### `peekBookFingerprint` implementation

A new private method on `PlaywrightCloudNotebookConnector` running a single `page.evaluate`:

- Query `#annotations-section, #kp-notebook-annotations` (same root as extraction).
- Count `.kp-notebook-row-separator, [data-annotation-id], [id^='annotation-row-'], [id^='highlight-']` nodes filtered through the same `isVisible` helper used by `extractCurrentBookPassages` (computed style + `getClientRects().length > 0`). "Visible" matches the extraction definition exactly so peek and extract see the same set.
- Take the first 8 of those (DOM order). For each, resolve an external_passage_id using the same precedence as `extractCurrentBookPassages` (`data-annotation-id` > `data-highlight-id` > `id` minus `highlight-`/`annotation-` prefix).
- Return `{ visibleAnnotationCount, firstAnnotationIds }`.

This is intentionally a thin subset of `extractCurrentBookPassages` so the two stay in lock-step — when extraction's ID precedence changes, peek's must too. To enforce this, the ID-resolution logic is extracted into a single helper used by both.

### 2. Core: per-book sync state

New SQLite table in `packages/core` migrations:

```sql
CREATE TABLE cloud_book_sync_state (
  external_book_id TEXT PRIMARY KEY,
  fingerprint      TEXT NOT NULL,
  last_fetched_at  TEXT NOT NULL,  -- ISO timestamp of last successful extraction
  last_seen_at     TEXT NOT NULL   -- ISO timestamp of last sidebar appearance
);
```

Kept separate from `works` so source-specific peek state does not bleed into the generic table; a future source connector with its own peek strategy gets its own table.

New methods on `coreRepository.ts`:

```ts
getCloudBookSyncStates(): Map<string, { fingerprint: string; lastFetchedAt: string }>;
upsertCloudBookSyncState(args: {
  externalBookId: string;
  fingerprint: string;
  fetchedAt: string;   // only updated when an extraction actually completed
  seenAt: string;
}): void;
markCloudBookSeen(externalBookId: string, seenAt: string): void;  // bumps last_seen_at only
pruneCloudBookSyncStatesNotIn(seenBookIds: string[]): number;     // drops orphans
```

Semantics:

- `upsertCloudBookSyncState` is called only after a successful extraction-and-upsert for that book. Both timestamps move forward together.
- `markCloudBookSeen` is called for fingerprint-skipped books, so `last_fetched_at` stays at the prior value (used by the periodic full-sweep gate below) but `last_seen_at` reflects current presence.
- `pruneCloudBookSyncStatesNotIn` is called at the end of a successful run with the full `sidebarBookIds` list.

### 3. Main: orchestration + reconciliation

In `apps/desktop/src/main/index.ts` (around the existing cloud-fetch block, currently ~line 602–887):

#### Pre-fetch: assemble known fingerprints, compute sweep flag

```ts
const knownFingerprints = repository.getCloudBookSyncStates();   // Map
const fullSweepIntervalDays = settings.cloud.fullSweepIntervalDays ?? 30;
const sweepThreshold = Date.now() - fullSweepIntervalDays * 24 * 60 * 60 * 1000;

// Books whose last_fetched_at is older than the threshold get their stored
// fingerprint forcibly invalidated -- pass them as missing from the map.
for (const [bookId, state] of knownFingerprints) {
  if (Date.parse(state.lastFetchedAt) < sweepThreshold) {
    knownFingerprints.delete(bookId);
  }
}

const cloudBatch = await withTimeout(
  cloudConnector.fetchSince(syncJobs.cloud.resumeCursor, {
    signal: cancelSyncController.signal,
    knownFingerprints: new Map(
      Array.from(knownFingerprints.entries()).map(([k, v]) => [k, v.fingerprint])
    ),
    forceFullSweep: pendingForceFullSweep,  // see "Force full sync" below
  }),
  900_000,
  "Cloud notebook fetch timed out after 900 seconds."
);
```

#### Post-fetch: persist fingerprints

For each `bookId` in `cloudBatch.fingerprints`:

- If `bookId` is in `cloudBatch.fetchedBookIds`: `upsertCloudBookSyncState({ ... fetchedAt: now, seenAt: now })`.
- Else (it's in `skippedByFingerprintBookIds`): `markCloudBookSeen(bookId, now)`.

Books that failed `selectBook` (in `sidebarBookIds` but not in `fingerprints`) are *not* touched — they keep their last-good state.

At the end, `pruneCloudBookSyncStatesNotIn(cloudBatch.sidebarBookIds)` drops state rows for books that vanished from the user's library.

#### Reconciliation, scoped

Replace the current logic at `apps/desktop/src/main/index.ts:801`:

```ts
// OLD
removedPassages = repository.deleteCloudPassagesNotInExternalIds(Array.from(normalizedExternalPassageIds));
removedWorks = repository.deleteEmptyCloudWorks();
```

with:

```ts
// NEW: only consider books we actually fetched this run
const fetchedBookExternalIds = cloudBatch.fetchedBookIds;
const retainedPassageExternalIds = Array.from(normalizedExternalPassageIds);

removedPassages = repository.deleteCloudPassagesInBooksNotInExternalIds(
  fetchedBookExternalIds,
  retainedPassageExternalIds
);

// Books that disappeared from the sidebar entirely
removedWorks = repository.deleteCloudWorksByExternalIdsNotIn(cloudBatch.sidebarBookIds);

// Empty-cloud-works only for fetched books that returned zero passages
removedEmptyWorks = repository.deleteEmptyCloudWorksByExternalIds(fetchedBookExternalIds);
```

Three new repo methods:

```ts
deleteCloudPassagesInBooksNotInExternalIds(
  bookExternalIds: string[],
  retainedPassageExternalIds: string[]
): number;
// WHERE works.external_id IN (bookExternalIds)
//   AND works.ingest_source = 'cloud-notebook'
//   AND passages.external_passage_id NOT IN (retainedPassageExternalIds)

deleteCloudWorksByExternalIdsNotIn(sidebarBookExternalIds: string[]): number;
// WHERE works.ingest_source = 'cloud-notebook'
//   AND works.external_id NOT IN (sidebarBookExternalIds)
// Cascades to passages via existing FK behavior, or follow-up DELETE in same transaction.

deleteEmptyCloudWorksByExternalIds(bookExternalIds: string[]): number;
// Only deletes works in the given set that have zero passages -- avoids removing books
// we didn't fetch and that legitimately have passages.
```

#### Low-confidence gate, adjusted

Current logic skips destructive reconciliation if the fetch looks low-confidence:

```ts
const skipReconcile =
  priorCloudPassageCount > 0 &&
  cloudBatch.passages.length < Math.max(50, Math.floor(priorCloudPassageCount * 0.1));
```

This needs one fix so an all-skipped incremental run doesn't trip it:

```ts
const skipReconcile =
  cloudBatch.fetchedBookIds.length > 0 &&
  priorCloudPassageCount > 0 &&
  cloudBatch.passages.length < Math.max(50, Math.floor(priorCloudPassageCount * 0.1));
```

i.e., the gate fires only when we *tried* to fetch and got suspiciously little back. A run where every book was fingerprint-skipped (and so `passages.length === 0`) is the *success* case, not low-confidence.

### 4. Force full sync (UI surface)

Add a single control. Reuses the same plumbing pattern as the existing "Refresh Notion media" button described in `2026-05-19-notion-page-media-design.md`.

- **Main process**: `ipcMain.handle("sync.forceFullSync", ...)` sets `pendingForceFullSweep = true` for the next sync run, then triggers the same sync entry-point the existing "Sync now" uses. The flag is consumed and reset by the sync run.
- **Preload**: `archi.sync.forceFullSync(): Promise<...>`.
- **Renderer**: A button labeled **"Force full Kindle sync"** in the Connections screen, with a confirmation dialog: *"Re-extract highlights from every book in your Kindle library, ignoring incremental sync state. This is slower than a normal sync but useful if highlights look out of date. Continue?"*

The setting `cloud.fullSweepIntervalDays` is exposed via `settings` with a default of 30. No UI for this in the first cut; editing it requires modifying settings directly. A future spec may surface it.

## Data flow

```
syncCloudNotebook()
  knownFingerprints = repo.getCloudBookSyncStates()
  apply periodic-sweep aging (drop entries past threshold)
  cloudBatch = connector.fetchSince(cursor, {
    knownFingerprints, forceFullSweep
  })
    for book in sidebar:
      sidebarBookIds.push(book)
      ok = selectBook(book)
      if not ok: stats.skippedBooks += 1; continue
      fp = peekBookFingerprint(page)
      if fp == knownFingerprints[book]:
        skippedByFingerprintBookIds.push(book)
      else:
        passages = extractCurrentBookPassages(page, book)
        rememberPassages(passages)
        fetchedBookIds.push(book)
      fingerprints[book] = fp

  for bookId in cloudBatch.fingerprints:
    if bookId in fetchedBookIds: repo.upsertCloudBookSyncState({..., fetchedAt: now, seenAt: now})
    else:                        repo.markCloudBookSeen(bookId, now)
  repo.pruneCloudBookSyncStatesNotIn(sidebarBookIds)

  upsert all cloudBatch.passages    (unchanged path; per-passage dedup)
  scoped reconciliation:
    delete passages in fetchedBookIds not in retained set
    delete works whose external_id is not in sidebarBookIds
    delete empty cloud works among fetchedBookIds only
```

## Error handling

- **`peekBookFingerprint` throws**: treat as fingerprint-miss for safety. Log via `onDebug`, fall through to full extraction. Do not store a fingerprint we couldn't compute.
- **`extractCurrentBookPassages` throws after a fingerprint miss**: do not update `cloud_book_sync_state` for that book. The prior fingerprint (possibly older than the live one) stays in place; next sync will see a mismatch and retry. `stats.skippedBooks` is incremented; the error is logged but does not fail the run.
- **Run cancelled mid-flight (`signal.aborted`)**: every book that completed its extract-and-upsert before the cancel has its fingerprint persisted in the post-fetch step. The connector throws `AbortError`; the main process handles it the same way it handles other cancels today, but persists any partial fingerprints already returned. (Implementation note for planning: the connector must return the partial `fingerprints` and `fetchedBookIds` even on abort, not lose them.)
- **`selectBook` fails repeatedly**: a book that fails to select every run will never have its fingerprint updated; it stays at the prior value if any. This is acceptable — failing to select is independent of the fingerprint mechanism. The existing `stats.skippedBooks` continues to flag these.
- **Reconciliation gate trips**: when `skipReconcile === true`, none of the new scoped deletes run. The existing low-confidence info message is emitted with the same wording, plus the count of fingerprint-skipped books for context.

## Observability

Per-book debug lines (single line each, via existing `onDebug`):

```
book id=B0XXX peek_ms=820 extract_ms=0    decision=unchanged
book id=B0YYY peek_ms=830 extract_ms=2400 decision=changed reason=count-differs prior_count=40 new_count=42
book id=B0ZZZ peek_ms=810 extract_ms=2200 decision=changed reason=no-prior
book id=B0AAA peek_ms=0   extract_ms=0    decision=select-failed
```

Sync progress messages (extension of existing patterns):

- After fetch: `"Cloud fetch completed: ${fetched} books extracted, ${skipped} unchanged. ${passages} quotes total."` where `fetched = stats.fingerprintChangedBooks`, `skipped = stats.fingerprintSkippedBooks`.
- After scoped reconcile: existing wording, plus a per-book scope hint when relevant: `"Reconciled cloud data: removed ${removedPassages} stale quotes (across ${fetchedBookIds.length} re-extracted books) and ${removedWorks} books no longer in your library."`

Aggregate stats persisted into `syncJobs.cloud` extra fields (additive, optional): the existing `lastSuccessAt` and `resumeCursor` continue to be set; new optional fields can be added in a follow-up if the desktop UI wants to surface "books unchanged this sync."

## Testing

Add `packages/source-cloud-notebook/tests/` cases (extending the existing `position-from-id.test.ts`, `title-resolution.test.ts`) and `packages/core/tests/` cases.

### Pure-function tests for `computeBookFingerprint`

- Same `(count, ids[])` input → identical output.
- Different `count`, same `ids[]` → different output.
- Same `count`, one `id` changed → different output.
- Same `count`, IDs in different order → different output (DOM order is part of the fingerprint).
- Prefix begins with `v1:`.
- Empty `ids[]` with `count=0` → stable, distinct from any non-empty input.

### Decision tests for the per-book loop

These mock `selectBook`, `peekBookFingerprint`, `extractCurrentBookPassages` (the real Playwright surface is not exercised in unit tests; the loop's branching is pulled into a testable function or tested via dependency injection).

| #  | Scenario                                                                | Expected                                                                                  |
| -- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1  | Known fingerprint matches peeked fingerprint                            | `extract` not called; book in `skippedByFingerprintBookIds`; `fingerprints` has the value |
| 2  | Known fingerprint differs (count)                                       | `extract` called; book in `fetchedBookIds`; debug reason `count-differs`                  |
| 3  | Known fingerprint differs (IDs)                                         | `extract` called; reason `ids-differ`                                                     |
| 4  | No known fingerprint                                                    | `extract` called; reason `no-prior`                                                       |
| 5  | `forceFullSweep=true`, fingerprints match                               | `extract` called; reason includes `forced`                                                |
| 6  | `peekBookFingerprint` throws                                            | `extract` called (fail-open); fingerprint *not* added to returned map                     |
| 7  | `extract` throws after peek                                             | book in neither `fetchedBookIds` nor `skippedByFingerprintBookIds`; fingerprint *not* in returned map; `stats.skippedBooks += 1` |
| 8  | `selectBook` fails                                                      | Both `extract` and `peek` are not called; `stats.skippedBooks += 1`                       |
| 9  | `signal.aborted` between books                                          | Loop terminates; partial `fingerprints`, `fetchedBookIds`, `skippedByFingerprintBookIds` returned; AbortError thrown |

### Repository tests

| #  | Method                                                  | Scenario                                                                  | Expected                                                                                              |
| -- | ------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 10 | `getCloudBookSyncStates`                                | Empty table                                                               | Empty Map                                                                                             |
| 11 | `upsertCloudBookSyncState`                              | New row                                                                   | Both timestamps set; fingerprint stored                                                               |
| 12 | `upsertCloudBookSyncState`                              | Existing row                                                              | All fields overwritten                                                                                |
| 13 | `markCloudBookSeen`                                     | Existing row                                                              | `last_seen_at` advances; fingerprint and `last_fetched_at` unchanged                                  |
| 14 | `markCloudBookSeen`                                     | No row                                                                    | No-op (does not insert; we don't track books we've never extracted)                                   |
| 15 | `pruneCloudBookSyncStatesNotIn`                         | Sidebar has 2 of 3 stored books                                           | Returns 1; the missing book is removed                                                                |
| 16 | `deleteCloudPassagesInBooksNotInExternalIds`            | Two cloud books A and B; A is in scope and one of its passages not retained; B is out of scope | A's unretained passage deleted; B's passages untouched even if not in retained set                    |
| 17 | `deleteCloudPassagesInBooksNotInExternalIds`            | Non-cloud-source work matching an in-scope external_id                    | Untouched (filtered by `ingest_source = 'cloud-notebook'`)                                            |
| 18 | `deleteCloudWorksByExternalIdsNotIn`                    | Sidebar list omits a cloud work                                           | Work and its passages removed                                                                         |
| 19 | `deleteCloudWorksByExternalIdsNotIn`                    | Sidebar list omits a non-cloud work                                       | Non-cloud work untouched                                                                              |
| 20 | `deleteEmptyCloudWorksByExternalIds`                    | One in-scope book has zero passages, another in-scope book has passages   | Only the empty one is deleted                                                                         |
| 21 | `deleteEmptyCloudWorksByExternalIds`                    | A book *not* in the scope list has zero passages                          | Untouched                                                                                             |

### Main-process orchestration tests

These can be done with a mock connector returning canned `fetchSince` results.

| #  | Scenario                                                              | Expected                                                                                                       |
| -- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 22 | All books fingerprint-matched; `passages: []`                          | No destructive deletes; `lastSuccessAt` set; sync status `success`; `lastSyncedAt` and `lastSeenAt` advance per book |
| 23 | One book changed, returns updated passages                             | Scoped delete fires for that book only; other books' state untouched                                            |
| 24 | One book vanished from sidebar                                         | Its work and passages are deleted via `deleteCloudWorksByExternalIdsNotIn`; its sync-state row pruned           |
| 25 | Low-confidence gate trips (prior=10000, fetched 2 books, passages=20)  | `skipReconcile=true`; no destructive deletes; info message emitted                                              |
| 26 | All-skipped run, prior=10000, passages=0                               | Does **not** trip low-confidence gate (`fetchedBookIds.length === 0`); status `success`                         |
| 27 | Periodic full sweep: one book's `last_fetched_at` older than threshold | Its fingerprint is stripped from the input map before passing to connector; book is re-extracted               |
| 28 | `forceFullSweep` set via UI                                            | Connector receives `forceFullSweep: true`; all books treated as missing fingerprints                            |

### Manual verification (in PR description)

1. With a real Kindle account, run a full sync. Confirm `cloud_book_sync_state` is populated with one row per book.
2. Run sync again immediately. Confirm zero `pages.update` calls into Notion's library DB rows (no changes), debug log shows `decision=unchanged` for all books.
3. Add a new highlight to one book in Kindle. Run sync. Confirm only that book is extracted; the new highlight appears.
4. Delete a highlight from a previously-fetched book in Kindle. Run sync. Confirm the deletion propagates (scoped reconciliation fires for that book).
5. Remove a book entirely from Kindle library. Run sync. Confirm the work and its passages are removed locally.
6. Click "Force full Kindle sync". Confirm every book is re-extracted regardless of fingerprint state.
7. Inspect debug log: capture min/median/p95 of `peek_ms` and `extract_ms` across books. Use this data to decide whether the next iteration should pursue sidebar-only skip (Approach B).

## Open questions

- **`markedAt` reliability** — the existing extraction reads `row.dataset.markedAt` per highlight. This spec does *not* depend on `markedAt` (the fingerprint is built from count + IDs only), but if `markedAt` turns out to be reliably populated, a future fingerprint version (`v2:`) could use a max-`markedAt` watermark and bail out of annotation scrolling once we hit an older row — strictly faster than the current peek. Defer to implementation timing data.
- **Migration of existing installs** — first sync after this ships will see zero rows in `cloud_book_sync_state` and behave like today's full scrape. No special migration script required. Confirm during implementation planning that this is acceptable; if not, an option is to populate fingerprints from a one-time peek-only sweep at startup.
- **Setting surface** — `cloud.fullSweepIntervalDays` is unsettable from the UI in this spec. Implementation can decide whether to plumb it into the settings JSON file directly or wait for a follow-up.
