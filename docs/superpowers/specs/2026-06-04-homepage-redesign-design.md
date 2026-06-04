# Homepage Redesign — Design

**Date:** 2026-06-04
**Status:** Approved (brainstorming → ready for implementation plan)

## Goal

Reframe the Archi desktop Home screen from an operations console into a **reading dashboard**. Surface what's new in the library at a glance, demote sync into a calm banner, and consolidate the operational screens (Connections, Logs) into a single Settings area.

## Non-goals

- No new IPC, no new persisted data, no new sync behavior.
- No design for a "Preferences" sub-screen inside Settings (theme, auto-update, sync schedule). Settings v1 only holds Connections + Logs.
- No in-header search on Library or Passages screens. The header search input is Home-only for this redesign.
- No changes to `SourcesScreen.tsx` and `NotionScreen.tsx` (currently unused files).
- No redesign of `LibraryScreen`, `LibraryBookDetailScreen`, `PassagesScreen`, or `OnboardingScreen` bodies — only the sidebar wiring around them.

## Information architecture & navigation

**Sidebar top-level items** (was: Home / Connections / Library / Passages / Logs):

1. **Home** — house icon (unchanged)
2. **Library** — book icon (unchanged)
3. **Passages** — quote-mark icon (unchanged)
4. **Settings** — new gear icon (replaces both Connections and Logs as top-level)

The Support button and collapse toggle at the bottom of the sidebar remain unchanged.

`screens` tuple in `App.tsx`:

```ts
const screens = ["Home", "Library", "Passages", "Settings"] as const;
```

`screenIcons.Settings` is a new gear SVG matching the existing icon system (16×16 viewBox, 1.5 stroke, `currentColor`, rounded line caps/joins). Six gear teeth + center circle.

