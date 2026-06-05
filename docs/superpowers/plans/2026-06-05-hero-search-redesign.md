# Hero Search Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe Home so semantic search is the hero feature: a large card-style block at the top of the body with a tagline, generous input, suggested-query chips, and recent-searches strip — that transforms into a full-canvas results view when the user types.

**Architecture:** A new `SearchHero` component owns the entire search experience (resting + active) and absorbs the existing `HomeSearchResults` component. The content-header search input is removed. `HomeScreen` becomes a thin layout shell that mounts SearchHero, then conditionally renders the existing dashboard modules when search is idle.

**Tech Stack:** React 18 + TypeScript + Vite Electron renderer, `@tanstack/react-virtual` for the result list, `@archi/search` typings + the existing `archi:search:*` IPC channels.

**Spec:** `docs/superpowers/specs/2026-06-05-hero-search-redesign-design.md`

**Branch:** `worktree-local-semantic-search` (at HEAD `ecd255e`). Implementation continues on this branch.

---

## File structure

**Create:**
- `apps/desktop/src/renderer/screens/home/SearchHero.tsx` — new component owning both resting and active states

**Modify:**
- `apps/desktop/src/renderer/App.tsx` — drop content-header search, add `recentSearches` state + persistence helpers, pass new props to HomeScreen
- `apps/desktop/src/renderer/screens/HomeScreen.tsx` — replace the conditional render with `<SearchHero>` + conditional dashboard
- `apps/desktop/src/renderer/screens/home/utils.tsx` — add `hasNonDefaultFilters` helper
- `apps/desktop/src/renderer/styles.css` — add `.search-hero*` styles, delete obsolete `.content-header-search*`, `.home-search-results-v2*`, `.home-search-empty`

**Delete:**
- `apps/desktop/src/renderer/screens/home/HomeSearchResults.tsx` — all logic moves into SearchHero

---

## Verification gates (used at every task)

- **Typecheck:** `pnpm --filter @archi/desktop typecheck` — zero errors. Run from worktree root: `/Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search`.
- **Lint:** `pnpm --filter @archi/desktop lint` — zero errors.
- **No renderer tests for these changes.** The renderer doesn't have a test framework. Verification is typecheck + lint + final manual walkthrough in Task 7.

Use `git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search <command>` for every git command. Verify before each commit: `git -C <worktree> rev-parse --abbrev-ref HEAD` returns `worktree-local-semantic-search`.

---

### Task 1: Add `hasNonDefaultFilters` helper

**Files:**
- Modify: `apps/desktop/src/renderer/screens/home/utils.tsx`

The helper decides whether search should be considered "active" beyond just having query text — used in Task 5 to drive `searchActive` in HomeScreen and (transitively) the dashboard's visibility.

- [ ] **Step 1.1: Read the current utils.tsx**

```bash
cat /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search/apps/desktop/src/renderer/screens/home/utils.tsx
```

Note its existing exports (likely `excerptOf`, `formatRelative`, `highlightMatches`, etc.) — preserve them.

- [ ] **Step 1.2: Add the helper**

Append to `apps/desktop/src/renderer/screens/home/utils.tsx`:

```tsx
import type { SearchFilters } from "@archi/search";

export function hasNonDefaultFilters(filters: SearchFilters): boolean {
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
```

If `utils.tsx` already imports from `@archi/search`, merge the import — don't double-import.

- [ ] **Step 1.3: Typecheck + Lint + Commit**

```bash
cd /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search
pnpm --filter @archi/desktop typecheck 2>&1 | grep -c "error TS"
pnpm --filter @archi/desktop lint 2>&1 | grep -c "error"
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/screens/home/utils.tsx
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search commit -m "desktop(home): add hasNonDefaultFilters helper for searchActive derivation"
```

Both gates 0.

---

### Task 2: Wire `recentSearches` state + persistence helpers in `App.tsx`

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`

Adds the `recentSearches: string[]` state, reads from localStorage on mount, persists on change, and exposes a `pushRecentSearch` function. Does NOT yet wire to HomeScreen — that happens in Task 5.

- [ ] **Step 2.1: Add reader + state + persistence**

In `apps/desktop/src/renderer/App.tsx`:

Add near the top of the file (with other module-level helpers):

```tsx
const RECENT_SEARCHES_STORAGE_KEY = "archi.recentSearches";
const RECENT_SEARCHES_MAX = 3;

function readInitialRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .slice(0, RECENT_SEARCHES_MAX);
  } catch {
    return [];
  }
}
```

Then inside the `App` component, near the other `useState` declarations:

```tsx
const [recentSearches, setRecentSearches] = useState<string[]>(readInitialRecentSearches);

