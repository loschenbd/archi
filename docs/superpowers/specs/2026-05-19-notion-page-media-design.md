# Notion page icon & cover (spec B): design

**Date:** 2026-05-19
**Author:** Archi maintainers (drafted via brainstorming session)
**Status:** Draft, awaiting user review before implementation planning
**Scope:** `packages/destination-notion/src/index.ts`, new `packages/destination-notion/tests/`, `packages/destination-notion/README.md`; IPC additions in `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, and one renderer surface (button + handler).

## Problem

When Archi syncs Kindle works to Notion, the Library database row gets a "Cover" URL property (a column value), but the **Notion page itself** has no icon and no cover image. Visiting a work in Notion shows a blank, anonymous page. Readwise's Notion export sets both, which makes its library visually scannable. Archi should do the same.

The page-decoration gap is independent of how cover URLs are sourced. Today only the cloud-notebook source produces `coverImageUrl` (scraped from the Kindle notebook page); device-export does not. A future spec ("spec A: media resolver") will add ISBN lookup, OpenGraph image fetching, and favicon resolution to backfill URLs for more works. This spec ("spec B") is strictly about applying whatever URL is available to the Notion page's `icon` and `cover` fields, with sane fallbacks and idempotency.

## Goals

- Every Library page in Notion has a meaningful `icon` after sync — image when available, type-appropriate emoji otherwise.
- Every Library page with a `coverImageUrl` has a `cover` image. Pages without a URL have no cover (no placeholder).
- Re-running sync is steady-state quiet: pages whose icon/cover already match the desired values produce no Notion `pages.update` for media.
- A user-triggered "Refresh Notion media" action re-writes icon/cover for every page regardless of current state.
- Notion's rejection of a specific image URL never fails the sync — the page falls back to an emoji icon and no cover.

## Success criteria

- After a sync, opening any Library page in Notion shows a non-empty icon (image URL or emoji per work type).
- Books with `coverImageUrl` show that image as both icon and cover. Books without one show 📚 and no cover.
- Running sync twice in a row produces zero `pages.update` calls scoped to icon/cover on the second run (verified in unit tests via mock-call assertions; manually verified in dev).
- Clicking "Refresh Notion media" in the desktop UI re-writes icon/cover for every Library page even when nothing has changed.
- A Library work whose `coverImageUrl` Notion rejects (validation_error mentioning the URL) is left with an emoji icon and no cover; the surrounding sync completes with `success` or `partial_success` per existing semantics.

## Non-goals

- Computing or fetching new image URLs. No ISBN lookup, no OpenGraph scraping, no favicon resolution, no HTTP probing of URLs prior to passing them to Notion. All of that is **spec A (media resolver)**, deferred.
- Distinguishing "user customized this icon/cover" from "we wrote it last time." Per session decision: **trust-on-first-write**. If a user manually changes a page's icon/cover, the next sync may overwrite it. Acceptable trade-off for this iteration; spec A may revisit if it introduces a per-page write-log.
- Setting icon/cover on Passages pages. Passages are highlight rows, not "items"; only Library pages get media.
- Uploading binary image content via the Notion files API. All images use external URLs.
- Adding any new database properties or schema migrations to Library/Passages.
- Per-work-type overrides for the emoji map beyond the defaults documented below.

## Approach

All logic lives inside `packages/destination-notion`, adjacent to the existing upsert path. No new packages, no `core` changes, no source-package changes. The destination is the right boundary because the abstraction we need — "what should this page look like in Notion?" — is Notion-specific.

### Component changes

**1. `NotionSyncBatchOptions` extension** (`packages/destination-notion/src/index.ts`):

```ts
export type NotionSyncBatchOptions = {
  onProgress?: (event: NotionSyncBatchProgressEvent) => void;
  forceRefreshMedia?: boolean; // default false
};
```

The flag is read once at the top of `syncBatch` and threaded into the per-work loop. No state mutation.

**2. New private helper `chooseMedia`:**

```ts
type DesiredIcon =
  | { type: "external_url"; url: string }
  | { type: "emoji"; emoji: string };

type DesiredMedia = {
  icon: DesiredIcon;
  coverUrl?: string;
};