**Sidebar status indicator:** the Settings gear button shows a small absolute-positioned warning dot in its top-right corner whenever any connection's `status === "needs_action"` *or* `syncState.lastError` is non-null. The dot is visible whether the user is on Home or not, so they don't lose awareness of warnings when away from Home. The dot is hidden whenever `isSyncing === true` (a run in progress is the user's primary signal; the dot reappears after the run ends if the condition still holds).

## Settings screen

New file `apps/desktop/src/renderer/screens/SettingsScreen.tsx`. Single screen that hosts a two-tab sub-nav:

- **Connections** tab — renders the existing `ConnectionsScreen` body
- **Logs** tab — renders the existing `LogsScreen` body

The default active tab is `Connections`. Active tab is local state inside `SettingsScreen` (`useState<"connections" | "logs">("connections")`). Tab buttons use the existing eyebrow-link/accent-underline aesthetic.

When a sync banner click hands off to Settings, it passes a `defaultTab` prop so the user lands on the right pane (banner "Notion needs reconnect" → `defaultTab: "connections"`; banner "Last sync failed: Details" → `defaultTab: "logs"`).

`ConnectionsScreen` and `LogsScreen` are refactored from "top-level screens" into pure presentational components. They keep their existing prop shapes; `App.tsx` still owns all the connection callbacks and log state. The only change to those two files is removing any assumption that they are the outermost element on the page (e.g. the `screen-intro` header in `LogsScreen` may need a small style tweak to nest cleanly inside a tab panel — done in `styles.css`, not by changing logic).

## Home dashboard

The Home screen lives inside the existing `.screen-card` host. Top-to-bottom:

### 1. Sync banner (conditional)

Full-width slab above the existing `content-header`. Hidden when sync is idle and all sources are healthy and there's no `lastError`. Six states, one at a time, priority: **Running > Cancelling > NoHealthySources > NeedsAuth > Failed > Hidden**.

| State | Trigger | Color | Left content | Right content |
|---|---|---|---|---|
| Running | `isSyncing === true` | terracotta (accent) | `● Syncing your library · <phase label> · <elapsed>` | `<processed>/<total>` · `Cancel` |
| Cancelling | `isCancelingSync === true` | muted accent | `Cancelling sync…` | spinner |
| NoHealthySources | per existing sync-pause spec — no source can run | amber | `No connected sources — set one up to start syncing` | `Open Settings → Connections` |
| NeedsAuth | any `connection.status === "needs_action"` | amber | `⚠ <label> needs reconnect` (first failing source) | `Fix → Settings · Connections` |
| Failed | `syncState.lastError` non-null and idle | red | `Last sync failed: <truncated error, max 80 chars>` | `Try again` (calls `runSyncNow`) · `Details → Settings · Logs` |

- Banner height ≈ 32–40px plus a 3px progress strip at the bottom edge (Running and Cancelling only).
- Progress strip is **determinate** when `counts.processed` and `counts.total > 0`; otherwise **indeterminate shimmer**.
- The entire right-side action label is a single button-anchor: clicking anywhere on the right span navigates as labeled.
- "Failed" banner does **not** auto-dismiss. It clears the next time `runSyncNow` completes successfully or `syncState.lastError` returns to null. There is no separate dismiss control.

The banner is rendered inside `HomeScreen.tsx` (above its content-header markup), **not** in the app shell. It is not visible on Library / Passages / Settings.

### 2. Content header (existing markup, modified right side)

`Workspace / Home` on the left (unchanged).

**Right side** now holds the search input (moved out of the body hero). Properties:
- Compact, ~280px wide, with the existing rounded-pill `library-search-input` aesthetic
- `autoFocus` on mount of the Home screen
- Esc clears
- `useDeferredValue` deferral preserved for snappy typing

While `trimmedQuery` is non-empty, modules §3–§5 collapse and the search results panel (§6) renders in their place.

### 3. Library stats strip

Single card with subtle border. Left side: two large numbers — `<bookCount> books · <highlightCount> highlights`.

Right side variants:
- **Healthy + idle:** `synced <relative time formatted by the existing formatRelative helper> · Sync now` (Sync now triggers `runSyncNow`)
- **Just completed:** for the first render after a successful sync completion (the `sync_complete` event), the strip shows the chip `+N new books · +M new highlights`. The chip remains visible until the user navigates away from Home or 10 seconds pass, then the resting copy returns. `N` and `M` are derived from comparing the post-completion `recentActivity` arrays to the per-session baseline captured the previous time the user was on Home.
- **Active run:** phase label + elapsed (the heavy progress lives in the banner)
- **Warning:** muted; the banner carries the actionable message

The stats counts come from existing IPC (`window.archi.listWorks().length`, `listPassages().length`). No new endpoint needed for v1; if the lists get large enough to be slow, a future spec can add a `getLibraryCounts()` IPC, but it's out of scope here.

### 4. Recently added books rail

Horizontal scroll, single row. Each tile: cover image (or first-letter fallback like today's `activity-cover-letter`), title, creator. Source data: `recentActivity.works` (already populated by `window.archi.listRecentActivity(8)`); rail shows up to 12, so the IPC call's limit parameter is bumped from 8 to 12.

Click a tile → calls the existing `onOpenWork(workId)` handler (which navigates to Library + selects that work).

When a sync has just completed and `recentActivity.works` has new entries vs the last view, a small `+N new` chip sits to the right of the section eyebrow. The "last view" reference is a `useRef` reset whenever the user leaves and returns to Home, OR after ~10 seconds of idle (we don't persist this across reloads — it's a session affordance).

### 5. Highlights split row

Two equal columns side-by-side (stacks vertically on narrow widths via existing `screen-card`'s flex sensibilities — to be tuned in CSS).

**Left column · Random highlight:**
- Card title: "A random highlight"
- Body: passage excerpt in larger, italic type (~17px), with the existing `activity-quote-mark` open-quote glyph
- Footer: work title + creator attribution
- Action: `Shuffle ↻` button — picks a new random passage from the full `passages` list
- Selected passage held in local `useState`; initialized to a random pick on mount and re-rolled on Shuffle. No persistence across reloads (cheap, fine).
- Click the card body → opens that work via `onOpenWork(passage.workId)`. The Shuffle button stops propagation.

**Right column · Latest highlights:**
- Card title: "Latest highlights" (with `+N new` chip in the same pattern as the books rail)
- 5 freshest items from `recentActivity.passages`
- Each row: short excerpt (160 chars max), work attribution, relative time
- Click → `onOpenWork(passage.workId)`

### 6. Search results panel (replaces §3–§5 when active)

Exactly the existing search-results JSX from `HomeScreen.tsx` (works group + virtualized passages group with `useVirtualizer`), extracted into a `<HomeSearchResults>` component. Same `home-search-*` styles, same highlight/excerpt utilities. No behavioral change beyond being driven by the header-mounted input.

## Component breakdown

New components (all under `apps/desktop/src/renderer/screens/`):

- `SettingsScreen.tsx`
- `home/SyncBanner.tsx`
- `home/StatsStrip.tsx`
- `home/BooksRail.tsx`
- `home/RandomHighlight.tsx`
- `home/LatestHighlights.tsx`
- `home/HomeSearchResults.tsx`

`HomeScreen.tsx` is rewritten to compose these. It keeps all its current data props (recent works/passages, sync progress, callbacks) and stops owning JSX for sync-live header, activity feed, and the search hero. The component shrinks substantially — the bulk of the existing 570-line file moves into the children, with the parent acting as a thin layout shell.

The current `excerptOf`, `excerptAroundMatch`, `formatRelative`, `formatElapsed`, `highlightMatch` helpers move into a colocated `home/utils.ts` so the new components can share them.

## `App.tsx` changes

- `screens` tuple → `["Home", "Library", "Passages", "Settings"]`. `Connections` and `Logs` entries removed.
- `screenIcons` — drop `Connections` and `Logs` entries; add `Settings` (gear).
- `screenContent` switch — drop `case "Connections"` and `case "Logs"`; add `case "Settings"` rendering `<SettingsScreen … />` with both connection callbacks and `logs` entries threaded through.
- `onNavigateToConnections` prop on `HomeScreen` → renamed `onNavigateToSettings(tab: "connections" | "logs")` which sets `activeScreen` to `"Settings"` and forwards the desired tab via a new `settingsDefaultTab` state. The `SettingsScreen`'s `useEffect` syncs its internal tab state with this prop whenever the user lands on Settings.
- Derived `unhealthyConnection` bool (any connection `status === "needs_action"` OR `syncState.lastError` non-null) drives the sidebar gear's warning-dot indicator.
- The `useEffect` that periodically refreshes connections when `activeScreen === "Connections"` is rekeyed to fire when `activeScreen === "Settings"` (regardless of which tab is active — connections health drives the gear dot too, so we want fresh data either way).
- The `bookCount` and `highlightCount` for the stats strip are computed as `works.length` and `passages.length` (no IPC change).

## `styles.css` changes

**Add:**
- `.sync-banner`, `.sync-banner-running`, `.sync-banner-cancelling`, `.sync-banner-warning`, `.sync-banner-error`, `.sync-banner-progress`, `.sync-banner-action`
- `.stats-strip`, `.stats-strip-counts`, `.stats-strip-meta`, `.stats-strip-new-chip`
- `.books-rail`, `.books-rail-track`, `.books-rail-tile`, `.books-rail-tile-cover`
- `.highlights-split`, `.random-highlight-card`, `.random-highlight-shuffle`, `.latest-highlights-list`
- `.home-header-search` (compact search input inside the content-header right side)
- `.settings-tabs`, `.settings-tab-button`, `.settings-tab-button-active`, `.settings-tab-panel`
- `.sidebar-nav-warning-dot` (absolute-positioned dot on the Settings nav button)

**Delete:**
- `.sync-live`, `.sync-live-header`, `.sync-live-running`, `.sync-live-cancelling`, `.sync-live-phase`, `.sync-live-elapsed`, `.sync-live-cancel-button`, `.sync-live-head`, `.sync-live-head-actions`
- `.activity-feed`, `.activity-feed-live`, `.activity-column`, `.activity-column-head`, `.activity-column-chevron`, `.activity-list`, `.activity-item`, `.activity-item-work`, `.activity-item-passage`, `.activity-cover`, `.activity-cover-letter`, `.activity-body`, `.activity-title`, `.activity-meta`, `.activity-meta-soft`, `.activity-quote-mark`, `.activity-quote`, `.activity-attribution`, `.activity-empty`
- `.home-search-hero`, `.home-search-input-large`, `.home-search-inline-action`, `.home-inline-link`, `.home-inline-link-accent`, `.home-inline-meta`

**Keep:**
- `.home-search-results`, `.home-search-count`, `.home-search-scroll`, `.home-search-passages-*`, `.home-search-group`, `.home-search-list`, `.home-search-item*` — these continue to back the search results panel (§6).
- `.progress-bar*` classes — reused by the sync banner's progress strip.

## Data flow

No new IPC. All inputs to the new components come from the existing `App.tsx` state:

| Component | Inputs |
|---|---|
| SyncBanner | `isSyncing`, `isCancelingSync`, `syncProgress`, `syncState.lastError`, `connections` (for needs_action), source-health derived from `connections`, `onSyncNow`, `onCancelSync`, `onNavigateToSettings` |
| StatsStrip | `works.length`, `passages.length`, `syncState.lastRunAt`, current sync state (for variant choice), `onSyncNow` |
| BooksRail | `recentActivity.works` (limit bumped from 8 → 12), `onOpenWork`, `newSinceLastView` count (session-only) |
| RandomHighlight | `passages` (full list), `onOpenWork` |
| LatestHighlights | `recentActivity.passages`, `onOpenWork`, `newSinceLastView` count |
| HomeSearchResults | `works`, `passages`, `trimmedQuery`, `onOpenWork` |
| SettingsScreen | All current `ConnectionsScreen` props + `logs` entries + `defaultTab` |

The `listRecentActivity(8)` call in `App.tsx` is changed to `listRecentActivity(12)`.

## Edge cases / behavioral notes

- **Empty library (first run, no sync ever):** stats strip shows `0 books · 0 highlights`; books rail and latest-highlights show empty-state text ("Nothing yet — run a sync to start filling your library."); random highlight shows a placeholder with a Sync now action.
- **Search active during sync:** the search results panel is what renders. The sync banner above remains visible (it's outside the search-results swap region).
- **Esc inside search input:** clears the query; modules §3–§5 reappear.
- **Single passage in library:** Random highlight Shuffle button is hidden (nothing to re-roll to). Below ~5 passages, Latest highlights renders as many as exist.
- **`recentActivity.works` < 12 entries:** rail shows what it has; no horizontal padding tricks needed because the items just don't fill the row.
- **Failed banner + needs-auth simultaneously:** NeedsAuth wins (it's the actionable cause; user fixes auth → next sync clears the error).

## Risks / open considerations (not blocking implementation)

- The "+N new" chips depend on a session-only `useRef` baseline. If the user reloads the app immediately after a sync, the chip won't show. That's acceptable for v1 — the modules themselves carry the freshness signal.
- `RandomHighlight` reading from the full `passages` array means we hold the entire highlight list in renderer memory (already true today for search). If passage counts grow beyond ~50k, a future spec should swap in a sampling IPC.
- The banner's "first failing source" copy assumes a single failing source is representative. With multiple simultaneous failures, the user sees the first one and discovers the rest after clicking through to Settings. Acceptable for v1.