useEffect(() => {
  try {
    window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(recentSearches));
  } catch {
    // localStorage may be unavailable; silent fallthrough
  }
}, [recentSearches]);

const pushRecentSearch = useCallback((query: string): void => {
  const trimmed = query.trim();
  if (!trimmed) return;
  setRecentSearches((prev) => {
    const deduped = prev.filter((entry) => entry.toLowerCase() !== trimmed.toLowerCase());
    return [trimmed, ...deduped].slice(0, RECENT_SEARCHES_MAX);
  });
}, []);
```

If `useCallback` isn't already imported from `react` in `App.tsx`, add it.

- [ ] **Step 2.2: Typecheck + Lint + Commit**

```bash
cd /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search
pnpm --filter @archi/desktop typecheck 2>&1 | grep -c "error TS"
pnpm --filter @archi/desktop lint 2>&1 | grep -c "error"
```

If lint flags `recentSearches` / `pushRecentSearch` / `setRecentSearches` as unused, that's expected for now — Task 5 wires them. Suppress with `// eslint-disable-next-line @typescript-eslint/no-unused-vars` on each unused destructure with a comment noting "wired in Task 5". Cleaner: leave it unused, accept the lint failure, and roll Task 2 into Task 5's commit.

**Choose:** if the eslint config errors on unused vars (it does, per earlier tasks in this branch), DO NOT commit Task 2 standalone. Instead, leave its changes uncommitted and fold them into Task 5's commit. The plan author has verified this is the standard pattern in this codebase.

Skip Step 2.2's commit; proceed to Task 3 with these changes in the working tree.

- [ ] **Step 2.3 (alternative): Verify state-only changes compile but don't commit yet**

```bash
cd /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search
pnpm --filter @archi/desktop typecheck 2>&1 | grep -c "error TS"
```

Expected: 0. Lint will fail with unused-var warnings; that's OK — the consumers land in Task 5.

---

### Task 3: Build SearchHero — resting state shell + suggested chips + recent searches

**Files:**
- Create: `apps/desktop/src/renderer/screens/home/SearchHero.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

This task creates the new component with ONLY the resting state. The active state lands in Task 4. The component isn't wired into HomeScreen yet — that happens in Task 5.

- [ ] **Step 3.1: Create `SearchHero.tsx` (resting-only)**

Write `apps/desktop/src/renderer/screens/home/SearchHero.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchFilters, SearchResponse } from "@archi/search";
import { SearchFilterChips } from "../../components/SearchFilterChips";
import { SearchResultCard } from "../../components/SearchResultCard";
import { useSearchPreferences } from "../../state/SearchPreferencesContext";
import { useIndexerStatus } from "../../state/IndexerStatusContext";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";

type SuggestedChip = {
  label: string;
  apply: (state: { setQuery: (q: string) => void; setFilters: (f: SearchFilters) => void }) => void;
};

