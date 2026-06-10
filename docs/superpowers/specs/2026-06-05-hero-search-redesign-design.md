# Hero Search Redesign — Design

**Date:** 2026-06-05
**Status:** Approved (brainstorming → ready for implementation plan)
**Branch:** `worktree-local-semantic-search` (lands on top of the search + homepage integration)

## Goal

Reframe the Home screen so semantic search reads as the hero feature. Replace the small top-right header search input with a generous, card-style hero block at the top of Home's body. The block lives in two states: a resting state with a tagline, large pill input, suggested-query chips, and a recent-searches strip; an active state where the dashboard hides and result cards fill the canvas inside the same hero card.

## Non-goals

- No new IPC. The existing `archi:search:*` channels (query, indexerStatus, startIndexing, facets) cover everything.
- No AI-generated suggested queries — the chip set is hardcoded.
- No global cross-screen ⌘K command palette. The keybind exists only on Home and just refocuses the hero input.
- No query history beyond the 3 most recent persisted strings.
- No changes to `SearchResultCard`, `SearchFilterChips`, `HighlightedText`, the search service in `packages/search`, the indexer, or the DB migration.
- No redesign of Library, Settings, SyncBanner, StatsStrip, BooksRail, RandomHighlight, or LatestHighlights internals.
- No changes to the LibraryBookDetailScreen scroll-to-passage behavior threaded through `pendingScrollPassageId`.

## What this redesign replaces

Currently (on `worktree-local-semantic-search` HEAD):
- The content-header on Home renders a small pill search input (`.content-header-search-input`, ~280px wide, top-right).
- When the user types, `HomeScreen.tsx` conditionally renders `<HomeSearchResults>` in place of the StatsStrip / BooksRail / highlights-split modules.
- `HomeSearchResults` is a standalone component that consumes `homeSearchQuery`, `homeSearchFilters`, `findSimilarPassageId` props and renders a virtualized result list inside a `max-height: 60vh` container.
- The find-similar sentinel chip (`.content-header-search-sentinel`) replaces the input inside the content-header when find-similar mode is active.

After this redesign:
- The content-header has no search input. Just `Workspace / Home` on the left, nothing on the right.
- A new `SearchHero` component owns the search experience — both resting and active states.
- `HomeSearchResults` is folded into `SearchHero` as the active-state body. The standalone file is deleted.
- The find-similar sentinel lives inside `SearchHero`, replacing the input row when active.

## Information architecture

Home body (top-to-bottom inside `.screen-card`):

1. **SyncBanner** — unchanged from the integration; six states (Cancelling > Running > Indexing > NoHealthySources > NeedsAuth > Failed > Hidden)
2. **SearchHero** — the new hero block, two visual states
3. **Dashboard** — only when SearchHero is in resting state. Contains: `StatsStrip`, `BooksRail`, `<div className="highlights-split">` with `RandomHighlight` + `LatestHighlights`. Identical to the integration's current Home dashboard.

## SearchHero — resting state

Single padded card with subtle border (`.search-hero`, `.search-hero-resting` modifier). Top-to-bottom inside the card:

### Tagline
- Italic serif (`var(--serif, Georgia, serif)`), ~16px, color `var(--ink-700)`, centered, with generous bottom margin (~16–20px)
- Copy: *"Ask anything across `<count>` highlights"* where `<count>` is `passages.length.toLocaleString()`
- **Indexing variant:** when `indexerStatus.status === "running"` and `indexerStatus.indexed < indexerStatus.total`, copy becomes *"Ask anything across `<indexed>` of `<total>` indexed highlights"*. The fewer-than-total count reads as honest progress.

### Input row
- Pill-shaped input (`.search-hero-input-wrap` wrapper, `.search-hero-input` actual input)
- Soft accent border at rest (`color-mix(in srgb, var(--accent) 22%, transparent)`), darker on focus
- Background `var(--surface)`
- Padding generous (~14px 22px), font-size ~16px
- Left-aligned text; left-side magnifier icon (`.search-hero-icon`) at ~16px, accent color
- Right-side `⌘K` hint (`.search-hero-kbd`) in subtle muted style — purely cosmetic for v1
- Placeholder: *"What do you want to find?"*
- `autoFocus` on mount
- Standard `onChange` / `onKeyDown` — `Esc` clears the value (only triggers `setQuery("")` when the value is non-empty)

### Suggested query chips
- Horizontal flex row (`.search-hero-chips`) below the input
- Four chips, hardcoded for v1:
  | Chip label | Action |
  |---|---|
  | `books on creativity` | sets query text to `"books on creativity"` |
  | `quotes about discipline` | sets query text to `"quotes about discipline"` |
  | `from last month` | sets query text to `""` + sets `filters.markedAfter` to ISO timestamp 30 days ago |
  | `starred only` | sets query text to `""` + sets `filters.isStarred = true` |
