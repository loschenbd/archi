# Search + Homepage Integration — Design

**Date:** 2026-06-05
**Status:** Approved (brainstorming → ready for implementation plan)

## Goal

Integrate the just-merged homepage redesign (`main`) with the local semantic search work (`worktree-local-semantic-search`, 26 commits ahead of pre-redesign main). Result: a search-first reading dashboard where Home's existing content-header search becomes the only entry point for hybrid (vec0 KNN + FTS5 + RRF) semantic search, with results rendering inline on Home; Library absorbs the old Passages screen as a sub-tab; Settings gains a Search tab alongside Connections and Logs.

## Non-goals

- No top-level Search route. The semantic-search branch's `SearchScreen.tsx` is folded into Home.
- No `GlobalSearchBar` component. The homepage redesign's content-header search input becomes the single search surface.
- No `IndexerStatusPill` sidebar item. Indexer progress surfaces inside the existing `SyncBanner`.
- No new IPC. The semantic-search branch's `archi:search:*` channels stay; the homepage redesign's `workId` field on `listRecentActivity` stays; nothing else changes.
- No persisted state for the new Library sub-toggle (defaults to "By book" each session).
- No work on the search packages, the v3 DB migration, the embedding service, the indexer, the RRF, or `SearchResultCard` / `HighlightedText` / `SearchFilterChips` component internals — these land as-is from the semantic-search branch.
- No redesign of the connection adapters, the Notion sync, or the cloud-notebook pipeline.

## Information architecture & navigation

**Sidebar (was 4 items after homepage redesign; now 3):**

1. **Home** — house icon (unchanged)
2. **Library** — book icon (unchanged), gains an internal `By book | All highlights` sub-toggle
3. **Settings** — gear icon, gains a third tab (`Search`)

`Passages` is removed as a top-level route. Its rendering moves into Library's "All highlights" tab. The semantic-search branch's `SearchScreen` is not promoted to a sidebar item — search is Home-only.

The Support button and collapse toggle remain at the bottom of the sidebar. The Settings warning-dot indicator from the homepage redesign carries over unchanged. The semantic-search branch's `IndexerStatusPill` is removed.

`App.tsx`:

```ts
const screens = ["Home", "Library", "Settings"] as const;
```

Post-onboarding navigation continues to land users on Settings → Connections (per the homepage redesign).

## Cross-screen chrome

**Content header** stays App-owned. `Workspace / <activeScreen>` left, Home-only search input right (the `.content-header-search` introduced by the homepage redesign).