function thirtyDaysAgoIso(): string {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

const SUGGESTED_CHIPS: SuggestedChip[] = [
  {
    label: "books on creativity",
    apply: ({ setQuery }) => setQuery("books on creativity")
  },
  {
    label: "quotes about discipline",
    apply: ({ setQuery }) => setQuery("quotes about discipline")
  },
  {
    label: "from last month",
    apply: ({ setQuery, setFilters }) => {
      setQuery("");
      setFilters({ markedAfter: thirtyDaysAgoIso() });
    }
  },
  {
    label: "starred only",
    apply: ({ setQuery, setFilters }) => {
      setQuery("");
      setFilters({ isStarred: true });
    }
  }
];

type Props = {
  query: string;
  setQuery: (q: string) => void;
  filters: SearchFilters;
  setFilters: (f: SearchFilters) => void;
  findSimilarPassageId: string | null;
  findSimilarPassage: { id: string; body: string } | null;
  clearFindSimilar: () => void;
  highlightCount: number;
  recentSearches: string[];
  pushRecentSearch: (q: string) => void;
  onOpenWork: (workId: string, passageId?: string) => void;
  onFindSimilar: (passage: { id: string; body: string }) => void;
};

export function SearchHero(props: Props): JSX.Element {
  const {
    query,
    setQuery,
    filters,
    setFilters,
    findSimilarPassageId,
    findSimilarPassage,
    clearFindSimilar,
    highlightCount,
    recentSearches,
    pushRecentSearch,
    onOpenWork,
    onFindSimilar
  } = props;

  const inputRef = useRef<HTMLInputElement>(null);
  const indexerStatus = useIndexerStatus();
  const indexerWrapper = indexerStatus.status;
  const isIndexing = indexerWrapper?.status === "running";
  const indexedCount = indexerWrapper?.indexed ?? 0;
  const totalToIndex = indexerWrapper?.total ?? 0;

  // ⌘K / Ctrl+K refocuses the input. Scope is implicitly Home because SearchHero only mounts there.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tagline = isIndexing && totalToIndex > 0
    ? `Ask anything across ${indexedCount.toLocaleString()} of ${totalToIndex.toLocaleString()} indexed highlights`
    : `Ask anything across ${highlightCount.toLocaleString()} highlights`;

  return (
    <section className="search-hero search-hero-resting">
      <p className="search-hero-tagline">{tagline}</p>

      <div className="search-hero-input-wrap">
        <span className="search-hero-icon" aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          type="search"
          className="search-hero-input"
          placeholder="What do you want to find?"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              setQuery("");
            }
          }}
          aria-label="Search your library"
          autoFocus
        />
        <span className="search-hero-kbd" aria-hidden="true">⌘K</span>
      </div>

      <div className="search-hero-chips">
        {SUGGESTED_CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            className="search-hero-chip"
            onClick={() => {
              clearFindSimilar();
              chip.apply({ setQuery, setFilters });
            }}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {recentSearches.length > 0 ? (
        <p className="search-hero-recents">
          Recent:{" "}
          {recentSearches.map((entry, index) => (
            <span key={entry}>
              {index > 0 ? <span aria-hidden="true"> · </span> : null}
              <button
                type="button"
                className="search-hero-recents-link"
                onClick={() => {
                  clearFindSimilar();
                  setQuery(entry);
                  pushRecentSearch(entry);
                }}
              >
                {entry}
              </button>
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}
```

Notes for the implementer:
- `SearchFilterChips` and `SearchResultCard` imports are unused for now (Task 4 will use them) — eslint may flag this. If it does, comment them out for this task and uncomment in Task 4. Or use the leading-underscore unused-import workaround. Simpler: comment them out.
- `SearchResponse`, `useCallback`, `useVirtualizer`, `VirtualItem`, `useSearchPreferences` are also for Task 4 — same treatment.

Trim the imports for this task. Keep only:

```tsx
import { useEffect, useRef } from "react";
import type { SearchFilters } from "@archi/search";
import { useIndexerStatus } from "../../state/IndexerStatusContext";
```

Re-add the others in Task 4 as needed.

- [ ] **Step 3.2: Add resting-state CSS**

Append to `apps/desktop/src/renderer/styles.css`:

```css
.search-hero {
  background: var(--surface);
  border: 1px solid color-mix(in srgb, var(--ink-300) 22%, transparent);
  border-radius: 16px;
  padding: 28px 28px 22px;
  display: grid;
  gap: 16px;
  box-shadow: 0 4px 16px rgba(72, 53, 41, 0.04);
}

.search-hero-tagline {
  margin: 0;
  font-family: var(--serif, Georgia, serif);
  font-style: italic;
  font-size: 15px;
  color: var(--ink-700);
  text-align: center;
}

.search-hero-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface);
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
  border-radius: 999px;
  padding: 12px 18px 12px 22px;
  transition: border-color 160ms ease, box-shadow 160ms ease;
  box-shadow: 0 4px 14px rgba(166, 74, 60, 0.06);
}

.search-hero-input-wrap:focus-within {
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  box-shadow: 0 4px 18px rgba(166, 74, 60, 0.12);
}

.search-hero-icon {
  color: var(--accent-strong);
  font-size: 18px;
  flex-shrink: 0;
}

.search-hero-input {
  flex: 1 1 auto;
  border: none;
  background: transparent;
  font: inherit;
  font-size: 15px;
  color: var(--ink-900);
  outline: none;
}

.search-hero-input::placeholder {
  color: var(--ink-500);
}

.search-hero-kbd {
  flex-shrink: 0;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--ink-500);
  border: 1px solid color-mix(in srgb, var(--ink-300) 50%, transparent);
  border-radius: 6px;
  padding: 2px 6px;
}

.search-hero-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
}

.search-hero-chip {
  border: 1px solid color-mix(in srgb, var(--ink-300) 38%, transparent);
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
  color: var(--ink-700);
  border-radius: 999px;
  padding: 4px 11px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
}

.search-hero-chip:hover {
  color: var(--accent-strong);
  border-color: color-mix(in srgb, var(--accent) 50%, transparent);
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
}

.search-hero-recents {
  margin: 0;
  text-align: center;
  font-size: 11px;
  color: var(--ink-500);
}

.search-hero-recents-link {
  border: none;
  background: transparent;
  color: var(--accent-strong);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  padding: 0;
  text-decoration: none;
}

.search-hero-recents-link:hover {
  text-decoration: underline;
}
```

- [ ] **Step 3.3: Typecheck + Lint**

```bash
cd /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search
pnpm --filter @archi/desktop typecheck 2>&1 | grep -c "error TS"
pnpm --filter @archi/desktop lint 2>&1 | grep -c "error"
```

Both 0.

Note: the new `SearchHero` component is not yet imported anywhere. That's expected; Task 5 wires it. The unused-component pattern is fine — TS doesn't flag unused exports.

- [ ] **Step 3.4: Commit (combine Task 2 + Task 3)**

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/screens/home/SearchHero.tsx apps/desktop/src/renderer/styles.css
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search commit -m "desktop(home): SearchHero resting state + recentSearches state in App"
```

The commit bundles Tasks 2 and 3 because Task 2 alone fails lint with unused-var warnings.

---

### Task 4: Add SearchHero active state — IPC + filter chips + results + sentinel

**Files:**
- Modify: `apps/desktop/src/renderer/screens/home/SearchHero.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

Extends SearchHero with the active state: when `query` or `findSimilarPassageId` is non-empty, the chips swap for filter chips, the input row optionally swaps for a sentinel, and a virtualized result list renders below.

- [ ] **Step 4.1: Re-import the active-state deps**

In `apps/desktop/src/renderer/screens/home/SearchHero.tsx`, update the imports to:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchFilters, SearchResponse } from "@archi/search";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { SearchFilterChips } from "../../components/SearchFilterChips";
import { SearchResultCard } from "../../components/SearchResultCard";
import { useSearchPreferences } from "../../state/SearchPreferencesContext";
import { useIndexerStatus } from "../../state/IndexerStatusContext";
```

- [ ] **Step 4.2: Add active-state logic inside `SearchHero`**

Add these declarations inside the component, after the existing destructure but before the JSX return:

```tsx
const prefs = useSearchPreferences();
const [response, setResponse] = useState<SearchResponse | null>(null);
const [loading, setLoading] = useState(false);
const [expandedId, setExpandedId] = useState<string | null>(null);

const isActive = query.trim().length > 0 || findSimilarPassageId !== null;

const runQuery = useCallback(
  async (q: string, f: SearchFilters, similarToId: string | null) => {
    setLoading(true);
    try {
      const mergedFilters: SearchFilters = {
        ...f,
        isArchived: prefs.includeArchived ? true : f.isArchived,
        isHidden: prefs.includeHidden ? true : f.isHidden
      };
      const res = await window.archi.search.query({
        text: q,
        filters: mergedFilters,
        limit: 50,
        findSimilarPassageId: similarToId ?? undefined
      });
      setResponse(res);
      if (res.results.length > 0 && q.trim().length > 0 && !similarToId) {
        pushRecentSearch(q);
      }
    } finally {
      setLoading(false);
    }
  },
  [prefs.includeArchived, prefs.includeHidden, pushRecentSearch]
);

useEffect(() => {
  if (!isActive) {
    setResponse(null);
    setExpandedId(null);
    return;
  }
  const handle = setTimeout(() => {
    void runQuery(query, filters, findSimilarPassageId);
  }, 150);
  return () => clearTimeout(handle);
}, [query, filters, findSimilarPassageId, isActive, runQuery]);

const scrollRef = useRef<HTMLDivElement>(null);
const virtualizer = useVirtualizer({
  count: response?.results.length ?? 0,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 180,
  overscan: 4,
  getItemKey: (index) => response?.results[index]?.passageId ?? index
});

useEffect(() => {
  scrollRef.current?.scrollTo({ top: 0 });
}, [query, findSimilarPassageId]);

const handleCopy = (body: string): void => {
  void navigator.clipboard.writeText(body);
};

const summary = (() => {
  if (!response) return "";
  if (prefs.showMatchSource) {
    const keyword = response.results.filter((r) => r.matchedVia === "fts5").length;
    const vector = response.results.filter((r) => r.matchedVia === "vector").length;
    const both = response.results.filter((r) => r.matchedVia === "both").length;
    return `${keyword} keyword · ${vector} vector · ${both} combined`;
  }
  return `${response.results.length} ${response.results.length === 1 ? "result" : "results"}`;
})();

const truncatedSimilarSeed = findSimilarPassage
  ? findSimilarPassage.body.length > 40
    ? `${findSimilarPassage.body.slice(0, 40)}…`
    : findSimilarPassage.body
  : null;
```

- [ ] **Step 4.3: Update the JSX return to branch on `isActive`**

Replace the existing JSX inside the return statement of `SearchHero`. The outer `<section>` adds either `search-hero-resting` or `search-hero-active` modifier:

```tsx
return (
  <section className={`search-hero ${isActive ? "search-hero-active" : "search-hero-resting"}`}>
    {!isActive ? <p className="search-hero-tagline">{tagline}</p> : null}

    {findSimilarPassage ? (
      <div className="search-hero-sentinel">
        <span className="search-hero-icon" aria-hidden="true">⌕</span>
        <span className="search-hero-sentinel-text">
          Similar to "{truncatedSimilarSeed}"
        </span>
        <button
          type="button"
          className="search-hero-sentinel-clear"
          onClick={clearFindSimilar}
          aria-label="Clear find similar"
        >
          ×
        </button>
      </div>
    ) : (
      <div className="search-hero-input-wrap">
        <span className="search-hero-icon" aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          type="search"
          className="search-hero-input"
          placeholder="What do you want to find?"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              setQuery("");
            }
          }}
          aria-label="Search your library"
          autoFocus
        />
        {query ? (
          <button
            type="button"
            className="search-hero-clear"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            tabIndex={-1}
          >
            ×
          </button>
        ) : (
          <span className="search-hero-kbd" aria-hidden="true">⌘K</span>
        )}
      </div>
    )}

    {!isActive ? (
      <>
        <div className="search-hero-chips">
          {SUGGESTED_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              className="search-hero-chip"
              onClick={() => {
                clearFindSimilar();
                chip.apply({ setQuery, setFilters });
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {recentSearches.length > 0 ? (
          <p className="search-hero-recents">
            Recent:{" "}
            {recentSearches.map((entry, index) => (
              <span key={entry}>
                {index > 0 ? <span aria-hidden="true"> · </span> : null}
                <button
                  type="button"
                  className="search-hero-recents-link"
                  onClick={() => {
                    clearFindSimilar();
                    setQuery(entry);
                    pushRecentSearch(entry);
                  }}
                >
                  {entry}
                </button>
              </span>
            ))}
          </p>
        ) : null}
      </>
    ) : (
      <>
        <div className="search-hero-filter-chips-wrap">
          <SearchFilterChips filters={filters} onChange={setFilters} />
        </div>

        <p className={`search-hero-count ${loading ? "search-hero-count-loading" : ""}`}>
          {loading ? "Searching…" : summary}
        </p>

        {response && response.results.length === 0 && !loading ? (
          <div className="search-hero-empty">
            <p>No matches.</p>
            <button
              type="button"
              className="search-hero-empty-clear"
              onClick={() => {
                if (findSimilarPassage) {
                  clearFindSimilar();
                } else {
                  setQuery("");
                }
              }}
            >
              Clear query
            </button>
          </div>
        ) : (
          <div className="search-hero-results" ref={scrollRef}>
            <div
              className="search-hero-results-inner"
              style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}
            >
              {virtualizer.getVirtualItems().map((virtualItem: VirtualItem) => {
                const r = response?.results[virtualItem.index];
                if (!r) return null;
                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    className="search-hero-results-row"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualItem.start}px)`
                    }}
                  >
                    <SearchResultCard
                      result={r}
                      showMatchSource={prefs.showMatchSource}
                      expanded={expandedId === r.passageId}
                      onToggle={() =>
                        setExpandedId((current) => (current === r.passageId ? null : r.passageId))
                      }
                      onOpenWork={(workId) => onOpenWork(workId, r.passageId)}
                      onCopy={() => handleCopy(r.body)}
                      onFindSimilar={() => onFindSimilar({ id: r.passageId, body: r.body })}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </>
    )}
  </section>
);
```

- [ ] **Step 4.4: Add active-state CSS**

Append to `apps/desktop/src/renderer/styles.css`:

```css
.search-hero-active {
  /* same outer shell as resting; gap stays */
}