- Each chip is a button (`.search-hero-chip`), small (~11px font, 4px 12px padding), rounded pill, low-contrast border
- Hover state lifts to accent color
- Clicking a chip triggers the corresponding action and (because the input either now has text OR the filter is non-empty) flips the hero into active state on the next render

### Recent searches strip
- Single inline line below the chips (`.search-hero-recents`), font-size ~11px, color `var(--ink-500)`
- Format: *"Recent: `<q1>` · `<q2>` · `<q3>`"*, where each query is a button styled as an accent-colored link (`.search-hero-recents-link`)
- Only rendered when `recentSearches.length > 0`
- Up to 3 entries, persisted to `localStorage` under key `"archi.recentSearches"`
- Clicking a recent → sets the query text → flips to active state → moves that query to index 0 of `recentSearches`

## SearchHero — active state

Same outer card (`.search-hero`, `.search-hero-active` modifier). Triggered when `query.trim().length > 0 || findSimilarPassageId !== null`.

### Input row (preserved)
- Same input wrapper + icon + `⌘K` hint as resting
- Clear button (×) appears on the right side of the input when `query.length > 0`, clicking clears
- **Find-similar sentinel:** when `findSimilarPassage` is non-null, the input is REPLACED by:
  ```
  Similar to "<first 40 chars of body>…"   [×]
  ```
  styled as a pill matching the input's outer dimensions (`.search-hero-sentinel`). The × calls `clearFindSimilar()`.
- Esc on the input clears the query → returns to resting. Global keydown (set up at App level for find-similar) clears the sentinel.

### Filter chips
- Replaces the suggested query chips row
- Renders `<SearchFilterChips filters={filters} onChange={setFilters} />` (existing component from the integration)

### Result count line
- Replaces the recent searches strip
- Two formats based on `prefs.showMatchSource`:
  - On: *"`<keyword>` keyword · `<vector>` vector · `<both>` combined"*
  - Off: *"`<count>` results"* (singular `result` when exactly 1)
- While loading: *"Searching…"*
- After load with zero results: *"No matches."* (and an inline `Clear query` button — see Empty section below)

### Results
- Virtualized list of `<SearchResultCard>` inside `.search-hero-results` (a `max-height: 60vh; overflow-y: auto; position: relative` container)
- Uses the same `useVirtualizer` setup as the current `HomeSearchResults`: `estimateSize: 180`, `overscan: 4`, `getItemKey` by `passageId`, `measureElement` ref for dynamic heights
- Each row absolute-positioned with `transform: translateY(...)` and `padding-bottom: 10px` for visual gap
- Card behavior preserved: inline expand on click (single-expand model via `expandedId`), Copy / Open book / Find similar action row, KEYWORD/VECTOR/BOTH badge gated by `prefs.showMatchSource`

### Empty state
- When `response && response.results.length === 0 && !loading`:
  - Renders *"No matches."* (small, italic, muted, centered) ABOVE the empty results container
  - Below: a small inline `Clear query` button that clears `query` (or `findSimilarPassage`) → returns to resting
- The empty state lives OUTSIDE the scroll container so the virtualizer never runs with `count === 0`

## Header on Home

The `.content-header-search` block in `App.tsx` is removed entirely. The rendered header on Home shows only:

```
WORKSPACE
Home
```

(left-aligned, no right-side content). Non-Home screens already had no search input, so they're unchanged.

## Component structure

### New file
- `apps/desktop/src/renderer/screens/home/SearchHero.tsx`
  - Default export (or named): `SearchHero`
  - Owns: input, suggested chips, recent searches, filter chips (active), result count, virtualized results, sentinel
  - Internal state: `expandedId: string | null`
  - Internal calls: the same `runQuery` debounced `useEffect` pattern currently in `HomeSearchResults`. Calls `window.archi.search.query` with `{ text, filters: mergedFilters, limit: 50, findSimilarPassageId }`. 150ms debounce. Merges `prefs.includeArchived` / `prefs.includeHidden` into filters.

