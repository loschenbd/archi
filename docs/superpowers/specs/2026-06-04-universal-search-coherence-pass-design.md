# Universal Search — Coherence Pass (Design)

**Status:** approved design, ready for implementation planning
**Date:** 2026-06-04
**Author:** ben@benjaminloschen.com (with Claude)
**Scope:** Frontend coherence + completeness pass on the universal-search experience after the semantic-search engine and the UI consolidation (Passages → Search) have landed. Touches `apps/desktop/src/renderer/`, with one small `packages/search` snippet change and one preload addition.

**Predecessors:**
- `2026-06-02-local-rag-semantic-search-design.md` — built the engine (sqlite-vec + FTS5 + RRF), the IPC surface, the initial `GlobalSearchBar`, `SearchScreen`, `IndexingBanner`.
- `2026-06-04-ui-consolidation-search-first-design.md` — deleted `PassagesScreen`, reordered sidebar to five entries, added Copy action to `SearchResultCard`, left the `openPassageFromSearch` callback as a deliberate no-op pending a successor decision.

This spec picks up where those leave off.

## 1. Goal

Make the universal-search experience feel **coherent and intentional** — i.e. clicking a result reveals it, the user always knows what corpus they're searching against, the engine's hybrid nature is communicated in-line, and the spec's promised filter / settings surfaces actually exist. Today the engine ships behind a half-built UI; this pass closes that gap without expanding the engine itself.

## 2. Out of scope