The content-header search input is now a hybrid search input: it dispatches `window.archi.search.query({ text, filters, ... })` instead of the substring filter. Debounced at 150ms (matching the semantic-search branch's `SearchScreen` pattern). Esc still clears.

When `activeScreen !== "Home"` the search input is not rendered (same as the homepage redesign).

## Home

### Resting state (no query)

Unchanged from the homepage redesign:

1. SyncBanner (conditional; states extended below)
2. StatsStrip (`N books · M highlights · synced X ago · Sync now`)
3. BooksRail (recently added)
4. highlights-split (`RandomHighlight` + `LatestHighlights`)

### Active search state (header input has trimmed query)

Modules 2–4 collapse. In their place renders a new `HomeSearchResults` body. Banner remains visible above.

Structure top → bottom:

1. **Filter chips row** — the semantic-search branch's `SearchFilterChips` component (Book, Date, Label/Starred selectors as multi-select popovers). State: `homeSearchFilters` lives in `App.tsx`, passes through `HomeScreen` to `HomeSearchResults`. Chips render between content-header and result list.
2. **Counts line** — `N keyword · M vector · P combined` when `showMatchSourceLabels` preference is on; otherwise `N results`.
3. **Result list** — virtualized vertical list using `useVirtualizer` (already imported by the homepage redesign's `HomeSearchResults`). Each row is a `SearchResultCard`:
   - `HighlightedText` snippet rendering
   - Match-source badge (KEYWORD / VECTOR / BOTH) — visible only when preference is on
   - Attribution (book title, creator)
   - Inline expand-on-click (single-expand model from the semantic-search branch)
   - Row actions: **Copy** (writes passage body to clipboard), **Open book** (calls `onOpenWork(workId)`), **Find similar** (escalates — see below)

### "Find similar" behavior

Click on a card's "Find similar" action:
- Header search input switches to a sentinel display label: `Similar to "<truncated body excerpt>"`.
- A `findSimilarPassageId` state is set on `App.tsx`; passed through to `HomeSearchResults`.
- The search IPC call switches mode: `window.archi.search.query({ findSimilarPassageId, filters, excludeIds: [findSimilarPassageId] })`.
- The semantic-search branch's `searchModule.ts` already supports this lookup path; if not, the implementation plan calls out the small IPC extension needed.
- Esc clears both the sentinel and `findSimilarPassageId`, restoring the previous query (or going back to resting Home if there was no prior query).

### Sync banner — extended states

Existing states from the homepage redesign: hidden / running / cancelling / no-healthy-sources / needs-auth / failed.

**New state: `indexing`.** Inserts between Running and NoHealthySources in priority order, so when sync isn't actively running but indexing is, the user sees indexing progress; warnings still take precedence when indexing is idle.

Final priority (matching the actual code order, where Cancelling short-circuits Running because both `isSyncing` and `isCancelingSync` are true during a cancel): `Cancelling > Running > Indexing > NoHealthySources > NeedsAuth > Failed > Hidden`.

Indexing banner content (accent color, same visual weight as Running):
- Left: `● Indexing your library · <indexed>/<total> highlights`
- Right: `Re-index` link (calls `archi:search:startIndexing` — same handler as the Settings tab button)

`SyncBanner`'s props gain `indexerStatus: { status: "idle" | "running"; indexed: number; total: number }` sourced from `IndexerStatusContext` (lifted up — see Providers below).

## Library

Existing `LibraryScreen.tsx` and `LibraryBookDetailScreen.tsx` flows are preserved. The semantic-search branch's `pendingScrollPassageId` scroll-to-and-ring behavior in `LibraryBookDetailScreen` lands as-is.

New: a peer sub-toggle below the content-header (same `.settings-tabs` aesthetic):

- **`By book`** (default) — existing book grid + title filter input + book detail navigation.
- **`All highlights`** — the previously-removed `PassagesScreen` markup, lifted back as a tab panel under a new component path `screens/library/LibraryAllHighlights.tsx`. Virtualized list of every passage, with the existing substring filter input. Click → `onOpenWork(workId)` (which routes to Library → By book → book detail).

Sub-toggle state lives in `LibraryScreen.tsx` as a local `useState<"by-book" | "all-highlights">("by-book")`. No persistence across sessions for v1.

`PassagesScreen.tsx` is fully removed (it was already removed on the semantic-search branch). Its content is recovered from the homepage redesign's main-branch version and adapted as the new `LibraryAllHighlights.tsx`.

## Settings

`SettingsScreen.tsx` gets a third tab. Final shape:

- **Connections** tab — existing `ConnectionsScreen` body (unchanged from homepage redesign).
- **Logs** tab — existing `LogsScreen` body (unchanged from homepage redesign).
- **Search** tab — the semantic-search branch's Search section, lifted in as a tab panel:
  - Toggle: "Show match-source labels" (drives the KEYWORD/VECTOR/BOTH badge visibility)
  - Toggle: "Include archived passages"
  - Toggle: "Include hidden passages"
  - "Index status" pane: `<indexed> of <total> indexed · model bge-small-en-v1.5@v1`, with a `Re-index now` button calling `archi:search:startIndexing`.

The uncommitted `SettingsScreen.tsx` workaround from the semantic-search branch (inlining `EMBEDDING_MODEL_ID = "bge-small-en-v1.5@v1"` because the `@archi/search` barrel imports `node:fs` paths via `embedding/modelPaths.ts`, which Vite stubs in the renderer bundle) lands as committed code. A two-line comment explains the constraint so future contributors don't try to undo the duplication.

Default Active Tab continues to be Connections. The `banner click → Settings · Connections | Logs` semantic from the homepage redesign carries forward; no banner currently routes into the Search tab.

**Settings tab ARIA polish** — the homepage redesign's open follow-up FU-1 (settings tabs missing `aria-controls`/`aria-labelledby`/arrow-key navigation) gets bundled into this work since we're already touching the tabs. The 3-tab structure ships with `aria-controls` linkage, `aria-labelledby` on the panel, and `ArrowLeft`/`ArrowRight` keyboard nav between tabs.

## State providers

The semantic-search branch's two context providers move up to wrap `<App>`:

```tsx
<UpdateBanner />
<SearchPreferencesProvider>
  <IndexerStatusProvider>
    <main className={`layout${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      …
    </main>
  </IndexerStatusProvider>
</SearchPreferencesProvider>
<SupportPromptModal … />
```

`SearchPreferencesContext` consumers: Settings → Search tab (controlled), `HomeSearchResults` (read-only for match-source label visibility).

`IndexerStatusContext` consumers: Settings → Search tab (status pane), `SyncBanner` (indexing-state derivation). The provider polls `archi:search:indexerStatus` on the same cadence the semantic-search branch already established.

## Going away

These components and routes from the semantic-search branch do **not** ship in the merged form:

- `apps/desktop/src/renderer/screens/SearchScreen.tsx` — folded into `HomeSearchResults`
- `apps/desktop/src/renderer/components/GlobalSearchBar.tsx` — the content-header search input from the homepage redesign replaces its role
- `apps/desktop/src/renderer/components/IndexingBanner.tsx` — its role moves into `SyncBanner`'s new indexing state
- `apps/desktop/src/renderer/components/IndexerStatusPill.tsx` (sidebar pill) — removed; Settings + SyncBanner cover ambient awareness
- Their `App.tsx` routing for `Search` and the standalone `Connections` / `Logs` top-level entries — superseded by the homepage redesign's 3-item sidebar with Connections + Logs inside Settings

## Surviving as-is from the semantic-search branch

These land unchanged:

- `packages/search/*` — embedding service, indexer, RRF, search service, repository, types, tests
- `packages/core/src/db/migrations.ts` v3 migration (FTS5 + vec0 + sync triggers)
- `packages/core/tests/migration-v3.test.ts`
- `apps/desktop/src/main/searchModule.ts` — IPC registration for `archi:search:query`, `archi:search:indexerStatus`, `archi:search:startIndexing`, `archi:search:facets`
- `apps/desktop/src/main/index.ts` — the bits that wire `searchModule.ts` into `app.whenReady().then(…)`
- `apps/desktop/src/renderer/state/SearchPreferencesContext.tsx`
- `apps/desktop/src/renderer/state/IndexerStatusContext.tsx`
- `apps/desktop/src/renderer/components/HighlightedText.tsx`
- `apps/desktop/src/renderer/components/SearchResultCard.tsx`
- `apps/desktop/src/renderer/components/SearchFilterChips.tsx`
- `apps/desktop/src/renderer/screens/LibraryBookDetailScreen.tsx` — their `pendingScrollPassageId` scroll-and-ring behavior
- `apps/desktop/src/renderer/screens/NotionScreen.tsx` — their "single Library DB language" copy fix
- The "Copy" + "Find similar" row actions on book-detail rows (their spec §4.2)
- pnpm-lock.yaml additions for the new `packages/search` workspace

## Surviving as-is from the homepage redesign (main)

- All home-dashboard modules (`StatsStrip`, `BooksRail`, `RandomHighlight`, `LatestHighlights`)
- `SyncBanner` (extended with the indexing state)
- `HomeSearchResults`'s virtualization + match-highlighting plumbing
- Settings shell + Connections + Logs tab content
- `home/utils.tsx` shared helpers
- `App.tsx`'s sidebar-warning-dot, content-header layout, post-onboarding routing
- `main/index.ts`'s `workId` field on `listRecentActivity` (kept; `LatestHighlights` and `SearchResultCard` both depend on it)
- `main/index.ts`'s `clearStaleNeedsAuthIfResolved` helper from the WIP baseline (semantic-search branch doesn't have it; merged version keeps it)

## Integration strategy

The branches are too divergent for a clean per-commit rebase (26 commits + ~9.5k inserts vs 14 commits + ~2.3k inserts, structural overlap on `App.tsx`, `SettingsScreen.tsx`, `styles.css`, `main/index.ts`). Instead:

1. **Commit the uncommitted workaround** in the worktree with a clear message: `tooling: inline EMBEDDING_MODEL_ID in SettingsScreen (Vite stubs node:fs from @archi/search barrel)`. Establish a recovery tag at the resulting HEAD.
2. **Merge `main` into the worktree's branch** (`git merge main` from the worktree). This brings the homepage redesign into the semantic-search branch as a single merge commit.
3. **Resolve conflicts** file by file. Predicted conflicts:
   - `apps/desktop/src/renderer/App.tsx`
   - `apps/desktop/src/renderer/screens/SettingsScreen.tsx` (both-added)
   - `apps/desktop/src/renderer/screens/HomeScreen.tsx`
   - `apps/desktop/src/renderer/styles.css`
   - `apps/desktop/src/main/index.ts`
   - `apps/desktop/src/preload/index.ts` (likely)
   - `pnpm-lock.yaml` (regenerate via `pnpm install`)
4. **Apply post-merge file work** to materialize the merged design (sidebar reshuffle, Library tabs, Settings third tab, HomeSearchResults upgrade, SyncBanner indexing state, provider wrapping, deletions of SearchScreen / GlobalSearchBar / IndexerStatusPill / IndexingBanner).
5. **Verify** typecheck + lint + existing tests pass, then manual UI walkthrough.
6. **Fast-forward `main`** to the integration HEAD once the user signs off after manual verification.

## Data flow

No IPC additions. Inputs to each new/changed component:

| Component | Inputs |
|---|---|
| `HomeSearchResults` | `query`, `filters`, `findSimilarPassageId`, `onOpenWork`, `onFindSimilar(passage)`, `onCopy(passage)`. Calls `archi:search:query` directly. Consumes `SearchPreferencesContext` for label visibility. |
| `SearchFilterChips` | (lands verbatim from semantic-search branch) |
| `SyncBanner` | (existing props) + `indexerStatus` from `IndexerStatusContext` |
| `LibraryScreen` | Internal `useState` for the sub-toggle. Existing prop shape preserved. |
| `LibraryAllHighlights` | `passages` (from `App.tsx`, same array as today's `PassagesScreen` props), `onOpenWork` |
| `SettingsScreen` | All current Connections + Logs props + new search-tab props (toggles from `SearchPreferencesContext`, indexer status from `IndexerStatusContext`, manual re-index callback) |

`App.tsx` state additions:
- `homeSearchFilters: SearchFilters` (initialized to empty)
- `findSimilarPassageId: string | null`
- The `homeSearchQuery` state from the homepage redesign stays

Deletions from `App.tsx`:
- `selectedPassageId` state if it existed only for `PassagesScreen` navigation (verify during implementation)
- `Passages` route case
- The `passages` prop's role as a top-level screen input — still needed by HomeSearchResults and LibraryAllHighlights, just not as a route argument

## Edge cases / behavioral notes

- **Search active while sync runs:** SyncBanner shows running state at top; HomeSearchResults renders below. No conflict — they're in different vertical regions.
- **Search active while indexing:** SyncBanner shows indexing state; HomeSearchResults still works against the partial index. Result counts reflect indexed coverage.
- **Find Similar from a passage not yet indexed:** falls back to FTS5 only with a small notice line ("Vector match unavailable — this passage hasn't finished indexing").
- **Library "All highlights" tab during sync:** new passages arrive in real time via the existing refresh-on-progress wiring. The substring filter input continues to work.
- **First run (no indexed corpus):** Home header search returns "Indexing… results will appear as your library is processed." Settings → Search tab shows `0 of 4892 indexed` with a Re-index pill. SyncBanner shows the indexing state.
- **Esc behavior in header search:** if `findSimilarPassageId` is set, Esc clears it first (returning to the prior query); if no `findSimilarPassageId`, Esc clears the query entirely (returning to resting Home).
- **Banner-to-Settings nav:** all existing banner click destinations (Connections, Logs) keep their existing routing. The new indexing banner's "Re-index" link does NOT navigate — it fires `archi:search:startIndexing` in place.

## Risks / open considerations

- **Merge conflict surface is broad.** `App.tsx` in particular has been heavily restructured by both branches. The implementation plan should script the merge in small, testable steps with intermediate commits where possible (e.g. merge → resolve conflicts as a first commit; design materialization as a second).
- **SearchPreferencesContext + IndexerStatusContext are renderer-only.** Hoisting them above `<App>` should not introduce SSR concerns (this is an Electron renderer), but the order of providers matters if any of them transitively imports `@archi/search`. The implementation plan must verify the Vite bundle still excludes `node:fs` paths after hoisting.
- **The `SearchScreen.tsx` deletion** means the semantic-search branch's existing `⌘/` refocus shortcut is no longer scoped to a Search screen. We need to either rewire the shortcut to Home's header input, or drop it. Default: rewire to Home header input when `activeScreen === "Home"`; no-op otherwise.
- **"Find similar" requires a search-IPC mode the semantic-search branch may not have fully exposed.** Their `searchService.ts` and `searchRepository.ts` need a quick check during planning to confirm whether `findSimilarPassageId` is a first-class input or if a small extension is required. If extension is needed, it's an explicit plan task (single function in `packages/search`).
- **Indexing-state copy in SyncBanner** assumes `total` is known. Until the first indexer pass enumerates the corpus, total may be 0. The plan must spec the indeterminate-progress fallback.
