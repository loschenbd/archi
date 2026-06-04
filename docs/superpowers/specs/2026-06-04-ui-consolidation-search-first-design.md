# UI Consolidation: drop Passages, sharpen Search — Design

**Status:** approved design, ready for implementation planning
**Date:** 2026-06-04
**Author:** ben@benjaminloschen.com (with Claude)
**Scope:** Frontend-only consolidation of the Archi desktop app's navigation now that local semantic search is shipped. No backend / IPC / data-model changes. Touches `apps/desktop/src/renderer/`.

## 1. Goal

Now that `packages/search` provides real hybrid retrieval (vec0 KNN + FTS5 + RRF), the three highlight-related screens — Library, Passages, Search — overlap in confusing ways. Passages and Search are basically the same screen with different backends. The user has to learn which one to use to find a specific quote.

Consolidate to **two top-level workspaces** that map cleanly onto two distinct user intents:

- **Library** — "I want to wander into a specific book and see what I highlighted."
- **Search** — "I want to find a specific quote or idea across everything I've ever highlighted."

Plus `⌘K` from anywhere for fast cross-corpus lookup. Drop the Passages screen entirely; its responsibilities split between Library (browse-by-book) and Search (find-across-everything).

## 2. Out of scope (explicit non-goals)

- No backend changes. `@archi/search`, the indexer, the embedder, the vec0 schema, the IPC surface — all unchanged.
- No new search features. No reranker, no query expansion, no chat — those have their own future specs.
- No in-book search inside `LibraryBookDetailScreen`. Possibly worth doing later, but a separate decision.
- No redesign of the result card visual style. We're moving and adding, not restyling.
- No rename of "Search" to "Highlights" / "Explore" / "Find." The screen's title stays "Search." Easy to change later.
- No change to the global `⌘K` bar behavior. It already does what we want.
- No change to onboarding, sync, Notion destination, or any of the Connection plumbing.

## 3. Current state (what we're moving away from)

| Screen | What it does today | Search backend |
|---|---|---|
| `LibraryScreen` | Grid of book covers, letter-pill filter, local title-substring input. Click → `LibraryBookDetailScreen`. | Local substring match on title/creator. |
| `LibraryBookDetailScreen` | One book's highlights, grouped by page/location. | None — just lists. |
| `PassagesScreen` | Virtualized list of all 3,132 highlights with a local-substring input, a single "filter by work" dropdown, and per-card Copy / Open book / Find similar actions. | **Local substring only.** Does not use the hybrid search backend at all. |
| `SearchScreen` | Real hybrid retrieval input, filter chips, KEYWORD/VECTOR/BOTH badges. | `window.archi.search.query()` — the real hybrid path. |

Specific overlaps that motivate the change:

- Passages and Search both let you "find a highlight across all books." Passages does it with literal substring; Search does it with hybrid retrieval. Passages produces strictly worse results and confuses users into thinking search doesn't work well.
- Library's local title-substring input is fine (it's about books, not highlights) — no overlap, leave it.
- Per-passage row actions (Copy / Open book / Find similar) currently live on Passages but not on Search result cards. After consolidation, they need to live on Search result cards too.

## 4. Proposed structure

### 4.1 Sidebar

Five items, in this order:

1. **Home**
2. **Library**
3. **Search**
4. **Connections**
5. **Logs**

Rationale: Connections moves down because it's a setup-time surface, not a daily one. Library and Search sit next to each other because they're the two daily workspaces. Passages is removed.

### 4.2 Library (unchanged)