### Modified files
- `apps/desktop/src/renderer/screens/HomeScreen.tsx`
  - Drops the conditional render (`{trimmedQuery ? <HomeSearchResults /> : <>…</>}`)
  - Always renders `<SearchHero …/>` near the top, then conditionally renders the dashboard modules only when `!searchActive`
  - Receives new derived prop `highlightCount` (from `passages.length`, threaded from App)
  - Receives existing `effectiveSearchQuery`, `homeSearchFilters`, `findSimilarPassageId`, `findSimilarPassage`, `onFiltersChange`, `onFindSimilar`, `onOpenWork` props
  - Adds new prop callbacks: `onSearchQueryChange` (passes through to `App.tsx`'s `setHomeSearchQuery`), `onClearFindSimilar` (calls `setFindSimilarPassage(null)`)
  - `useDeferredValue` on the query stays — only the `SearchHero` consumes the deferred value via the `effectiveSearchQuery` prop

- `apps/desktop/src/renderer/App.tsx`
  - Removes the `.content-header-search` rendering block entirely
  - Adds new state `const [recentSearches, setRecentSearches] = useState<string[]>(readInitialRecentSearches)` + a `useEffect` to persist on changes
  - Adds helper `readInitialRecentSearches(): string[]` that reads from `localStorage["archi.recentSearches"]`, parses JSON, clamps to length 3, falls back to `[]`
  - Adds helper `pushRecentSearch(s: string)` (closure or callback) that prepends `s` after de-duping and `slice(0, 3)`
  - Wires `pushRecentSearch` through HomeScreen → SearchHero so the hero can call it
  - Provides `setHomeSearchQuery` and `setFindSimilarPassage(null)` as the two new HomeScreen callbacks
  - Threads `highlightCount={passages.length}` and `recentSearches={recentSearches}` into HomeScreen, which forwards both to SearchHero

- `apps/desktop/src/renderer/styles.css`
  - **Add:** `.search-hero`, `.search-hero-resting`, `.search-hero-active`, `.search-hero-tagline`, `.search-hero-input-wrap`, `.search-hero-input`, `.search-hero-input:focus-visible`, `.search-hero-input::placeholder`, `.search-hero-icon`, `.search-hero-kbd`, `.search-hero-clear`, `.search-hero-clear:hover`, `.search-hero-chips`, `.search-hero-chip`, `.search-hero-chip:hover`, `.search-hero-recents`, `.search-hero-recents-link`, `.search-hero-recents-link:hover`, `.search-hero-sentinel`, `.search-hero-sentinel-clear`, `.search-hero-filter-chips-wrap`, `.search-hero-count`, `.search-hero-count-loading`, `.search-hero-results`, `.search-hero-results-inner`, `.search-hero-results-row`, `.search-hero-empty`, `.search-hero-empty-clear`
  - **Delete:** `.content-header-search`, `.content-header-search-input`, `.content-header-search-input:focus-visible`, `.content-header-search-clear`, `.content-header-search-clear:hover`, `.content-header-search-sentinel`, `.content-header-search-sentinel > span` (these were homepage-redesign + integration carryovers; the input is moving out of the header)
  - **Delete:** `.home-search-results-v2`, `.home-search-results-v2-summary`, `.home-search-results-v2-list`, `.home-search-results-v2-list-inner`, `.home-search-results-v2-row`, `.home-search-empty` (folded into `.search-hero-results*` and `.search-hero-empty`)

### Deleted file
- `apps/desktop/src/renderer/screens/home/HomeSearchResults.tsx`
  - All its logic (debounced runQuery, virtualizer, expandedId, render) folds into `SearchHero`

## Data flow

| Component | Inputs | Outputs |
|---|---|---|
| App.tsx | window.archi.search, localStorage["archi.recentSearches"], existing state (`homeSearchQuery`, `homeSearchFilters`, `findSimilarPassage`) | `<HomeScreen>` props (+ `highlightCount`, `recentSearches`, `onSearchQueryChange`, `onClearFindSimilar`, `pushRecentSearch`) |
| HomeScreen.tsx | App props | `<SearchHero>` + dashboard modules; passes through every prop unchanged |
| SearchHero.tsx | query, setQuery, filters, setFilters, findSimilarPassageId, findSimilarPassage, clearFindSimilar, highlightCount, recentSearches, pushRecentSearch, onOpenWork, onFindSimilar | calls `window.archi.search.query` directly; renders one of resting or active layouts |
| SyncBanner.tsx | (unchanged) | (unchanged) |
| StatsStrip / BooksRail / RandomHighlight / LatestHighlights | (unchanged) | (unchanged) |

`pushRecentSearch` lives in App.tsx. SearchHero calls it when:
- A debounced query completes with `response.results.length > 0` (avoids storing typos)
- A chip click fills the query
- A recent-search link click re-runs a query (moves to top)

The `pushRecentSearch` function is responsible for de-duplication (prepend + slice(0,3) + de-dup case-insensitive).

## Behavior details

- **`⌘K` keybind on Home:** added as a global keydown listener inside `SearchHero` (mount/unmount with the component, so it's automatically scoped to Home). Pressing `⌘K` (or `Ctrl+K` on Windows/Linux) calls `inputRef.current?.focus()` + `select()`. The keybind does nothing else for v1.

- **Tagline counts during indexing:** the indexing variant uses `IndexerStatusContext` (already hoisted to App). `useIndexerStatus()` returns the wrapper; `wrapper?.status === "running"` triggers the variant. After indexing completes, the tagline reverts to the "across N highlights" form.

- **Recent searches persistence:**
  - Storage key: `"archi.recentSearches"`
  - Format: JSON string array of up to 3 entries
  - Read on App.tsx mount via `useState(readInitialRecentSearches)`
  - Written via `useEffect(() => { localStorage.setItem("archi.recentSearches", JSON.stringify(recentSearches)) }, [recentSearches])`
  - Pruning: `slice(0, 3)` always
  - De-dup: if the new query already exists in the array (case-insensitive), filter it out before prepending

- **Find-similar takeover:** when `findSimilarPassage !== null`, the input is replaced by the sentinel pill. Resting-state chips and recents are also hidden (the active layout's filter chips + result count render below the sentinel). Esc on the global keydown handler clears `findSimilarPassage` (existing wiring from the integration; preserved).

- **Esc semantics:**
  - Input has text + no find-similar → Esc clears the input → resting state, dashboard reappears
  - Sentinel mode → Esc (global handler) clears `findSimilarPassage` → if `homeSearchQuery` was set before find-similar, the input reappears with that value; else resting state

- **Empty state interactivity:** the `Clear query` button is rendered only when there's something to clear (either `query.length > 0` OR `findSimilarPassage !== null`). Clicking it returns to resting.

- **`searchActive` derivation in HomeScreen:** the dashboard hides whenever any of the search inputs are non-default — typed query, find-similar, OR a filter set by chips:
  ```ts
  function hasNonDefaultFilters(filters: SearchFilters): boolean {
    return (
      (filters.workIds?.length ?? 0) > 0 ||
      filters.creator !== undefined ||
      (filters.labels?.length ?? 0) > 0 ||
      filters.isStarred === true ||
      filters.markerColor !== undefined ||
      filters.workType !== undefined ||
      filters.markedAfter !== undefined ||
      filters.markedBefore !== undefined ||
      filters.isArchived === true ||
      filters.isHidden === true
    );
  }
  const searchActive =
    effectiveSearchQuery.trim().length > 0 ||
    findSimilarPassageId !== null ||
    hasNonDefaultFilters(filters);
  ```
  The helper lives in `home/utils.tsx` so both HomeScreen and SearchHero can use it.

## Edge cases

- **Empty library (0 passages):** tagline reads *"Ask anything across 0 highlights"*. Suggested chips still render (user can click `starred only` to filter once they have data; the others run a query that returns no results — that's acceptable). Recent searches strip is empty (hidden until first query).
- **No indexed corpus yet:** indexing tagline variant: *"Ask anything across 0 of 4,892 indexed highlights"*. Queries during this state return partial results from the indexed subset. The SyncBanner separately surfaces indexing progress with a progress bar; the tagline carries the same number quietly.
- **`⌘K` while in another input:** the global keydown still fires; pressing `⌘K` always refocuses the hero input. Acceptable v1 behavior (matches Spotlight, Notion, Linear).
- **Chip click while a different query is active:** the chip overwrites the input value. The find-similar passage (if set) is cleared as a side effect to avoid mixed state — handled by `setFindSimilarPassage(null)` inside the chip click handler.
- **Recent search of a stale query:** if the user clicks a recent search that no longer returns results, they see the empty state. The recent entry is NOT auto-pruned; the user can clear it via the existing localStorage entry edit (no UI for v1; future polish).
- **Hero block height growth:** in active state with many results, the hero card grows because `.search-hero-results` has `max-height: 60vh; overflow-y: auto`. The dashboard is hidden, so the page total height stays manageable. The screen-card's outer scroll handles the case where the input + filter chips + count + 60vh of results overflow.

## Risks / open considerations

- **The 4 hardcoded chips may not resonate with every user's corpus.** For a v1 hero, opinionated copy is fine; if data later shows low chip engagement, we can swap to dynamic chips (top-N facets from `archi:search:facets`).
- **`⌘K` may conflict with other shortcuts users add later.** Document the keybind, scope it tightly (only fires on Home), and let users override via the host app's keyboard preferences if needed.
- **Recent searches are session-local (per-machine).** No cross-device sync for v1 — acceptable since the rest of Archi state is also local-first.
- **`SearchHero` becomes a moderately large file** (~250 lines including the resting + active layouts + the result virtualization). The plan should consider splitting `SearchHeroResting` and `SearchHeroActive` if the file exceeds ~300 lines once written — but only if natural seams emerge.
- **Removing the content-header search may surprise muscle-memory users.** v1 accepts this; the redesign is intentional. If a follow-up shows the loss is felt, the `⌘K` keybind partially compensates (refocus from anywhere on Home).