private chooseMedia(work: NotionWorkInput): DesiredMedia
```

Logic, in priority order:

1. If `work.coverImageUrl` is non-empty after trimming → `icon = { external_url, url }`, `coverUrl = url`.
2. Otherwise → `icon = { emoji, emoji: emojiFor(work.workType) }`, `coverUrl = undefined`.

The single-URL-for-both is a deliberate spec-B simplification. Spec A (resolver) may introduce a distinct `thumbnailUrl`; when it does, `chooseMedia` is the one place that needs updating.

**Emoji map (`emojiFor`):**

| WorkType    | Emoji |
| ----------- | ----- |
| `book`      | 📚    |
| `article`   | 📰    |
| `periodical`| 🗞️    |
| `document`  | 📄    |
| `other`     | 📌    |
| (unknown)   | 📌    |

**3. New private method `applyPageMedia`:**

```ts
private async applyPageMedia(
  pageId: string,
  desired: DesiredMedia,
  forceRefreshMedia: boolean,
  isNewPage: boolean
): Promise<void>
```

Behavior:

- **New page short-circuit:** if `isNewPage` is true, write icon and cover (when present) without retrieving the page. We know the page was just created with no media. Saves one round-trip per first-ever sync per work.
- **Existing page:** `client.pages.retrieve({ page_id })`, normalize current icon/cover, build a patch object:
  - Set `patch.icon = toNotionIcon(desired.icon)` if `forceRefreshMedia` OR `currentIcon` differs from `desired.icon` (compare by `(kind, value)`).
  - Set `patch.cover = toNotionCover(desired.coverUrl)` if `forceRefreshMedia` OR `currentCover` differs from `desired.coverUrl`. We **never set cover to null** unless `forceRefreshMedia` is true AND `desired.coverUrl` is absent — i.e., normal syncs do not clear a cover when our URL disappears, but a force refresh of a now-URL-less work does.
- If `patch` is empty, return without calling `pages.update`.
- Otherwise issue a single `client.pages.update({ page_id, icon?, cover? })` through the existing `withRetry`.

**Notion request shapes:**

```ts
// icon (external image)
{ type: "external", external: { url } }
// icon (emoji)
{ type: "emoji", emoji }
// cover
{ type: "external", external: { url } }
```

**4. `upsertLibraryWork` integration:**

After step 3 of the existing flow (page created or updated, before `tryEnsureWorkPageQuotesFeed`), call `applyPageMedia` wrapped in per-page error handling (see *Error handling* below). `isNewPage` is true when `existing` was null at the top of the method.

**5. `syncBatch` plumbing:**

`forceRefreshMedia` from `options` is read once and passed through `upsertLibraryWork` as a new parameter. No change to passage handling.

### IPC + UI surface

**Main process** (`apps/desktop/src/main/index.ts`):

- Register `ipcMain.handle("sync.refreshMedia", ...)`. The handler runs the same sync entry-point that the existing "Sync now" uses, but passes `{ forceRefreshMedia: true }` into `notionDestination.syncBatch`. It reuses the existing progress event stream — no new event types.
- Concurrency: respect the existing single-sync-at-a-time guard. If a sync is already running, return the same "busy" response the existing "Sync now" returns.

**Preload** (`apps/desktop/src/preload/index.ts`):

- Expose `archi.sync.refreshMedia(): Promise<...>` mirroring the existing `archi.sync.now()` shape.

**Renderer**:

- Add a button labeled **"Refresh Notion media"** on the Connections screen (alongside other Notion controls; the exact placement is a planning-time detail).
- Click handler shows a confirmation dialog: *"Re-write the page icon and cover image for every work in Notion. This can take several minutes for large libraries and may overwrite any icons/covers you've customized. Continue?"*
- On confirm, calls `archi.sync.refreshMedia()`. While the resulting sync runs, the existing sync-progress UI handles status display.

## Data flow

```
syncBatch(works, passages, { forceRefreshMedia })
  for each work:
    upsertLibraryWork(libraryDbId, passagesDbId, work, forceRefreshMedia)
      existing = findByExternalId(...) ?? legacyFallback(...)
      pageId   = existing ? update(existing.id, props) : create(props).id
      isNewPage = existing == null
      desired   = chooseMedia(work)
      try:
        applyPageMedia(pageId, desired, forceRefreshMedia, isNewPage)
      catch e:
        if isMediaUrlRejection(e):
          await applyEmojiFallback(pageId, work.workType).catch(noop)
        else: log + continue
      tryEnsureWorkPageQuotesFeed(pageId, passagesDbId)  // unchanged