- Grid of book covers, letter-pill filter, local title-substring input — all unchanged.
- Click a book → `LibraryBookDetailScreen` (unchanged): highlights grouped by page/location.
- Per-passage row actions inside book detail: **Copy** · **Find similar**. (No "Open book" — you're already in it.)

### 4.3 Search (replaces Passages)

- **Focused input on mount** (already implemented).
- **`+ Add filter` chips** for author / book / label / starred / date (already implemented).
- **Empty state below the input** when no query is typed: one centered helper line:
  > *"Type to search 3,132 highlights · ⌘K from anywhere · click a book in Library to browse one."*

  Token count in the helper line is dynamic — pulled from `indexer.getStatus().total` so it reflects the real corpus size, not a hardcoded number.
- **Result cards on query** with KEYWORD / VECTOR / BOTH badge, snippet, attribution, and row actions: **Copy** · **Open book** · **Find similar**. Currently `SearchResultCard` has Open book and Find similar but not Copy — Copy must be added.
- **No browse-all virtualized list.** `PassagesScreen` is deleted, not renamed.

### 4.4 `⌘K` global search bar (unchanged)

- Stays in the top-right of the chrome on every screen.
- `↵` submits → opens Search prefilled with the query.
- `⌘↵` opens Search prefilled and focuses filter chips.

### 4.5 Find similar (unchanged behavior, one flow tweak)

- Button on any passage row (Library/Book detail and Search results) → opens Search with that passage's body as the initial query.
- The existing `searchInitialQuery` + `searchScreenInstance` plumbing in `App.tsx` stays.
- Today, the "open passage from search" callback (`openPassageFromSearch` in `App.tsx`) jumps to `Passages`. After consolidation it jumps to `Search` (or just no-ops if the result was clicked from inside Search already).

## 5. Code changes

### 5.1 Delete

- `apps/desktop/src/renderer/screens/PassagesScreen.tsx`

### 5.2 Edit

- **`apps/desktop/src/renderer/App.tsx`**
  - Remove `"Passages"` from the `screens` tuple.
  - Remove the `Passages` render branch and the `<PassagesScreen ... />` import.
  - Update `openPassageFromSearch` to set `activeScreen` to `"Search"` instead of `"Passages"`.
  - Reorder the `screens` tuple to match §4.1: `["Home", "Library", "Search", "Connections", "Logs"]`.
- **`apps/desktop/src/renderer/screens/SearchScreen.tsx`**
  - Add the empty-state helper paragraph rendered when `text.trim() === ""` and `response === null`.
  - Use `window.archi.search.indexerStatus()` (already exposed) to get the total count for the helper text. Fall back to "your highlights" if status is unavailable.
- **`apps/desktop/src/renderer/components/SearchResultCard.tsx`**
  - Add a Copy action button matching the style and behavior of the one on today's `PassagesScreen` rows (writes `result.passage.body` to clipboard, shows a 1.4s "Copied" confirmation).
- **`apps/desktop/src/renderer/styles.css`**
  - Remove `.passages-screen`, `.passages-filters`, `.passages-list-scroll`, `.passages-list-inner`, `.passages-list-row` rules.
  - Keep `.passage-card`, `.passage-card-mark`, `.passage-card-body`, `.passage-card-footer`, `.passage-card-attribution`, `.passage-card-dash`, `.passage-card-title`, `.passage-card-actions`, `.passage-card-action`, `.passage-card-action-icon`, `.passage-card-action-success` — Search result cards reuse them.
  - Update sidebar style file (if any) to match the new five-item order.

### 5.3 Touch (small)

- Sidebar icon for Search if a different glyph reads better with Passages gone. Default: keep the existing 🔍.
- The `availableCreators` fetch in `SearchScreen.tsx` currently fires a `search.query({ text: "", filters: {}, limit: 200 })` to derive the creator dropdown — this is wasteful but isn't blocking. Leave it for a future optimization; not in scope for this change.

### 5.4 Verify (no edit expected but confirm)

- `GlobalSearchBar.tsx` — `⌘K` shortcut, `↵` submit (`openSearchScreenWithQuery`), `⌘↵` escalate. All paths land on `Search`, which still exists. Should Just Work.
- `IndexingBanner.tsx` — currently rendered inside `SearchScreen.tsx`. Stays there.
- `FindSimilarButton.tsx` — calls `onOpenSearchScreen(passageBody)`. The handler in `App.tsx` sets `searchInitialQuery` and switches `activeScreen` to `"Search"`. Unchanged.

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| User muscle-memory wants Passages | Sidebar change is visible immediately; the gap is the design. No fallback needed. |
| Empty Search screen feels barren on first load | Helper paragraph in §4.3 (one centered line) gives an action-shaped hint. |
| Users want to scroll all highlights without typing | Out of scope. Library + book detail covers the "wander into highlights" intent. If feedback contradicts this, revisit with a "Show all" affordance — small change, no schema impact. |
| `Copy` action on `SearchResultCard` regresses or styles differently from the old Passages copy | Lift the existing `passage-card-action` styles verbatim; copy the `copiedId` state pattern from `PassagesScreen.tsx` lines 35–76. |
| Result card opens to the wrong screen after "Open book" | The button calls `onOpenWork(workId)` which sets `selectedLibraryWorkId` and switches `activeScreen` to `"Library"`. Existing flow, no change needed. |

## 7. Verification

This is a UI refactor with no automated test coverage on the affected screens. Manual verification:

1. **Build clean:** `pnpm dev` starts without typescript errors. No dead imports.
2. **Sidebar order:** five items in the §4.1 order; Passages is gone.
3. **Library:** clicking a book opens its detail; per-passage rows show Copy and Find similar.
4. **Search empty state:** opens with focused input and the helper-line text below; helper-line shows live passage count.
5. **Search querying:** typing a non-keyword query produces VECTOR or BOTH badges within ~80ms.
6. **Result card actions:** Copy writes to clipboard with the "Copied" feedback; Open book opens Library at the right book; Find similar opens Search with the passage as the seed query.
7. **⌘K from a non-Search screen:** focuses the global bar; Enter submits and lands on Search with the query.
8. **Find similar from book detail:** opens Search prefilled with the passage body.
9. **No console errors / warnings** on any of the above.

## 8. Future follow-ups (deliberately deferred)

- In-book search input inside `LibraryBookDetailScreen` — useful for long books, but a separate decision.
- Optimize the `availableCreators` fetch (use a dedicated IPC instead of a no-op search).
- Reconsider the screen name "Search" if users find it generic; e.g. "Find" or "Explore."
- A "recently viewed highlights" affordance on the Home screen.

## 9. Open questions

None at design-approval time. If any surface during implementation they'll be raised in the plan's review checkpoints.