.search-hero-sentinel {
  display: flex;
  align-items: center;
  gap: 10px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
  border-radius: 999px;
  padding: 12px 18px;
}

.search-hero-sentinel-text {
  flex: 1 1 auto;
  font-size: 14px;
  color: var(--accent-strong);
  font-style: italic;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-hero-sentinel-clear,
.search-hero-clear {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: none;
  background: color-mix(in srgb, var(--ink-300) 22%, transparent);
  color: var(--ink-700);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.search-hero-sentinel-clear:hover,
.search-hero-clear:hover {
  background: color-mix(in srgb, var(--ink-300) 40%, transparent);
}

.search-hero-filter-chips-wrap {
  display: block;
}

.search-hero-count {
  margin: 0;
  font-size: 12px;
  color: var(--ink-500);
  text-align: center;
}

.search-hero-count-loading {
  color: var(--accent-strong);
  font-style: italic;
}

.search-hero-results {
  position: relative;
  max-height: 60vh;
  overflow-y: auto;
  padding-bottom: 4px;
}

.search-hero-results-inner {
  width: 100%;
}

.search-hero-results-row {
  padding-bottom: 10px;
}

.search-hero-empty {
  display: grid;
  gap: 6px;
  justify-items: center;
  padding: 24px 0;
  color: var(--ink-500);
  font-style: italic;
  font-size: 13px;
}

.search-hero-empty-clear {
  margin-top: 6px;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--ink-300) 40%, transparent);
  color: var(--accent-strong);
  padding: 4px 11px;
  border-radius: 999px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.search-hero-empty-clear:hover {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
```

- [ ] **Step 4.5: Typecheck + Lint**

```bash
cd /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search
pnpm --filter @archi/desktop typecheck 2>&1 | grep -c "error TS"
pnpm --filter @archi/desktop lint 2>&1 | grep -c "error"
```

Both 0. SearchHero still isn't imported anywhere — Task 5 wires it.

- [ ] **Step 4.6: Commit**

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/screens/home/SearchHero.tsx apps/desktop/src/renderer/styles.css
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search commit -m "desktop(home): SearchHero active state — IPC query + filter chips + virtualized results + sentinel"
```

---

### Task 5: Wire SearchHero into HomeScreen; remove content-header search

**Files:**
- Modify: `apps/desktop/src/renderer/screens/HomeScreen.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`

Replaces HomeScreen's conditional `HomeSearchResults` render with `SearchHero`. Removes the content-header search input from App.tsx. Threads the new props (`highlightCount`, `recentSearches`, `pushRecentSearch`, `onSearchQueryChange`, `onClearFindSimilar`).

- [ ] **Step 5.1: Update `HomeScreen.tsx`**

Read the current `apps/desktop/src/renderer/screens/HomeScreen.tsx`. Update its imports to drop `HomeSearchResults` and add `SearchHero`:

```tsx
import { SearchHero } from "./home/SearchHero";
import { hasNonDefaultFilters } from "./home/utils";
```

(Drop `import { HomeSearchResults } from "./home/HomeSearchResults";` if present.)

Update the `Props` type to add:

```tsx
import type { SearchFilters } from "@archi/search";

// Inside Props:
highlightCount: number;
recentSearches: string[];
pushRecentSearch: (q: string) => void;
onSearchQueryChange: (q: string) => void;
onClearFindSimilar: () => void;
```

The existing `effectiveSearchQuery`, `homeSearchFilters`, `findSimilarPassageId`, `findSimilarPassage`, `onFiltersChange`, `onFindSimilar`, `onOpenWork`, plus dashboard props (`passages`, `recentWorks`, `recentPassages`, etc.) stay.

In the component body, after the existing destructure, derive `searchActive`:

```tsx
const trimmedQuery = effectiveSearchQuery.trim();
const searchActive =
  trimmedQuery.length > 0 ||
  findSimilarPassageId !== null ||
  hasNonDefaultFilters(homeSearchFilters);
```

Replace the existing `{trimmedQuery ? <HomeSearchResults … /> : <>…</>}` ternary with:

```tsx
<SearchHero
  query={effectiveSearchQuery}
  setQuery={onSearchQueryChange}
  filters={homeSearchFilters}
  setFilters={onFiltersChange}
  findSimilarPassageId={findSimilarPassageId}
  findSimilarPassage={findSimilarPassage}
  clearFindSimilar={onClearFindSimilar}
  highlightCount={highlightCount}
  recentSearches={recentSearches}
  pushRecentSearch={pushRecentSearch}
  onOpenWork={onOpenWork}
  onFindSimilar={onFindSimilar}
/>

{!searchActive ? (
  <>
    <StatsStrip … />
    <BooksRail … />
    <div className="highlights-split">
      <RandomHighlight … />
      <LatestHighlights … />
    </div>
  </>
) : null}
```

Preserve the existing prop values passed to StatsStrip / BooksRail / RandomHighlight / LatestHighlights — read the current file and copy them through.

The `useDeferredValue` on the query stays — `effectiveSearchQuery` already represents the deferred value at the boundary. No internal `searchResults` derivation is needed anymore (HomeSearchResults is gone and SearchHero owns its own IPC call).

If the file still imports `useMemo`/`useDeferredValue`/etc. only for the now-removed `searchResults`, drop those imports. If `useDeferredValue` was applied here, it can either move into `SearchHero` or be removed entirely — the IPC call inside SearchHero is already debounced 150ms, which subsumes the deferral.

**Choose:** delete the `useDeferredValue` wrapping in HomeScreen and pass `effectiveSearchQuery` straight through. The internal SearchHero debounce handles smoothness.

- [ ] **Step 5.2: Update `App.tsx` — drop content-header search input + thread new props**

In `apps/desktop/src/renderer/App.tsx`:

**(a) Delete the content-header search block.** Find the `{activeScreen === "Home" ? (` block that renders `.content-header-search` (sentinel + input + clear button). Delete the entire block. The header should now be:

```tsx
<header className="content-header">
  <div>
    {selectedWork ? (
      <button … >‹ Library</button>
    ) : (
      <p className="content-eyebrow">Workspace</p>
    )}
    <h1>{selectedWork ? selectedWork.title : activeScreen}</h1>
    {selectedWork ? <p className="content-subtitle">{selectedWork.creator || "Unknown author"}</p> : null}
  </div>
</header>
```

No right-side content.

**(b) Update the `<HomeScreen>` invocation.** In `case "Home":` of `screenContent`, add:

```tsx
highlightCount={passages.length}
recentSearches={recentSearches}
pushRecentSearch={pushRecentSearch}
onSearchQueryChange={setHomeSearchQuery}
onClearFindSimilar={() => setFindSimilarPassage(null)}
```

The existing props (`effectiveSearchQuery`, `homeSearchFilters`, `findSimilarPassageId`, `findSimilarPassage`, `onFiltersChange`, `onFindSimilar`, `onOpenWork`, `passages`, `recentWorks`, etc.) stay unchanged.

If `pendingScrollPassageId` is currently passed somewhere relevant, leave it; if not, no need.

**(c) Drop stale state if any.** Search App.tsx for usages of `homeSearchQuery` outside the new pipeline. If anything besides `effectiveSearchQuery` / `setHomeSearchQuery` references it, leave that alone. Don't change unrelated state.

Update the `useMemo` dependency array for `screenContent` to include `recentSearches` and `pushRecentSearch` (and `passages` if not already there).

- [ ] **Step 5.3: Typecheck + Lint**

```bash
cd /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search
pnpm --filter @archi/desktop typecheck 2>&1 | grep -c "error TS"
pnpm --filter @archi/desktop lint 2>&1 | grep -c "error"
```

Both 0. If lint complains about anything in HomeScreen.tsx that's now unused (e.g. `useMemo`, an old `searchResults`), delete the orphan declarations.

- [ ] **Step 5.4: Commit**

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/screens/HomeScreen.tsx apps/desktop/src/renderer/App.tsx
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search commit -m "desktop(home): mount SearchHero in HomeScreen; remove content-header search from App"
```

---

### Task 6: Delete `HomeSearchResults` + obsolete CSS

**Files:**
- Delete: `apps/desktop/src/renderer/screens/home/HomeSearchResults.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 6.1: Verify zero remaining references**

```bash
cd /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search
grep -RnE "HomeSearchResults|home-search-results-v2|home-search-empty|content-header-search|content-header-search-sentinel" apps/desktop/src/renderer/ --include="*.tsx" --include="*.ts" | grep -v "node_modules"
```

Expected: only matches inside `HomeSearchResults.tsx` itself (the file we're about to delete) plus `styles.css`. Any reference in `App.tsx`, `HomeScreen.tsx`, or another `.tsx` file is a wiring leftover — fix it before continuing.

- [ ] **Step 6.2: Delete the component**

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search rm apps/desktop/src/renderer/screens/home/HomeSearchResults.tsx
```

- [ ] **Step 6.3: Delete obsolete CSS rules**

In `apps/desktop/src/renderer/styles.css`, find and delete every rule whose selector starts with one of these:

- `.content-header-search`
- `.content-header-search-input`
- `.content-header-search-input:focus-visible`
- `.content-header-search-clear`
- `.content-header-search-clear:hover`
- `.content-header-search-sentinel`
- `.content-header-search-sentinel > span`
- `.home-search-results-v2`
- `.home-search-results-v2-summary`
- `.home-search-results-v2-list`
- `.home-search-results-v2-list-inner`
- `.home-search-results-v2-row`
- `.home-search-empty`

If any of these aren't in the file (the integration may have already touched some), skip them. Use grep to confirm before/after:

```bash
grep -nE "\.content-header-search|\.home-search-results-v2|\.home-search-empty" apps/desktop/src/renderer/styles.css
```

After deletion: empty.

- [ ] **Step 6.4: Verify no orphan consumers remain**

```bash
grep -RnE "content-header-search|home-search-results-v2|home-search-empty" apps/desktop/src/renderer/ | grep -v "node_modules"
```

Expected: empty.

- [ ] **Step 6.5: Typecheck + Lint + Commit**

```bash
cd /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search
pnpm --filter @archi/desktop typecheck 2>&1 | grep -c "error TS"
pnpm --filter @archi/desktop lint 2>&1 | grep -c "error"
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/screens/home/HomeSearchResults.tsx apps/desktop/src/renderer/styles.css
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search commit -m "desktop(home): drop HomeSearchResults + obsolete content-header-search CSS"
```

Both gates 0.

---

### Task 7: Manual verification

**Files:** none (verification only).

The dev server is already running from Task 1 of the prior session OR you can restart it. Either way, walk the integrated UX.

- [ ] **Step 7.1: Restart dev (if needed)**

If the dev server isn't running:

```bash
cd /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search
pnpm --filter @archi/desktop dev
```

Electron opens. Vite HMR picks up CSS changes; full-component changes require a refresh.

- [ ] **Step 7.2: Walk the golden path**

Verify each:

1. **Home resting state:** SyncBanner (hidden if healthy), then the hero card with tagline ("Ask anything across N highlights"), large pill input with magnifier + ⌘K hint, four suggested chips (`books on creativity`, `quotes about discipline`, `from last month`, `starred only`), and recent searches strip (empty on first launch).
2. **Dashboard:** below the hero — StatsStrip, BooksRail, highlights-split (RandomHighlight + LatestHighlights). Identical to the integration's prior layout.
3. **Type a query:** hero transforms — tagline disappears, suggested chips disappear, recent searches disappear, filter chips appear below the input, count line replaces them ("N results" or "K keyword · V vector · B combined" depending on preference), result list virtualizes in a 60vh scroll panel. Dashboard hidden.
4. **Match-source counts:** toggle `showMatchSource` in Settings → Search. Re-run a query. Count line format changes.
5. **Click a suggested chip (`books on creativity`):** input populates with "books on creativity", debounced query runs, results appear. Recent searches strip later updates (after the query returns ≥1 result).
6. **Click `starred only`:** input stays empty, but `searchActive` becomes true (the filter is set). Dashboard hides, results show starred-only passages. Filter chips show the `starred: true` filter.
7. **Click `from last month`:** same shape — filter set, dashboard hidden, results.
8. **Recent searches:** after running 1-3 queries that returned results, reload the page. Recent searches strip shows up with those queries. Click one → it re-runs.
9. **Find similar:** click "Find similar" on a result → input is replaced by the sentinel chip `Similar to "…"` with a × button. Results refresh with vector-only neighbors. × clears find-similar mode (returns to either the previous query or resting). Esc on global keydown also clears it.
10. **⌘K from anywhere on Home:** press ⌘K while focus is elsewhere → input refocuses + text selected.
11. **Open book from a result:** click "Open book" → lands on Library / By book / book detail with passage scrolled-to-and-ringed.
12. **Clear query (Esc on input):** input clears → hero returns to resting state, dashboard reappears.
13. **No content-header search:** the top-right of Home's header is empty. The header just shows `Workspace / Home` on the left.

- [ ] **Step 7.3: Edge cases**

- Empty library (0 highlights): tagline reads "Ask anything across 0 highlights"; chips still render; recents empty. Queries return empty state.
- Indexing in progress (after first sync): tagline switches to "Ask anything across X of Y indexed highlights"; SyncBanner shows the indexing state.
- Wide window: hero card is comfortably wide; input doesn't stretch too far (consider max-width if it feels off).
- Narrow window: chips wrap to multiple rows; recent searches strip truncates gracefully.

- [ ] **Step 7.4: If issues found**

Fix in a follow-up commit with a focused message. Don't amend prior commits — each task's commit stands on its own.

---

## Spec coverage check

| Spec section | Tasks |
|---|---|
| `SearchHero.tsx` new component | 3, 4 |
| Resting state: tagline + input + chips + recents | 3 |
| Active state: input + filter chips + count + results + sentinel | 4 |
| Tagline counts (live) and indexing variant | 3 |
| Suggested chips (4 chips, hardcoded) | 3 |
| Recent searches (3 max, localStorage) | 2 (folded into 3's commit) |
| `hasNonDefaultFilters` helper | 1 |
| `searchActive` derivation in HomeScreen | 5 |
| Drop content-header search | 5 |
| Wire SearchHero into HomeScreen | 5 |
| Delete HomeSearchResults | 6 |
| CSS cleanup | 6 |
| `⌘K` refocuses hero input | 3 |
| Find-similar sentinel inside hero | 4 |
| Empty state with Clear query | 4 |
| Virtualized results (60vh scroll, dynamic measure) | 4 |
| `pushRecentSearch` from App | 2 (folded into 3's commit), wired Task 5 |
| Manual verification | 7 |