```

Existing properties — including the `Cover` URL property on the Library row — keep being written exactly as today. We just *also* set page-level icon/cover.

## Error handling

**Per-page failure isolation.** `applyPageMedia` errors must never propagate up past `upsertLibraryWork`'s media block. The wrapping try/catch at the call site classifies errors:

| Error kind                                    | Handling                                                          |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `rate_limited`, timeouts, retryable transient | Already handled inside `withRetry`; no special treatment.         |
| `validation_error` matching URL-rejection regex (see below) | Run `applyEmojiFallback(pageId, workType)` once; swallow nested errors. |
| Any other error                               | Log to console; continue with the next work. Sync stays alive.   |

**URL-rejection detection (`isMediaUrlRejection`):**

`error.code === "validation_error"` AND `error.message` matches:

```
/invalid image url|url is not a valid url|image is too large|unsupported image|external url is invalid|could not download/i
```

This regex is best-effort; the goal is to catch known Notion rejection phrasings. Anything not matching falls into the "log and continue" bucket, where the worst case is one work without media — never a failed sync.

**`applyEmojiFallback`:**

Issues a single `pages.update` with `icon = { type: "emoji", emoji: emojiFor(workType) }` and no cover patch. If it also fails (rare — emoji updates rarely error), the error is swallowed.

**No URL pre-validation.** We do not `fetch`-probe URLs before handing them to Notion. Notion is the authoritative validator. This keeps `destination-notion` free of HTTP plumbing, which belongs in the future resolver spec.

## Testing

Add `packages/destination-notion/tests/` and wire `vitest` via the existing root config (mirror `packages/core/tests/`).

### Pure-function tests for `chooseMedia`

- Book with `coverImageUrl` set → `{ icon: external_url(url), coverUrl: url }`.
- Book with `coverImageUrl` undefined → `{ icon: emoji("📚"), coverUrl: undefined }`.
- Each non-book `workType` returns the documented emoji (article → 📰, periodical → 🗞️, document → 📄, other → 📌).
- Unknown `workType` string → 📌.
- Whitespace-only `coverImageUrl` (`"   "`) is treated as missing → emoji branch.

### Mocked-Notion-client tests for `applyPageMedia`

Each test stubs `client.pages.retrieve` and `client.pages.update`; assertions are on whether/how those mocks were called.

| #  | Scenario                                                              | Expected                                                                   |
| -- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1  | `isNewPage=true`, URL present                                          | One `pages.update` with `icon` and `cover`. No `pages.retrieve`.           |
| 2  | Existing page; current icon+cover already match desired                | One `pages.retrieve`. No `pages.update`.                                   |
| 3  | Existing page; current icon differs, cover matches                     | `pages.update` with `icon` only (no `cover` key in body).                  |
| 4  | Existing page; current cover differs, icon matches                     | `pages.update` with `cover` only.                                          |
| 5  | Existing page; no current icon/cover; URL present                      | `pages.update` with both.                                                  |
| 6  | `forceRefreshMedia=true`; current matches desired                      | `pages.update` still fires with both keys.                                 |
| 7  | URL absent; current icon is emoji that matches `emojiFor(workType)`    | No `pages.update`.                                                         |
| 8  | URL absent; current icon is some other emoji (user-set)                | `pages.update` overwrites with our emoji (trust-on-first-write).            |
| 9  | URL absent; `forceRefreshMedia=true`; current cover is set             | `pages.update` clears the cover (cover patch = `null`).                    |
| 10 | URL absent; normal sync; current cover is set                          | `pages.update` does **not** include `cover` (we don't clobber on normal sync). |

### Integration tests via `upsertLibraryWork`

| #  | Scenario                                                              | Expected                                                                   |
| -- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 11 | `applyPageMedia` throws `validation_error` "Invalid image url"         | One emoji-fallback `pages.update`. `upsertLibraryWork` returns normally.   |
| 12 | `applyPageMedia` throws `rate_limited`                                 | Propagates to `withRetry`; not caught by URL-rejection fallback.            |
| 13 | `applyPageMedia` throws an unknown `validation_error`                  | Logged; no fallback write; sync continues; surrounding work upsert succeeded. |

### Manual verification (in PR description)

Run a sync against a scratch Notion workspace with at least one Kindle book that has a cover URL and one that does not. Open each Library page in Notion and confirm:

- Book with cover URL: image icon and full-width cover image.
- Book without cover URL: 📚 icon, no cover.
- Run sync again: pages look identical, no flicker (no second write).
- Click "Refresh Notion media", confirm: pages re-render (Notion shows brief loading), end state identical.
- Manually change one page's icon to ⭐ in Notion, run normal sync: icon reverts to image-or-📚 (documented behavior).

## README

Add `packages/destination-notion/README.md` covering:

- **Icon selection priority:** image URL > emoji-for-work-type. Emoji map table.
- **Cover selection:** same URL as icon when present; omitted otherwise.
- **Idempotency:** new pages get one write; subsequent syncs only write when the page's current icon/cover differs from the desired value. The Notion page's icon/cover is the source of truth for "have we written this already" (we do not persist last-written values locally in this spec).
- **Force refresh:** click "Refresh Notion media" in the desktop app's Connections screen to re-write icon/cover for every Library page. Useful when you've changed something upstream (e.g., the URL source) and want immediate propagation.
- **Known limitation:** trust-on-first-write. Manually-set icons/covers in Notion will be overwritten on the next sync. A future spec may introduce write-provenance tracking.

## Open questions

None at design time. Implementation may surface small choices (button placement on the Connections screen, exact log format for swallowed errors) that are appropriate to resolve at planning or PR time.