- No backend or retrieval-algorithm changes. RRF, sqlite-vec, FTS5, embedder lifecycle — all unchanged.
- No chat / LLM / synthesis. Phase 2.
- No saved searches, search history, smart folders.
- No "Find similar passages" passive surfacing in book detail beyond the existing button (button placement is in scope; recommendation engine isn't).
- No new embedding model.
- No internationalization.
- No new electron-builder / packaging changes.

## 3. Audit summary (what's broken / missing today)

For context, the issues this spec resolves:

| # | Symptom | Root file |
|---|---|---|
| 1 | Result clicks don't reveal the passage anywhere — `openPassageFromSearch` ignores the passage ID and just navigates to Search | `App.tsx:550` |
| 2 | Indexer state is mounted *inside* `SearchScreen`; users on Home/Library can't see indexing in flight | `SearchScreen.tsx:125` |
| 3 | `snippet: body` — no FTS5 `snippet()` call, no `<mark>` highlights; the matching CSS rule is dead | `searchService.ts:178`, `styles.css:2305` |
| 4 | NotionScreen still claims it auto-creates a "Passages" database | `NotionScreen.tsx:10` |
| 5 | Filter chips: only Author, Starred, Color — spec promised Book, Date range, Quote label, Work type | `SearchFilterChips.tsx` |
| 6 | No Settings surface for `showMatchSource`, `includeArchived`, `includeHidden` (hardcoded, unreachable) | `SearchScreen.tsx:20` |
| 7 | `FindSimilarButton.tsx` is used in book-detail (as of commit `99ac46b`) but the result card still reimplements the action inline with a different icon and no length cap | `SearchResultCard.tsx:94`, `FindSimilarButton.tsx` |
| 8 | Dropdown has no zero-state for "no matches" | `GlobalSearchBar.tsx:81` |
| 9 | After ⌘↵ escalation, the global bar still shows the previous query | `GlobalSearchBar.tsx` |
| 10 | No direct keyboard shortcut to land on the Search screen | `App.tsx` |
| 11 | `SearchScreen` re-mount via key bump (`searchScreenInstance`) — blows focus, restarts debounce | `App.tsx:200` |
| 12 | `SearchResultCard` is `role="button"` wrapping inner `<button>`s — bad accessibility | `SearchResultCard.tsx:40` |
| 13 | `IndexingBanner` polls every 2s forever while Search screen is mounted; would multiply if other consumers added | `IndexingBanner.tsx` |

## 4. Architecture overview

Three small architectural shifts. Everything else is component-local.

### 4.1 IndexerStatus becomes a shared context

Today, `IndexingBanner` polls in its own `useEffect` and is the only consumer of `indexerStatus`. Moving forward there are three consumers: the sidebar pill (new), the in-Search-screen banner (existing), and the dropdown "results may be partial" hint (new — see §6.4). We add a single `IndexerStatusProvider` at the app root that polls once and exposes `useIndexerStatus()`. Components subscribe via the hook. Net effect: one polling timer, three subscribers.

The provider also exposes `start()` (calls `window.archi.search.startIndexing()`) so the sidebar pill and any future surfaces can trigger backfill without re-implementing the call.

### 4.2 Result reveal: inline expand

Today the result card is `role="button"` whose onClick navigates to a screen that doesn't yet know how to show the passage. Moving forward:

- Card click → toggles the card's expanded state. Expanded card shows: full body (no truncation), reader note, position, marked date, full action row (Find similar / Open book / Copy), and `Esc` collapses it.
- Collapsed card: header line (author · title · position · match-source pill) + 3-line snippet (with `<mark>` highlights) + footer (marked date).
- Only one card is expanded at a time per Search screen instance; expanding card B collapses card A.
- Dropdown row click on the `GlobalSearchBar` opens the Search screen with the result auto-expanded and scrolled into view. Other results above/below are visible collapsed.
- "Open book" action navigates to `LibraryBookDetailScreen`, scrolls to the matched passage, and rings the passage card for ~1.5s (animated `box-shadow` pulse). That's the path for "see this in context."

This satisfies the "click reveals the passage" expectation without standing up a new drawer component or jumping the user out of the search context.

### 4.3 Settings screen as 6th sidebar entry

Adds a top-level `Settings` screen. Search section is what this spec needs; the IA itself is provisioned so future Sync / Notifications panes have a home.

```
Settings
├── Search
│   ├── Show match-source labels  [✓]
│   ├── Include archived passages [ ]
│   ├── Include hidden passages   [ ]
│   ├── ─────
│   └── Index: 3,141 / 3,141 · bge-small-en-v1.5
│       [Rebuild index — dev only, hidden behind ⌥ click]
└── (future panes: Sync, Notifications)
```

Settings persist via the existing `window.archi.preferences.get/set` IPC (already plumbed in preload at `index.ts:209-213`) under the namespace `search.*`. The `SearchScreen` reads these on mount through the new `useSearchPreferences()` hook and merges them into outgoing `SearchFilters`.

## 5. Data flow

```
┌─ App.tsx ──────────────────────────────────────────────────────────────┐
│  <IndexerStatusProvider>                                                │
│    <SearchPreferencesProvider>                                          │
│      <Sidebar>                                                          │
│        ... 6 nav items ...                                              │
│        <IndexerStatusPill />  ◄── subscribes to IndexerStatus           │
│      </Sidebar>                                                         │
│      <Content>                                                          │
│        <Header>                                                         │
│          <GlobalSearchBar />                                            │
│        </Header>                                                        │
│        <Screen />  // Home | Library | Search | Connections | Logs |    │
│      </Content>     //          Settings                                │
│    </SearchPreferencesProvider>                                         │
│  </IndexerStatusProvider>                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

`SearchScreen` and `GlobalSearchBar` both pass `usePreferences()` values into the `SearchQuery.filters` object. The IPC contract doesn't change — we just always send `isArchived` and `isHidden` explicitly (today they're undefined and the server defaults to false; that stays the default).

## 6. Component-by-component changes

### 6.1 Sidebar — new `IndexerStatusPill`

New component, rendered in `App.tsx` aside between `sidebar-divider` and `SupportButton`. Subscribes to `useIndexerStatus()`. Renders:

| Status | Pill |
|---|---|
| `idle && indexed >= total` | Hidden (collapsed sidebar shows a tiny ✓ for 4s after transition, then nothing) |
| `idle && indexed < total` | `⚠ N pending` (clickable → calls `start()`) |
| `running` | `⚫ Indexing N / M` (spinner) |
| `failed` | `⚠ Indexing failed` (title attribute shows `lastError`) |
| `unavailable` | `⚠ Search degraded` (title: "Vector search unavailable. Keyword still works.") |

Collapsed sidebar (`.sidebar-collapsed`) shows only an icon; full text via `title=` attribute.

Removes the `IndexingBanner`'s own polling logic — it now consumes `useIndexerStatus()` too. The on-screen banner inside `SearchScreen` stays for the "results may be partial" job from within Search.

### 6.2 `App.tsx` — wire up reveal and remove the re-mount hack

- Delete `searchScreenInstance` state and key bump.
- Replace `openPassageFromSearch` with `openSearchScreenForPassage(passageId, query?)` that:
  - Pushes the passage ID into a `SearchScreen` prop `pendingExpandPassageId`.
  - Optionally seeds the query.
  - Sets `activeScreen` to `"Search"`.
- Add `openBookAtPassage(workId, passageId)` callback for the "Open book" action: sets `selectedLibraryWorkId`, sets a `pendingScrollPassageId` prop on `LibraryBookDetailScreen`, switches screen to Library.
- Add `breadcrumbFromSearch` boolean set when arriving at Library via `openBookAtPassage` — drives the "‹ Back to search" affordance in `LibraryBookDetailScreen` header.
- Add ⌘/ (Cmd+Slash) shortcut to jump straight to Search screen (focuses the in-screen input, not the global bar).
- Add ⌘, (Cmd+Comma) shortcut to open Settings.

### 6.3 `SearchScreen.tsx`

- Replace the re-mount key trick with: read `initialQuery` and `pendingExpandPassageId` as controlled props, update internal state via `useEffect` when they change.
- Read `useSearchPreferences()`; merge `showMatchSource`, `includeArchived`, `includeHidden` into the rendered card props and the outgoing query filters.
- Track one `expandedId: string | null` in state. Card click toggles it. `Esc` clears it. `pendingExpandPassageId` sets it on prop change. Auto-`scrollIntoView({block: "center"})` on expand.
- Add empty-state when `response?.results.length === 0`: helper buttons "Remove all filters" (if any filter is active) and "Clear query."
- Replace `availableCreators` heuristic. Add a dedicated `window.archi.search.facets()` IPC (see §6.7) so we don't load 200 passages just to derive a creator list.

### 6.4 `GlobalSearchBar.tsx`

- After `⌘↵` escalation, clear the input text. The Search screen owns the query thereafter; the global bar empties out and the dropdown closes.
- Empty results state in the dropdown: a single row reading "No matches. Press ⌘↵ to open Search." that on click does the escalate.
- When `useIndexerStatus()` reports `running` or `indexed < total`, prepend a single muted-grey line "Results may be partial — N / M indexed" above the result rows. Hidden when idle and complete.
- Replace `onBlur` setTimeout dropdown-close hack with a proper outside-click handler (`mousedown` on document, checks `event.target` against the bar's ref).
- Refactor the bar's props from two callbacks (`onOpenPassage`, `onOpenSearchScreen`) to one: `onEscalate(query: string, expandPassageId?: string): void`. Result row click calls it with the passage id; "See all results" / ⌘↵ calls it without. App.tsx implements the callback as a single `openSearchScreenForPassage(query, passageId?)` (see §6.2).

### 6.5 `SearchResultCard.tsx`

- Drop `role="button"` and the `onKeyDown` keypress handler from the article element. The clickable affordance becomes an explicit `<button class="search-result-card__expand-toggle" aria-expanded=… aria-controls=…>` overlaid on the header row (visually invisible — full-card target stays but semantics improve).
- Accept `expanded: boolean` and `onToggle: () => void` props from `SearchScreen`. Collapsed = current visual, with body line-clamped to 3 lines via CSS (already styled at `styles.css:2547` for the dropdown; replicate for cards). Expanded = full body + actions visible without hover-reveal.
- Render snippet through a `<HighlightedText snippet={...} />` helper that parses `<mark>` and `</mark>` and emits `<mark>` React elements — never `dangerouslySetInnerHTML`.
- Consume `FindSimilarButton` (already used in book-detail per `99ac46b`) for the "Find similar" action — single source of truth for the 240-char cap and tooltip. Removes the inline reimplementation at `SearchResultCard.tsx:91-99`.
- Match-source pill only renders when `showMatchSource` preference is true.

### 6.6 `SearchFilterChips.tsx` — fill in the missing dimensions

Add three new chip types and rework the menu:

| Chip | Filter key | Input UI |
|---|---|---|
| Author (existing) | `creator` | Existing select |
| Book (new) | `workIds: [oneId]` | Searchable popover listing works alphabetically, with cover thumbnail |
| Starred (existing) | `isStarred = true` | Toggle on / off (no select) |
| Marker color (existing) | `markerColor` | Existing select |
| Quote label (new) | `labels: [one or more]` | Multi-select chip-of-chips |
| Date range (new) | `markedAfter`/`markedBefore` | Two native `<input type="date">` inputs in a popover |

`Work type` deferred — Archi only has books today; revisit when a non-book work type ships.

The "+ Add filter" button becomes a popover (not the inline pill-row hack). Each filter dimension is one row. Selecting a dimension that's already active highlights its existing chip rather than adding another. Popover dismisses on outside click + `Esc`.

### 6.7 `packages/search` — small additions

- `searchService.ts` line 178 (`snippet: body`): replace with FTS5 `snippet()` output for `matchedVia === 'fts5' || 'both'` (use `snippet(passages_fts, 0, '<mark>', '</mark>', '…', 32)`); for `matchedVia === 'vector'`, return `body.slice(0, 220)` with a trailing `…` if truncated.
- Add `getFacets()` repository method returning `{ creators: string[]; labels: string[] }` for the chip menu. Replaces the wasteful `query({ text: "", limit: 200 })` round-trip in `SearchScreen`.
- Expose via IPC: `archi:search:facets` invoke → `Promise<{ creators: string[]; labels: string[] }>`.

### 6.8 `NotionScreen.tsx`

Rewrite the line at `NotionScreen.tsx:10` to remove the stale "Passages" reference. New text:

> "On first run, Archi auto-creates your Library database in Notion and syncs your highlights as related entries."

### 6.9 `LibraryBookDetailScreen.tsx`

- Per-row Find similar + Copy actions already shipped in `99ac46b`. Not in scope for this pass; do not touch.
- Accept new prop `pendingScrollPassageId?: string`.
- On mount (and whenever `pendingScrollPassageId` changes to a non-null value present in `passages`), `scrollIntoView({block: "center"})` the matching `library-quote-card` and apply a `library-quote-card--ringed` class for 1500 ms, then remove it. (CSS keyframe — define one.)
- When the `breadcrumbFromSearch` prop is true (passed through from App), render a "‹ Back to search" affordance in the existing content-eyebrow slot.

## 7. Snippet/highlight rendering

The renderer never uses `dangerouslySetInnerHTML`. Implementation of `HighlightedText`:

```tsx
function HighlightedText({ snippet }: { snippet: string }): JSX.Element {
  const parts = snippet.split(/(<mark>.*?<\/mark>)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("<mark>") ? (
          <mark key={i}>{part.slice(6, -7)}</mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}
```

FTS5's `snippet()` output is constrained — it can't contain user-injected HTML because:
1. The input column `body` is the source text; FTS5 only wraps matched tokens in the delimiters we choose.
2. We choose `<mark>` / `</mark>` as delimiters and they don't appear in raw passage bodies (passages are Kindle highlights — plain text).

Even so, the split-and-emit approach above is safer than `dangerouslySetInnerHTML` and gives React full control over the DOM tree.

## 8. Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘K` (existing) | Focus global bar, open dropdown |
| `⌘↵` (existing, behavior tweaked) | Escalate global bar query to Search screen, then clear global bar |
| `⌘/` (new) | Jump to Search screen, focus its in-screen input |
| `⌘,` (new) | Open Settings screen |
| `↑`/`↓` (existing) | Navigate dropdown rows |
| `↵` (existing) | Open highlighted dropdown row (now: navigate to Search with that result auto-expanded) |
| `Esc` (existing + extended) | Close dropdown; on Search screen, collapse the expanded card |

## 9. Settings screen

`SettingsScreen.tsx` (new). Single-pane layout for now: a "Search" section, with future panes placeholdered as headings only (no implementation).

```tsx
<section className="settings-screen">
  <header><h2>Search</h2></header>
  <SettingsRow
    label="Show match-source labels"
    description="Show whether each result matched by meaning, keyword, or both."
    control={<Toggle value={showMatchSource} onChange={setShowMatchSource} />}
  />
  <SettingsRow
    label="Include archived passages"
    description="Off by default. Turning this on adds archived highlights to all search results."
    control={<Toggle value={includeArchived} onChange={setIncludeArchived} />}
  />
  <SettingsRow
    label="Include hidden passages"
    description="Off by default."
    control={<Toggle value={includeHidden} onChange={setIncludeHidden} />}
  />
  <hr />
  <IndexStatusBlock />  // shows X / Y indexed, model id, last indexed time
</section>
```

Persistence: `window.archi.preferences.set("search.showMatchSource", true)`, etc. `SearchPreferencesProvider` reads all three keys on mount, exposes them via context, and writes on change.

## 10. Accessibility

- `SearchResultCard` becomes an `<article>` (no implicit semantics). An overlay `<button>` inside takes the click target and has `aria-expanded` + `aria-controls`.
- Action buttons inside the card remain explicit `<button>`s — their event handlers already `stopPropagation` so the outer expand toggle doesn't fire.
- `IndexerStatusPill` is announced via `aria-live="polite"` for status transitions (idle → running, running → done, → failed). Spec value avoid noisy: only re-announce when status string changes, not on each tick.
- Settings toggles use `<button role="switch" aria-checked>` pattern.
- The sidebar focus order doesn't change.

## 11. Testing strategy

### 11.1 Unit (`packages/search/tests/`)

- `searchService.test.ts`: snippet output for vector-only result returns first 220 chars; FTS5-matched result returns `<mark>`-wrapped output.
- `searchService.test.ts`: `getFacets()` returns deduped sorted creators and labels.

### 11.2 Renderer (no harness exists today — manual)

Manual scenarios:

1. Type "anger" in global bar → dropdown shows results; click row → Search screen opens, that row's card is expanded and scrolled to.
2. On Search screen, click a collapsed card → expands inline; click another → first collapses, second expands.
3. Click "Open book" in an expanded card → Library detail opens, scrolls to passage, passage rings ~1.5s. Header shows "‹ Back to search" — clicking returns to Search with prior state.
4. From Home, sidebar pill is hidden after first full sync; trigger a small new sync → pill briefly shows running.
5. ⌘/ jumps to Search and focuses its input. ⌘, jumps to Settings.
6. In Settings, toggle "Include archived" → Search query returns archived rows immediately on next character typed.
7. Type rare term "xyzqq" → dropdown shows "No matches. Press ⌘↵ to open Search."; press ⌘↵ → Search opens with `text="xyzqq"` and shows the screen's own empty state with action buttons.
8. After ⌘↵ escalation, the global bar text clears; the dropdown closes.
9. Search screen filter chip "+ Add filter" → popover shows 6 dimensions; pick Date range → two date inputs; set range → results filter; chip shows "Mar 2024 – present" summary.
10. Result card snippet contains `<mark>` highlights for keyword matches; no literal `<mark>` text visible.
11. Screen reader (VoiceOver) reads result card as "Article. Toggle button: expand. Marcus Aurelius, Meditations, location 88. Match-source: meaning." — not as a single mega-button.
12. Indexer pill on sidebar: kill the embedder process mid-tick → status flips to `failed`; pill title attribute exposes the error string.

### 11.3 Regression (existing functionality)

- Sync flow unaffected.
- Library detail behavior unchanged when not arrived via search (no breadcrumb, no scroll target).
- Onboarding unaffected.

## 12. Performance

| Path | Budget | Notes |
|---|---|---|
| Sidebar pill subscription overhead | Single 2 s timer for whole app | Replaces 1+N timers per consumer |
| `<HighlightedText>` parse | <0.1 ms per card | Single regex split, ≤5 segments typical |
| Inline expand layout shift | Sticky scroll-into-view at center; no reflow elsewhere | CSS grid handles it cleanly |
| Scroll-to-passage on book detail | One `scrollIntoView` call after `passages` array hydrated | Will be fast at <10k passages per book |
| Settings IPC round-trips | 3 reads on mount, 1 write per toggle | Negligible |

## 13. Risks

| Risk | Mitigation |
|---|---|
| FTS5 `snippet()` token offset can place `<mark>` boundaries inside a multibyte sequence | unicode61 tokenizer respects codepoint boundaries; tested in `packages/search` already. |
| Inline expand grows the result list height unpredictably; users lose track | Single-expand-at-a-time policy; scrollIntoView centers the expanded card. |
| "Open book" + ring pulse looks janky on slow Library loads | Ring class application is on the passage card DOM node, not the screen — applies after `passages` hydrates, before pulse animation. If hydration is slow we still pulse; user sees the right thing once loaded. |
| Filter chip popover competes for screen real estate with the search results below | Popover anchors to "+ Add filter" button, max-height 380 px, scrolls internally. |
| Settings screen IA opens a door we'll regret (users expect MORE settings) | Settings remains a one-pane screen with explicit "more coming" eyebrow. No infinite IA. |
| Indexer pill always-visible at top of sidebar nag | Hidden entirely when `idle && indexed >= total`. Reappears only when state genuinely changes. |
| Removing the SearchScreen re-mount hack could lose state on "Find similar" because the input doesn't reset | Controlled prop pattern: when `initialQuery` changes, `useEffect` calls `setText(initialQuery)`, which propagates through the debounced query effect. Tested via scenario 1 + 7 above. |

## 14. Migration & first-run experience

No data migration. No DB schema change. No native dep change.

Existing users see:
- Sidebar gains a "Settings" entry (between Logs and the divider).
- Sidebar pill appears briefly while any pending passages re-index from §6.7's snippet change (no, the snippet change is presentation-only — embeddings don't need to re-run).
- On first open of Search after upgrade, the existing query box behaves as before; clicking a result reveals the passage inline (new). Existing keyboard shortcuts continue to work.

## 15. Future considerations (deferred)

For the record:

1. **In-book search** in `LibraryBookDetailScreen` — local FTS5 scoped to one work.
2. **"Recently viewed highlights"** Home-screen surface.
3. **Saved searches / smart folders** for power users.
4. **Cross-encoder re-ranking** if hybrid retrieval quality drifts.
5. **NL filter extraction** ("show me aurelius on anger" → auto-apply creator chip).
6. **More Settings panes** (Sync cadence, Notion destination config UI, Notifications).

## 16. Open questions

- The `breadcrumbFromSearch` prop will reset to false when the user navigates anywhere else; should "‹ Back to search" survive a single intermediate navigation (e.g. Library → Connections → Library)? Default: no, it's transient. If users complain, persist via the App state until they leave Library.
- Should ⌘/ also work inside Library (skip the navigation and just focus the global bar)? Default: yes, ⌘/ always goes to Search screen — predictable beats clever.
- Search settings: should "Include archived" affect the dropdown too, or only the full Search screen? Default: both, for consistency.

---

**Approved direction:** ship coherence + completeness without expanding the engine. Click reveals the passage. Indexer state is visible app-wide. Filters, settings, and accessibility match the original spec's intent. Polish items (escalation clear, dropdown empty state, keyboard shortcuts) batched into the same pass since they're tiny once we're in the file.
