# Universal Search Coherence Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 13 audited gaps in the universal-search UX so clicking a result reveals the passage, indexer state is visible app-wide, the snippet/highlight pipeline actually highlights, the missing filters/settings ship, and accessibility/keyboard shortcuts match the spec.

**Architecture:** Three foundational shifts: (1) a shared `IndexerStatusProvider` replaces per-component polling; (2) a `SearchPreferencesProvider` persists the three Search settings via existing preferences IPC; (3) `SearchResultCard` becomes a controlled expand/collapse with structured `<mark>` rendering via a new `HighlightedText` component. Everything else is component-local refactor plus one small `packages/search` snippet change and one new facets IPC endpoint.

**Tech Stack:** Electron (main + preload + renderer), React 18, TypeScript, vitest (backend tests), better-sqlite3, `@archi/search` package.

**Spec:** `docs/superpowers/specs/2026-06-04-universal-search-coherence-pass-design.md`

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `apps/desktop/src/renderer/state/IndexerStatusContext.tsx` | `IndexerStatusProvider` + `useIndexerStatus()` hook. Single polling timer, exposes `{status, start()}`. |
| `apps/desktop/src/renderer/state/SearchPreferencesContext.tsx` | `SearchPreferencesProvider` + `useSearchPreferences()` hook. Reads/writes `search.*` keys via `window.archi.preferences`. |
| `apps/desktop/src/renderer/components/HighlightedText.tsx` | Pure parser: `<mark>...</mark>` snippet → React tree without `dangerouslySetInnerHTML`. |
| `apps/desktop/src/renderer/components/IndexerStatusPill.tsx` | Sidebar pill that subscribes to `useIndexerStatus()`. Hidden when idle and complete. |
| `apps/desktop/src/renderer/screens/SettingsScreen.tsx` | Settings screen, single Search section, persists via preferences. |

### Modified files

| Path | What changes |
|---|---|
| `packages/search/src/query/searchService.ts` | `hydrateResult` returns FTS5 `snippet()` output for fts5/both matches, body slice for vector. |
| `packages/search/src/repositories/searchRepository.ts` | New `getFacets()` returning `{creators, labels}`. |
| `packages/search/src/index.ts` | Export `Facets` type. |
| `packages/search/src/types.ts` | Add `Facets` type. |
| `apps/desktop/src/main/index.ts` | New IPC handler `archi:search:facets`. |
| `apps/desktop/src/preload/index.ts` | `search.facets()` in the search namespace. |
| `apps/desktop/src/renderer/env.d.ts` | Add `search.facets` signature. |
| `apps/desktop/src/renderer/App.tsx` | Mount both providers, replace `openPassageFromSearch` with `openSearchScreenForPassage` + `openBookAtPassage`, drop `searchScreenInstance` re-mount hack, add ⌘/ and ⌘, shortcuts, add Settings to sidebar tuple. |
| `apps/desktop/src/renderer/screens/SearchScreen.tsx` | Controlled `initialQuery` + `pendingExpandPassageId`, single `expandedId` state, consume `useSearchPreferences()`, drop `availableCreators` heuristic in favor of facets IPC. |
| `apps/desktop/src/renderer/components/GlobalSearchBar.tsx` | One `onEscalate(query, expandPassageId?)` prop, clear text after escalate, outside-click handler, partial-results line, empty-state row. |
| `apps/desktop/src/renderer/components/SearchResultCard.tsx` | Drop `role="button"`, accept `expanded`/`onToggle` props, render snippet via `HighlightedText`, use `FindSimilarButton` instead of inline. |
| `apps/desktop/src/renderer/components/SearchFilterChips.tsx` | Replace inline menu with popover; add Book, Date range, Quote label chips; consume facets. |
| `apps/desktop/src/renderer/components/IndexingBanner.tsx` | Drop local polling, consume `useIndexerStatus()`. |
| `apps/desktop/src/renderer/screens/LibraryBookDetailScreen.tsx` | Accept `pendingScrollPassageId` + `breadcrumbFromSearch`; ring + scroll behavior. |
| `apps/desktop/src/renderer/screens/NotionScreen.tsx` | Replace stale "Library and Passages databases" line. |
| `apps/desktop/src/renderer/styles.css` | Add `.library-quote-card--ringed` keyframe; `.settings-screen` rules; `.indexer-status-pill` rules; `.search-filter-popover` rules; `.search-result-card--expanded` rules; `.global-search-bar__partial-line` and `__empty-row` rules. |

### Test files

| Path | What changes |
|---|---|
| `packages/search/tests/searchService.test.ts` | Add cases: FTS5 snippet on keyword match, body-slice on vector match. |
| `packages/search/tests/searchRepository.test.ts` | Add cases: `getFacets()` returns sorted, deduped creators and labels. |

### Verification commands

```bash
# Backend tests (TDD-capable scope)
pnpm --filter @archi/search test

# Whole-repo gates
pnpm typecheck
pnpm lint

# Desktop manual verification (per task)
pnpm --filter @archi/desktop dev
```

The renderer has no test harness today — renderer tasks gate on `pnpm typecheck` + manual scenarios from the spec §11.2.

---

## Task 1: Search service — FTS5 snippet output

**Files:**
- Modify: `packages/search/src/query/searchService.ts:168-192`
- Test: `packages/search/tests/searchService.test.ts`

- [ ] **Step 1: Write the failing test cases**

Open `packages/search/tests/searchService.test.ts`. After the existing test block, add:

```ts
describe("snippet output", () => {
  it("wraps matched tokens in <mark> for fts5 matches", async () => {
    const res = await search.query({ text: "anger", filters: {}, limit: 5 });
    const ftsHit = res.results.find((r) => r.matchedVia === "fts5" || r.matchedVia === "both");
    expect(ftsHit).toBeDefined();
    expect(ftsHit!.snippet).toMatch(/<mark>anger<\/mark>/i);
  });

  it("returns first 220 chars + ellipsis for vector-only matches over 220 chars long", async () => {
    // Choose a query whose only matching mechanism is vector (synonym, not literal).
    const res = await search.query({ text: "rage", filters: {}, limit: 5 });
    const vectorOnly = res.results.find((r) => r.matchedVia === "vector");
    expect(vectorOnly).toBeDefined();
    if (vectorOnly!.body.length > 220) {
      expect(vectorOnly!.snippet.length).toBeLessThanOrEqual(221); // 220 + ellipsis
      expect(vectorOnly!.snippet.endsWith("…")).toBe(true);
    } else {
      expect(vectorOnly!.snippet).toBe(vectorOnly!.body);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @archi/search test -- searchService.test.ts
```

Expected: FAIL — current `snippet: body` returns the whole body without `<mark>`.

- [ ] **Step 3: Update `hydrateResult` and add a snippet helper**

In `packages/search/src/query/searchService.ts`, replace lines `168-192` (the `hydrateResult` function) with:

```ts
function buildSnippet(
  body: string,
  ftsSnippet: string | null,
  matchedVia: SearchResult["matchedVia"]
): string {
  if ((matchedVia === "fts5" || matchedVia === "both") && ftsSnippet && ftsSnippet.length > 0) {
    return ftsSnippet;
  }
  // Vector-only or no FTS5 snippet available — body-slice fallback.
  if (body.length <= 220) {
    return body;
  }
  return `${body.slice(0, 220)}…`;
}

function hydrateResult(
  row: Record<string, unknown>,
  scores: SearchResult["scores"],
  matchedVia: SearchResult["matchedVia"]
): SearchResult {
  const body = String(row.body);
  const ftsSnippet = (row.fts_snippet as string | null) ?? null;
  return {
    passageId: String(row.passage_id),
    body,
    readerNote: (row.reader_note as string | null) ?? undefined,
    snippet: buildSnippet(body, ftsSnippet, matchedVia),
    work: {
      id: String(row.work_id),
      displayTitle: String(row.display_title),
      creator: (row.creator as string | null) ?? undefined,
      coverImageUrl: (row.cover_image_url as string | null) ?? undefined
    },
    position: formatPosition(row.position_start, row.position_end),
    markedAt: (row.marked_at as string | null) ?? undefined,
    labels: parseLabels(row.labels_json),
    isStarred: Number(row.is_starred) === 1,
    scores,
    matchedVia
  };
}
```

Then update the hydration query (search the file for the `JOIN works` SELECT used to hydrate results) so the SELECT additionally projects `snippet(passages_fts, 0, '<mark>', '</mark>', '…', 32) AS fts_snippet`. The hydration query path for FTS5 hits joins `passages_fts` — add the snippet expression in that SELECT. For vector-only hits the hydration query doesn't join `passages_fts`; project `NULL AS fts_snippet` to keep the column shape consistent.

If the file has two hydration paths (one per retriever), add `fts_snippet` to both. The repository file is `packages/search/src/repositories/searchRepository.ts` — if the SELECT is implemented there, update it there instead and have `searchService` pass through the new column.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @archi/search test -- searchService.test.ts
```

Expected: PASS for both new cases. All existing tests still PASS.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm --filter @archi/search typecheck
pnpm --filter @archi/search lint
```

Expected: PASS on both.

- [ ] **Step 6: Commit**

```bash
git add packages/search/src/query/searchService.ts packages/search/src/repositories/searchRepository.ts packages/search/tests/searchService.test.ts
git commit -m "$(cat <<'EOF'
search: emit FTS5 snippet with <mark> for keyword/both, body slice for vector

Replaces the previous snippet:body that bypassed FTS5's snippet() and
the renderer's <mark> CSS. Hybrid matches now return a snippet centered
on the matched span; vector-only matches return the first 220 chars +
ellipsis.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Search repository — `getFacets()`

**Files:**
- Modify: `packages/search/src/types.ts`
- Modify: `packages/search/src/index.ts`
- Modify: `packages/search/src/repositories/searchRepository.ts`
- Modify: `packages/search/src/query/searchService.ts`
- Test: `packages/search/tests/searchRepository.test.ts`

- [ ] **Step 1: Add the type**

Append to `packages/search/src/types.ts`:

```ts
export type Facets = {
  creators: string[];
  labels: string[];
};
```

- [ ] **Step 2: Export from package barrel**

Add `Facets` to the existing export list in `packages/search/src/index.ts`.

- [ ] **Step 3: Write the failing test**

Append to `packages/search/tests/searchRepository.test.ts`:

```ts
describe("getFacets", () => {
  it("returns sorted, deduped creators across all works", () => {
    const facets = repo.getFacets();
    expect(facets.creators).toEqual([...facets.creators].sort());
    expect(facets.creators).toEqual([...new Set(facets.creators)]);
    // Fixture has Marcus Aurelius among others
    expect(facets.creators).toContain("Marcus Aurelius");
  });

  it("returns sorted, deduped labels parsed from passages.labels_json", () => {
    const facets = repo.getFacets();
    expect(facets.labels).toEqual([...facets.labels].sort());
    expect(facets.labels).toEqual([...new Set(facets.labels)]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
pnpm --filter @archi/search test -- searchRepository.test.ts
```

Expected: FAIL — `repo.getFacets is not a function`.

- [ ] **Step 5: Implement `getFacets()`**

In `packages/search/src/repositories/searchRepository.ts`, add the method to the `SearchRepository` class (place near the other read methods):

```ts
getFacets(): Facets {
  const creatorRows = this.db
    .prepare(
      `SELECT DISTINCT creator
         FROM works
        WHERE creator IS NOT NULL AND creator != ''
        ORDER BY creator COLLATE NOCASE`
    )
    .all() as { creator: string }[];

  const labelRows = this.db
    .prepare(
      `SELECT DISTINCT value
         FROM passages, json_each(passages.labels_json)
        WHERE passages.labels_json IS NOT NULL
        ORDER BY value COLLATE NOCASE`
    )
    .all() as { value: string }[];

  return {
    creators: creatorRows.map((r) => r.creator),
    labels: labelRows.map((r) => r.value)
  };
}
```

Import the `Facets` type at the top of the file: `import type { Facets } from "../types.js";`.

- [ ] **Step 6: Expose via `SearchService`**

In `packages/search/src/query/searchService.ts`, add a method:

```ts
getFacets(): Facets {
  return this.options.repo.getFacets();
}
```

Import `Facets` if not already imported.

- [ ] **Step 7: Run test to verify it passes**

```bash
pnpm --filter @archi/search test -- searchRepository.test.ts
```

Expected: PASS for both new cases.

- [ ] **Step 8: Typecheck and lint**

```bash
pnpm --filter @archi/search typecheck && pnpm --filter @archi/search lint
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/search
git commit -m "$(cat <<'EOF'
search: add getFacets() returning sorted deduped creators + labels

Replaces the renderer's wasteful pattern of doing a 200-row search.query
just to derive a creator list. Backs the new filter-chip popover.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Facets IPC — main, preload, env.d.ts

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts:215-222`
- Modify: `apps/desktop/src/renderer/env.d.ts`

- [ ] **Step 1: Wire the main handler**

In `apps/desktop/src/main/index.ts`, find the block where existing search IPC handlers are registered (search for `archi:search:query`). Add adjacent:

```ts
ipcMain.handle("archi:search:facets", async () => {
  return getSearchService().getFacets();
});
```

(Use whatever the existing accessor is — `searchService` instance, `getSearchService()`, or similar — match the pattern used by `archi:search:query`.)

- [ ] **Step 2: Expose in preload**

In `apps/desktop/src/preload/index.ts`, update the `search:` block (currently lines 215–222) to add:

```ts
search: {
  query: (q: SearchQuery): Promise<SearchResponse> =>
    ipcRenderer.invoke("archi:search:query", q),
  indexerStatus: (): Promise<IndexerStatus> =>
    ipcRenderer.invoke("archi:search:indexerStatus"),
  startIndexing: (): Promise<{ started: boolean }> =>
    ipcRenderer.invoke("archi:search:startIndexing"),
  facets: (): Promise<Facets> =>
    ipcRenderer.invoke("archi:search:facets")
}
```

Add `Facets` to the imports at the top of the preload file.

- [ ] **Step 3: Add to `env.d.ts`**

In `apps/desktop/src/renderer/env.d.ts`, find the `search:` block in the `archi` global declaration and add:

```ts
facets: () => Promise<{ creators: string[]; labels: string[] }>;
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS across all packages.

- [ ] **Step 5: Smoke test the new endpoint**

Start the desktop app:

```bash
pnpm --filter @archi/desktop dev
```

In the renderer DevTools console:

```js
await window.archi.search.facets()
```

Expected: an object `{ creators: ["..."], labels: ["..."] }` returns without error.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/env.d.ts
git commit -m "$(cat <<'EOF'
desktop: add archi:search:facets IPC for filter-chip popover

Renderer can now fetch creators + labels in one call instead of issuing
a 200-row no-op search.query just to derive them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `IndexerStatusProvider` + `useIndexerStatus()` hook

**Files:**
- Create: `apps/desktop/src/renderer/state/IndexerStatusContext.tsx`

- [ ] **Step 1: Create the context file**

```tsx
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { IndexerStatus } from "@archi/search";

type ContextValue = {
  status: IndexerStatus | null;
  start: () => Promise<void>;
  starting: boolean;
};

const IndexerStatusContext = createContext<ContextValue | null>(null);

type ProviderProps = {
  pollMs?: number;
  children: React.ReactNode;
};

export function IndexerStatusProvider({ pollMs = 2000, children }: ProviderProps): JSX.Element {
  const [status, setStatus] = useState<IndexerStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const next = await window.archi.search.indexerStatus();
        if (!aliveRef.current) return;
        setStatus(next);
      } catch {
        // ignore transient IPC failures
      } finally {
        if (aliveRef.current) {
          timer = setTimeout(tick, pollMs);
        }
      }
    };
    void tick();
    return () => {
      aliveRef.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [pollMs]);

  const start = useCallback(async () => {
    setStarting(true);
    try {
      await window.archi.search.startIndexing();
    } finally {
      setStarting(false);
    }
  }, []);

  return (
    <IndexerStatusContext.Provider value={{ status, start, starting }}>
      {children}
    </IndexerStatusContext.Provider>
  );
}

export function useIndexerStatus(): ContextValue {
  const ctx = useContext(IndexerStatusContext);
  if (!ctx) {
    throw new Error("useIndexerStatus must be used inside <IndexerStatusProvider>");
  }
  return ctx;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @archi/desktop typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/state/IndexerStatusContext.tsx
git commit -m "$(cat <<'EOF'
desktop: add IndexerStatusProvider + useIndexerStatus() hook

Single polling source backs the sidebar pill, IndexingBanner, and
GlobalSearchBar 'results may be partial' line. Replaces per-component
polling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `SearchPreferencesProvider` + `useSearchPreferences()` hook

**Files:**
- Create: `apps/desktop/src/renderer/state/SearchPreferencesContext.tsx`

- [ ] **Step 1: Create the context file**

```tsx
import { createContext, useCallback, useContext, useEffect, useState } from "react";

type SearchPreferences = {
  showMatchSource: boolean;
  includeArchived: boolean;
  includeHidden: boolean;
};

type ContextValue = SearchPreferences & {
  setShowMatchSource: (value: boolean) => void;
  setIncludeArchived: (value: boolean) => void;
  setIncludeHidden: (value: boolean) => void;
};

const DEFAULTS: SearchPreferences = {
  showMatchSource: true,
  includeArchived: false,
  includeHidden: false
};

const KEYS = {
  showMatchSource: "search.showMatchSource",
  includeArchived: "search.includeArchived",
  includeHidden: "search.includeHidden"
} as const;

const SearchPreferencesContext = createContext<ContextValue | null>(null);

export function SearchPreferencesProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [prefs, setPrefs] = useState<SearchPreferences>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [showMatchSource, includeArchived, includeHidden] = await Promise.all([
        window.archi.preferences.get<boolean>(KEYS.showMatchSource, DEFAULTS.showMatchSource),
        window.archi.preferences.get<boolean>(KEYS.includeArchived, DEFAULTS.includeArchived),
        window.archi.preferences.get<boolean>(KEYS.includeHidden, DEFAULTS.includeHidden)
      ]);
      if (cancelled) return;
      setPrefs({ showMatchSource, includeArchived, includeHidden });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(
    (key: keyof SearchPreferences, value: boolean) => {
      setPrefs((current) => ({ ...current, [key]: value }));
      void window.archi.preferences.set(KEYS[key], value);
    },
    []
  );

  const value: ContextValue = {
    ...prefs,
    setShowMatchSource: (v) => persist("showMatchSource", v),
    setIncludeArchived: (v) => persist("includeArchived", v),
    setIncludeHidden: (v) => persist("includeHidden", v)
  };

  return (
    <SearchPreferencesContext.Provider value={value}>{children}</SearchPreferencesContext.Provider>
  );
}

export function useSearchPreferences(): ContextValue {
  const ctx = useContext(SearchPreferencesContext);
  if (!ctx) {
    throw new Error("useSearchPreferences must be used inside <SearchPreferencesProvider>");
  }
  return ctx;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @archi/desktop typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/state/SearchPreferencesContext.tsx
git commit -m "$(cat <<'EOF'
desktop: add SearchPreferencesProvider + useSearchPreferences() hook

Persists showMatchSource / includeArchived / includeHidden via existing
preferences IPC under the search.* namespace. Backs the new Settings
screen and the SearchScreen filter overrides.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `HighlightedText` component

**Files:**
- Create: `apps/desktop/src/renderer/components/HighlightedText.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { Fragment } from "react";

type Props = {
  snippet: string;
};

const MARK_REGEX = /(<mark>.*?<\/mark>)/g;

export function HighlightedText({ snippet }: Props): JSX.Element {
  const parts = snippet.split(MARK_REGEX);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("<mark>") && part.endsWith("</mark>") ? (
          <mark key={i}>{part.slice("<mark>".length, -"</mark>".length)}</mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @archi/desktop typecheck
```

Expected: PASS.

- [ ] **Step 3: Manual verify in DevTools (after dev server is running)**

In a temporary scratch render (or by visiting Search and triggering a query that produces highlights), confirm the component parses `<mark>foo</mark>` into a real `<mark>` element. Inspect the DOM — there should be an actual `<mark>` element, not literal text.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/HighlightedText.tsx
git commit -m "$(cat <<'EOF'
desktop: add HighlightedText component for FTS5 snippet rendering

Parses <mark>...</mark> from snippet strings into real <mark> React
elements without dangerouslySetInnerHTML. Consumed by SearchResultCard
and GlobalSearchBar dropdown rows next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `SearchResultCard` refactor — expand/collapse, accessibility, dedupe

**Files:**
- Modify: `apps/desktop/src/renderer/components/SearchResultCard.tsx`
- Modify: `apps/desktop/src/renderer/styles.css` (add `.search-result-card--expanded`, collapsed 3-line clamp on `.search-result-card__body--collapsed`)

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `apps/desktop/src/renderer/components/SearchResultCard.tsx` with:

```tsx
import { useState } from "react";
import type { SearchResult } from "@archi/search";
import { HighlightedText } from "./HighlightedText";
import { FindSimilarButton } from "./FindSimilarButton";

type Props = {
  result: SearchResult;
  showMatchSource: boolean;
  expanded: boolean;
  onToggle: () => void;
  onOpenWork: (workId: string, passageId: string) => void;
  onOpenSearchScreen: (query: string) => void;
};

const matchLabel: Record<SearchResult["matchedVia"], string> = {
  vector: "meaning",
  fts5: "keyword",
  both: "meaning + keyword"
};

export function SearchResultCard({
  result,
  showMatchSource,
  expanded,
  onToggle,
  onOpenWork,
  onOpenSearchScreen
}: Props): JSX.Element {
  const [copied, setCopied] = useState(false);

  const copyBody = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(result.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard write can reject in unusual sandbox states; silently swallow.
    }
  };

  const cardId = `search-result-${result.passageId}`;
  const bodyId = `${cardId}-body`;

  return (
    <article
      className={`search-result-card${expanded ? " search-result-card--expanded" : ""}`}
      id={cardId}
    >
      <button
        type="button"
        className="search-result-card__expand-toggle"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={onToggle}
        aria-label={expanded ? "Collapse result" : "Expand result"}
      />
      <header className="search-result-card__header">
        {result.isStarred && (
          <span className="search-result-card__starred" aria-label="Starred" title="Starred">
            ★
          </span>
        )}
        <span className="search-result-card__source">
          {result.work.creator && (
            <span className="search-result-card__source-creator">{result.work.creator}</span>
          )}
          {result.work.creator && " · "}
          {result.work.displayTitle}
          {result.position && (
            <>
              {" · "}
              <span className="search-result-card__source-position">{result.position}</span>
            </>
          )}
        </span>
        {showMatchSource && (
          <span
            className="search-result-card__match-source"
            data-via={result.matchedVia}
            title="How this result was found"
          >
            {matchLabel[result.matchedVia]}
          </span>
        )}
      </header>
      <p
        id={bodyId}
        className={`search-result-card__body${expanded ? "" : " search-result-card__body--collapsed"}`}
      >
        <HighlightedText snippet={expanded ? result.body : result.snippet} />
      </p>
      {expanded && result.readerNote && (
        <p className="search-result-card__note">
          <strong>Note</strong>
          {result.readerNote}
        </p>
      )}
      {expanded && (
        <div
          className="passage-card-actions"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <FindSimilarButton
            passageBody={result.body}
            onOpenSearchScreen={onOpenSearchScreen}
          />
          <button
            type="button"
            className="passage-card-action"
            onClick={() => onOpenWork(result.work.id, result.passageId)}
            title="Open this book in Library"
          >
            <span className="passage-card-action-icon" aria-hidden="true">↗</span>
            Open book
          </button>
          <button
            type="button"
            className={`passage-card-action ${copied ? "passage-card-action-success" : ""}`}
            onClick={() => {
              void copyBody();
            }}
            title="Copy quote to clipboard"
          >
            <span className="passage-card-action-icon" aria-hidden="true">{copied ? "✓" : "⎘"}</span>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {result.markedAt && (
        <footer className="search-result-card__footer">
          Marked {new Date(result.markedAt).toLocaleDateString()}
        </footer>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Add the supporting CSS**

In `apps/desktop/src/renderer/styles.css`, after the existing `.search-result-card` block (around line 2190), add:

```css
.search-result-card {
  position: relative;
}

.search-result-card__expand-toggle {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  z-index: 1;
}

.search-result-card__expand-toggle:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 50%, transparent);
  outline-offset: 2px;
  border-radius: inherit;
}

.search-result-card > *:not(.search-result-card__expand-toggle) {
  position: relative;
  z-index: 2;
}

.search-result-card__body--collapsed {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.search-result-card--expanded {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  box-shadow: 0 14px 32px rgba(88, 63, 43, 0.10);
}
```

- [ ] **Step 3: Update inline reveal CSS**

The existing rule at `styles.css:1783-1785`:

```css
.search-result-card:hover .passage-card-actions,
.search-result-card:focus-within .passage-card-actions {
```

Is now moot because the expanded card always shows actions (they're only rendered in JSX when expanded) and the collapsed card doesn't show them at all. Replace that rule with:

```css
.search-result-card--expanded .passage-card-actions {
  display: flex;
}
```

(Keep the rule near the other `.passage-card-actions` rules around line 1770.)

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @archi/desktop typecheck
```

Expected: callers will break because `SearchResultCard`'s prop signature changed (`onOpen` → `onToggle`, `onFindSimilar` → `onOpenSearchScreen`, new `expanded` prop). That's the failing edge we resolve in Task 12.

For this commit, the SearchScreen consumer needs a minimal stub: edit `SearchScreen.tsx` only enough to compile. Add a placeholder `expanded={false}`, `onToggle={() => {}}` to the existing call site so the build is green. The real wiring lands in Task 12.

```diff
- <SearchResultCard
-   key={r.passageId}
-   result={r}
-   showMatchSource={showMatchSource}
-   onOpen={onOpenPassage}
-   onOpenWork={onOpenWork}
-   onFindSimilar={onFindSimilar}
- />
+ <SearchResultCard
+   key={r.passageId}
+   result={r}
+   showMatchSource={showMatchSource}
+   expanded={false}
+   onToggle={() => {}}
+   onOpenWork={(workId) => onOpenWork(workId)}
+   onOpenSearchScreen={onFindSimilar}
+ />
```

The `(workId) => onOpenWork(workId)` wrapper is the cheapest way to satisfy the new two-arg signature against the still-one-arg SearchScreen prop — Task 12 widens the SearchScreen prop and removes the wrapper.

Re-run typecheck. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/SearchResultCard.tsx apps/desktop/src/renderer/components/HighlightedText.tsx apps/desktop/src/renderer/screens/SearchScreen.tsx apps/desktop/src/renderer/styles.css
git commit -m "$(cat <<'EOF'
desktop: SearchResultCard expands inline + uses HighlightedText

Drops role=button on the article (a11y), introduces an invisible overlay
button with aria-expanded/aria-controls for the click target. Collapsed
card renders the FTS5 snippet clamped to 3 lines; expanded renders the
full body. Match-source label gated on the showMatchSource prop.
FindSimilarButton replaces the duplicate inline action. SearchScreen
stubbed with expanded=false to keep build green pending Task 12.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `GlobalSearchBar` refactor — one callback, escalate clear, dropdown states

**Files:**
- Modify: `apps/desktop/src/renderer/components/GlobalSearchBar.tsx`
- Modify: `apps/desktop/src/renderer/styles.css` (add `.global-search-bar__partial-line`, `.global-search-bar__empty-row`)

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `apps/desktop/src/renderer/components/GlobalSearchBar.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult } from "@archi/search";
import { useIndexerStatus } from "../state/IndexerStatusContext";
import { HighlightedText } from "./HighlightedText";

type Props = {
  onEscalate: (query: string, expandPassageId?: string) => void;
};

export function GlobalSearchBar({ onEscalate }: Props): JSX.Element {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { status } = useIndexerStatus();

  // ⌘K focuses input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Outside-click closes dropdown
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // Debounced query
  useEffect(() => {
    if (!open || text.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const res = await window.archi.search.query({ text, filters: {}, limit: 5 });
      setResults(res.results);
      setHighlighted(0);
    }, 150);
    return () => clearTimeout(handle);
  }, [text, open]);

  const escalate = useCallback(
    (expandPassageId?: string) => {
      const q = text;
      onEscalate(q, expandPassageId);
      setText("");
      setOpen(false);
      setResults([]);
    },
    [text, onEscalate]
  );

  const submit = useCallback(() => {
    const target = results[highlighted];
    if (target) {
      escalate(target.passageId);
    } else if (text.trim().length >= 2) {
      escalate();
    }
  }, [results, highlighted, escalate, text]);

  const showPartialLine =
    status !== null &&
    (status.status === "running" || (status.indexed < status.total && status.status === "idle"));

  const hasQuery = text.trim().length >= 2;
  const showEmpty = open && hasQuery && results.length === 0;

  return (
    <div className="global-search-bar" ref={containerRef}>
      <input
        ref={inputRef}
        className="global-search-bar__input"
        type="search"
        value={text}
        placeholder="Search highlights…"
        onFocus={() => setOpen(true)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((h) => Math.min(h + 1, results.length - 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((h) => Math.max(0, h - 1));
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.metaKey || e.ctrlKey || results.length === 0) {
              escalate();
            } else {
              submit();
            }
          }
        }}
        aria-label="Global search"
      />
      <span className="global-search-bar__shortcut" aria-hidden="true">⌘K</span>
      {open && (results.length > 0 || showEmpty) && (
        <div className="global-search-bar__dropdown" role="listbox">
          {showPartialLine && (
            <div className="global-search-bar__partial-line" role="status">
              Results may be partial — {status!.indexed.toLocaleString()} / {status!.total.toLocaleString()} indexed
            </div>
          )}
          {results.map((r, i) => (
            <div
              key={r.passageId}
              role="option"
              aria-selected={i === highlighted}
              className={`global-search-bar__row ${i === highlighted ? "is-highlighted" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                escalate(r.passageId);
              }}
              onMouseEnter={() => setHighlighted(i)}
            >
              <div className="global-search-bar__row-body">
                <HighlightedText snippet={r.snippet} />
              </div>
              <div className="global-search-bar__row-meta">
                {r.work.creator ? `${r.work.creator} · ` : ""}{r.work.displayTitle}
              </div>
            </div>
          ))}
          {showEmpty && (
            <button
              type="button"
              className="global-search-bar__empty-row"
              onMouseDown={(e) => {
                e.preventDefault();
                escalate();
              }}
            >
              No matches. Press <kbd>⌘↵</kbd> to open Search.
            </button>
          )}
          {results.length > 0 && (
            <button
              type="button"
              className="global-search-bar__see-all"
              onMouseDown={(e) => {
                e.preventDefault();
                escalate();
              }}
            >
              <span>See all results</span>
              <kbd>⌘↵</kbd>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

Note: tasks land in order — Task 1 already shipped the FTS5 `<mark>` snippet output and Task 6 shipped `HighlightedText`, so the dropdown can render highlights immediately.

- [ ] **Step 2: Add the new CSS rules**

In `apps/desktop/src/renderer/styles.css`, after the existing `.global-search-bar__see-all kbd` block (~line 2593), add:

```css
.global-search-bar__partial-line {
  padding: 6px 11px 8px;
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--warning, #b07a1d);
  border-bottom: 1px solid color-mix(in srgb, var(--warning) 22%, transparent);
  margin-bottom: 4px;
}

.global-search-bar__empty-row {
  width: 100%;
  padding: 12px 11px;
  background: transparent;
  border: none;
  text-align: center;
  font-size: 12.5px;
  color: var(--ink-500);
  cursor: pointer;
  border-radius: 9px;
}

.global-search-bar__empty-row kbd {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10.5px;
  background: color-mix(in srgb, var(--ink-100) 38%, transparent);
  border: 1px solid color-mix(in srgb, var(--ink-300) 30%, transparent);
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--ink-700);
}

.global-search-bar__empty-row:hover {
  background: color-mix(in srgb, var(--accent-soft) 40%, transparent);
  color: var(--ink-700);
}
```

- [ ] **Step 3: Stub the App.tsx call site to compile**

The prop signature changed from two callbacks to one. In `apps/desktop/src/renderer/App.tsx`, find the existing usage in the header:

```diff
-          <GlobalSearchBar
-            onOpenPassage={openPassageFromSearch}
-            onOpenSearchScreen={openSearchScreenWithQuery}
-          />
+          <GlobalSearchBar
+            onEscalate={(query, passageId) => {
+              openSearchScreenWithQuery(query);
+              // passageId wiring lands in Task 14
+            }}
+          />
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @archi/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/GlobalSearchBar.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css
git commit -m "$(cat <<'EOF'
desktop: GlobalSearchBar — one callback, escalate clears, partial+empty states

Replaces (onOpenPassage, onOpenSearchScreen) with a single onEscalate
(query, expandPassageId?) prop. After escalating, the bar clears.
Outside-click closes the dropdown without the onBlur setTimeout hack.
Adds 'results may be partial' line when the shared indexer is running
and a 'No matches. Press ⌘↵ to open Search.' empty-state row.

App.tsx call site stubbed; full expand-via-passage wiring lands in
Task 14.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `SearchFilterChips` overhaul — popover + Book + Date + Label

**Files:**
- Modify: `apps/desktop/src/renderer/components/SearchFilterChips.tsx` (full rewrite)
- Modify: `apps/desktop/src/renderer/styles.css` (add `.search-filter-popover`, `.search-filter-popover__row`)

- [ ] **Step 1: Rewrite the component**

Replace `apps/desktop/src/renderer/components/SearchFilterChips.tsx` with:

```tsx
import { useEffect, useRef, useState } from "react";
import type { SearchFilters } from "@archi/search";

type Props = {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
};

type LibraryWork = {
  id: string;
  title: string;
  creator?: string;
};

type Facets = { creators: string[]; labels: string[] };

const COLORS = ["yellow", "pink", "orange", "blue"] as const;

export function SearchFilterChips({ filters, onChange }: Props): JSX.Element {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [activeDimension, setActiveDimension] = useState<string | null>(null);
  const [facets, setFacets] = useState<Facets>({ creators: [], labels: [] });
  const [works, setWorks] = useState<LibraryWork[]>([]);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.archi.search.facets().then(setFacets).catch(() => {});
    void window.archi.listWorks().then(setWorks).catch(() => {});
  }, []);

  useEffect(() => {
    if (!popoverOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) {
        setPopoverOpen(false);
        setActiveDimension(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPopoverOpen(false);
        setActiveDimension(null);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  const removeFilter = (key: keyof SearchFilters) => {
    const next = { ...filters };
    delete next[key];
    onChange(next);
  };

  const setCreator = (creator: string) => {
    onChange({ ...filters, creator });
    setPopoverOpen(false);
    setActiveDimension(null);
  };

  const setWorkId = (workId: string) => {
    onChange({ ...filters, workIds: [workId] });
    setPopoverOpen(false);
    setActiveDimension(null);
  };

  const setColor = (color: string) => {
    onChange({ ...filters, markerColor: color });
    setPopoverOpen(false);
    setActiveDimension(null);
  };

  const toggleLabel = (label: string) => {
    const current = filters.labels ?? [];
    const next = current.includes(label) ? current.filter((l) => l !== label) : [...current, label];
    onChange(next.length > 0 ? { ...filters, labels: next } : { ...filters, labels: undefined });
  };

  const setDateRange = (markedAfter?: string, markedBefore?: string) => {
    const next: SearchFilters = { ...filters };
    if (markedAfter) next.markedAfter = markedAfter; else delete next.markedAfter;
    if (markedBefore) next.markedBefore = markedBefore; else delete next.markedBefore;
    onChange(next);
  };

  const activeWorkTitle = filters.workIds?.[0]
    ? works.find((w) => w.id === filters.workIds![0])?.title ?? filters.workIds[0]
    : null;
  const dateSummary =
    filters.markedAfter || filters.markedBefore
      ? `${filters.markedAfter ?? "…"} → ${filters.markedBefore ?? "…"}`
      : null;

  return (
    <div className="search-filter-chips" ref={popoverRef}>
      {filters.creator && (
        <span className="search-filter-chip">
          <span className="search-filter-chip__label">Author</span>
          <span className="search-filter-chip__value">{filters.creator}</span>
          <button
            type="button"
            className="search-filter-chip__remove"
            onClick={() => removeFilter("creator")}
            aria-label="Remove author filter"
          >×</button>
        </span>
      )}
      {activeWorkTitle && (
        <span className="search-filter-chip">
          <span className="search-filter-chip__label">Book</span>
          <span className="search-filter-chip__value">{activeWorkTitle}</span>
          <button
            type="button"
            className="search-filter-chip__remove"
            onClick={() => removeFilter("workIds")}
            aria-label="Remove book filter"
          >×</button>
        </span>
      )}
      {filters.isStarred && (
        <span className="search-filter-chip">
          <span className="search-filter-chip__label">Starred only</span>
          <button
            type="button"
            className="search-filter-chip__remove"
            onClick={() => removeFilter("isStarred")}
            aria-label="Remove starred filter"
          >×</button>
        </span>
      )}
      {filters.markerColor && (
        <span className="search-filter-chip">
          <span className="search-filter-chip__label">Color</span>
          <span className="search-filter-chip__value">{filters.markerColor}</span>
          <button
            type="button"
            className="search-filter-chip__remove"
            onClick={() => removeFilter("markerColor")}
            aria-label="Remove color filter"
          >×</button>
        </span>
      )}
      {(filters.labels ?? []).map((label) => (
        <span key={label} className="search-filter-chip">
          <span className="search-filter-chip__label">Label</span>
          <span className="search-filter-chip__value">{label}</span>
          <button
            type="button"
            className="search-filter-chip__remove"
            onClick={() => toggleLabel(label)}
            aria-label={`Remove ${label} label filter`}
          >×</button>
        </span>
      ))}
      {dateSummary && (
        <span className="search-filter-chip">
          <span className="search-filter-chip__label">Date</span>
          <span className="search-filter-chip__value">{dateSummary}</span>
          <button
            type="button"
            className="search-filter-chip__remove"
            onClick={() => setDateRange(undefined, undefined)}
            aria-label="Remove date filter"
          >×</button>
        </span>
      )}

      <button
        type="button"
        className="search-filter-chip search-filter-chip--add"
        onClick={() => setPopoverOpen((v) => !v)}
        aria-expanded={popoverOpen}
      >
        + Add filter
      </button>

      {popoverOpen && (
        <div className="search-filter-popover" role="menu">
          {activeDimension === null && (
            <>
              <button type="button" className="search-filter-popover__row" onClick={() => setActiveDimension("author")}>Author</button>
              <button type="button" className="search-filter-popover__row" onClick={() => setActiveDimension("book")}>Book</button>
              <button type="button" className="search-filter-popover__row" onClick={() => { onChange({ ...filters, isStarred: true }); setPopoverOpen(false); }}>Starred only</button>
              <button type="button" className="search-filter-popover__row" onClick={() => setActiveDimension("color")}>Marker color</button>
              <button type="button" className="search-filter-popover__row" onClick={() => setActiveDimension("label")}>Label</button>
              <button type="button" className="search-filter-popover__row" onClick={() => setActiveDimension("date")}>Date range</button>
            </>
          )}
          {activeDimension === "author" && (
            <div className="search-filter-popover__panel">
              {facets.creators.length === 0 && <p>No authors yet.</p>}
              {facets.creators.map((c) => (
                <button key={c} type="button" className="search-filter-popover__row" onClick={() => setCreator(c)}>{c}</button>
              ))}
            </div>
          )}
          {activeDimension === "book" && (
            <div className="search-filter-popover__panel">
              {works.length === 0 && <p>No books yet.</p>}
              {works.map((w) => (
                <button key={w.id} type="button" className="search-filter-popover__row" onClick={() => setWorkId(w.id)}>
                  {w.title}{w.creator ? ` · ${w.creator}` : ""}
                </button>
              ))}
            </div>
          )}
          {activeDimension === "color" && (
            <div className="search-filter-popover__panel">
              {COLORS.map((c) => (
                <button key={c} type="button" className="search-filter-popover__row" onClick={() => setColor(c)}>{c}</button>
              ))}
            </div>
          )}
          {activeDimension === "label" && (
            <div className="search-filter-popover__panel">
              {facets.labels.length === 0 && <p>No labels in your highlights yet.</p>}
              {facets.labels.map((l) => {
                const active = (filters.labels ?? []).includes(l);
                return (
                  <button
                    key={l}
                    type="button"
                    className={`search-filter-popover__row${active ? " is-active" : ""}`}
                    onClick={() => toggleLabel(l)}
                  >
                    {active ? "✓ " : ""}{l}
                  </button>
                );
              })}
            </div>
          )}
          {activeDimension === "date" && (
            <div className="search-filter-popover__panel search-filter-popover__panel--date">
              <label>
                From
                <input
                  type="date"
                  value={filters.markedAfter ?? ""}
                  onChange={(e) => setDateRange(e.target.value || undefined, filters.markedBefore)}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={filters.markedBefore ?? ""}
                  onChange={(e) => setDateRange(filters.markedAfter, e.target.value || undefined)}
                />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the popover CSS**

In `apps/desktop/src/renderer/styles.css`, after the existing `.search-filter-chips select` block (~line 2454), add:

```css
.search-filter-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 40;
  display: grid;
  gap: 2px;
  min-width: 220px;
  max-width: 320px;
  max-height: 380px;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid color-mix(in srgb, var(--ink-300) 48%, transparent);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: 0 18px 36px rgba(88, 63, 43, 0.16);
}

.search-filter-popover__row {
  width: 100%;
  padding: 8px 10px;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  color: var(--ink-700);
  cursor: pointer;
}

.search-filter-popover__row:hover {
  background: color-mix(in srgb, var(--accent-soft) 50%, transparent);
  color: var(--accent-strong);
}

.search-filter-popover__row.is-active {
  background: color-mix(in srgb, var(--accent-soft) 70%, transparent);
  color: var(--accent-strong);
}

.search-filter-popover__panel {
  display: grid;
  gap: 2px;
}

.search-filter-popover__panel--date {
  padding: 8px 10px;
  gap: 6px;
}

.search-filter-popover__panel--date label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-500);
}
```

- [ ] **Step 3: Update `SearchScreen` call site to drop `availableCreators`**

The new component manages its own facets fetch. In `apps/desktop/src/renderer/screens/SearchScreen.tsx`, find and delete:

- The `availableCreators` state and its useEffect (currently lines 26 + 36–44).
- The `availableCreators` prop on `<SearchFilterChips />`.

Leave the rest of the file alone — Task 12 does the full refactor.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @archi/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/SearchFilterChips.tsx apps/desktop/src/renderer/screens/SearchScreen.tsx apps/desktop/src/renderer/styles.css
git commit -m "$(cat <<'EOF'
desktop: SearchFilterChips popover with Book + Date + Label

Replaces the inline pill-row menu with an anchored popover that closes
on outside-click + Esc. Adds Book filter (single workId via
window.archi.listWorks), Date range (two date inputs producing
markedAfter / markedBefore), and Quote label (multi-select from
facets). Drops the wasteful availableCreators heuristic on
SearchScreen in favor of the new search.facets() IPC.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `IndexerStatusPill` sidebar component

**Files:**
- Create: `apps/desktop/src/renderer/components/IndexerStatusPill.tsx`
- Modify: `apps/desktop/src/renderer/styles.css` (add `.indexer-status-pill` rules)

- [ ] **Step 1: Create the component**

```tsx
import { useIndexerStatus } from "../state/IndexerStatusContext";

type Props = {
  collapsed: boolean;
};

export function IndexerStatusPill({ collapsed }: Props): JSX.Element | null {
  const { status, start, starting } = useIndexerStatus();

  if (!status) return null;

  if (status.status === "idle" && status.indexed >= status.total) {
    return null;
  }

  const tone =
    status.status === "failed" || status.status === "unavailable" ? "error" : "info";

  const dotChar =
    status.status === "running" ? "●" : status.status === "failed" || status.status === "unavailable" ? "⚠" : "○";

  let label: string;
  if (status.status === "unavailable") {
    label = "Search degraded";
  } else if (status.status === "failed") {
    label = "Indexing failed";
  } else if (status.status === "running") {
    label = `Indexing ${status.indexed.toLocaleString()} / ${status.total.toLocaleString()}`;
  } else {
    const pending = status.total - status.indexed;
    label = `${pending.toLocaleString()} pending`;
  }

  const title =
    status.status === "failed" || status.status === "unavailable"
      ? status.lastError ?? "Embedding service unavailable. Keyword search still works."
      : label;

  const clickable = status.status === "idle" && status.indexed < status.total;

  if (clickable) {
    return (
      <button
        type="button"
        className={`indexer-status-pill indexer-status-pill--${tone}`}
        onClick={() => void start()}
        disabled={starting}
        title={title}
        aria-live="polite"
      >
        <span className="indexer-status-pill__dot" aria-hidden="true">{dotChar}</span>
        {!collapsed && <span className="indexer-status-pill__label">{starting ? "Starting…" : label}</span>}
      </button>
    );
  }

  return (
    <div
      className={`indexer-status-pill indexer-status-pill--${tone}`}
      title={title}
      aria-live="polite"
      role="status"
    >
      <span className="indexer-status-pill__dot" aria-hidden="true">{dotChar}</span>
      {!collapsed && <span className="indexer-status-pill__label">{label}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Add CSS**

In `apps/desktop/src/renderer/styles.css`, near the existing sidebar block, add:

```css
.indexer-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  margin: 4px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-soft) 24%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--ink-300) 30%, transparent);
  color: var(--ink-700);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: default;
}

.indexer-status-pill--error {
  background: color-mix(in srgb, var(--error, #c84c3c) 10%, var(--surface));
  border-color: color-mix(in srgb, var(--error, #c84c3c) 36%, transparent);
  color: var(--accent-strong);
}

button.indexer-status-pill {
  cursor: pointer;
}

button.indexer-status-pill:hover {
  background: color-mix(in srgb, var(--accent-soft) 48%, var(--surface));
}

.indexer-status-pill__dot {
  font-size: 11px;
}

.sidebar-collapsed .indexer-status-pill {
  padding: 6px;
  margin: 4px;
  justify-content: center;
}
```

- [ ] **Step 3: Wire it into the sidebar in App.tsx**

In `apps/desktop/src/renderer/App.tsx`, add the import:

```ts
import { IndexerStatusPill } from "./components/IndexerStatusPill";
```

Mount it between `sidebar-divider` and `<SupportButton ... />`:

```diff
        <div className="sidebar-divider" aria-hidden="true" />
+       <IndexerStatusPill collapsed={sidebarCollapsed} />
        <SupportButton collapsed={sidebarCollapsed} />
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @archi/desktop typecheck
```

Expected: FAIL because `App.tsx` calls `useIndexerStatus()` via `IndexerStatusPill` but `IndexerStatusProvider` isn't mounted yet. Wrap the main return:

In `App.tsx`, after `import { IndexerStatusProvider } from "./state/IndexerStatusContext";` is added, wrap the final return value:

```diff
   return (
-    <>
+    <IndexerStatusProvider>
       <UpdateBanner />
       <main className={`layout${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
       ...
       </main>
       <SupportPromptModal open={supportPromptOpen} onClose={() => setSupportPromptOpen(false)} />
-    </>
+    </IndexerStatusProvider>
   );
```

Re-run typecheck. Expected: PASS.

- [ ] **Step 5: Update `IndexingBanner` to consume the shared hook**

In `apps/desktop/src/renderer/components/IndexingBanner.tsx`, replace the local polling with the shared hook:

```tsx
import { useState } from "react";
import { useIndexerStatus } from "../state/IndexerStatusContext";

export function IndexingBanner(): JSX.Element | null {
  const { status, start, starting } = useIndexerStatus();
  const [dismissed, setDismissed] = useState(false);

  if (!status || dismissed) return null;

  if (status.status === "unavailable") {
    return (
      <div className="indexing-banner indexing-banner--error" role="status">
        Semantic search is unavailable. Keyword search still works.
      </div>
    );
  }

  if (status.status === "idle" && status.indexed >= status.total) {
    return null;
  }

  if (status.status === "idle" && status.indexed < status.total) {
    const pending = status.total - status.indexed;
    return (
      <div className="indexing-banner" role="status">
        <span>{pending.toLocaleString()} highlights pending semantic indexing</span>
        <button type="button" className="indexing-banner__cta" onClick={() => void start()} disabled={starting}>
          {starting ? "Starting…" : "Start indexing"}
        </button>
        <button type="button" aria-label="Dismiss" onClick={() => setDismissed(true)}>✕</button>
      </div>
    );
  }

  return (
    <div className="indexing-banner" role="status">
      <span>
        Indexing {status.indexed.toLocaleString()} of {status.total.toLocaleString()} highlights…
      </span>
      <button type="button" aria-label="Dismiss" onClick={() => setDismissed(true)}>✕</button>
    </div>
  );
}
```

The component no longer takes any props. Update the JSX site in `SearchScreen.tsx` if it passed any.

- [ ] **Step 6: Manual scenario**

```bash
pnpm --filter @archi/desktop dev
```

1. Open app, sidebar pill is hidden if the corpus is already indexed.
2. Trigger reindex via DevTools console: `await window.archi.search.startIndexing()`. Watch sidebar pill flip to "● Indexing X / Y" within ~2 s; updates as backfill progresses; disappears when complete.
3. Navigate between Home / Library / Logs — pill stays in sidebar, visible everywhere.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/components/IndexerStatusPill.tsx apps/desktop/src/renderer/components/IndexingBanner.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css
git commit -m "$(cat <<'EOF'
desktop: sidebar IndexerStatusPill + IndexingBanner uses shared hook

Pill subscribes to IndexerStatusProvider; hidden when idle and complete,
clickable when idle-but-pending, plain status when running, error tone
when failed/unavailable. IndexingBanner drops its own polling and
subscribes to the same provider.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `SettingsScreen` + sidebar entry

**Files:**
- Create: `apps/desktop/src/renderer/screens/SettingsScreen.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` (add Settings to screens tuple, render branch, icon, ⌘, shortcut)
- Modify: `apps/desktop/src/renderer/styles.css` (add `.settings-screen` rules)

- [ ] **Step 1: Create the screen**

```tsx
import { useIndexerStatus } from "../state/IndexerStatusContext";
import { useSearchPreferences } from "../state/SearchPreferencesContext";
import { EMBEDDING_MODEL_ID } from "@archi/search";

function Toggle({
  checked,
  onChange,
  ariaLabel
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`settings-toggle${checked ? " is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-toggle__thumb" />
    </button>
  );
}

function SettingsRow({
  label,
  description,
  control
}: {
  label: string;
  description: string;
  control: JSX.Element;
}): JSX.Element {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <div className="settings-row__label">{label}</div>
        <div className="settings-row__description">{description}</div>
      </div>
      <div className="settings-row__control">{control}</div>
    </div>
  );
}

export function SettingsScreen(): JSX.Element {
  const prefs = useSearchPreferences();
  const { status } = useIndexerStatus();

  return (
    <section className="settings-screen">
      <header className="settings-screen__section-header">
        <h2>Search</h2>
      </header>
      <SettingsRow
        label="Show match-source labels"
        description="Show whether each result matched by meaning, keyword, or both."
        control={
          <Toggle
            checked={prefs.showMatchSource}
            onChange={prefs.setShowMatchSource}
            ariaLabel="Show match-source labels"
          />
        }
      />
      <SettingsRow
        label="Include archived passages"
        description="Off by default. Turning this on adds archived highlights to all search results."
        control={
          <Toggle
            checked={prefs.includeArchived}
            onChange={prefs.setIncludeArchived}
            ariaLabel="Include archived passages"
          />
        }
      />
      <SettingsRow
        label="Include hidden passages"
        description="Off by default."
        control={
          <Toggle
            checked={prefs.includeHidden}
            onChange={prefs.setIncludeHidden}
            ariaLabel="Include hidden passages"
          />
        }
      />
      <hr className="settings-screen__divider" />
      <div className="settings-screen__index-status">
        <div className="settings-row__label">Index status</div>
        <div className="settings-row__description">
          {status
            ? `${status.indexed.toLocaleString()} / ${status.total.toLocaleString()} indexed`
            : "Loading…"}
          {" · "}
          <code>{EMBEDDING_MODEL_ID}</code>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Add to sidebar tuple, icon, render branch in App.tsx**

In `apps/desktop/src/renderer/App.tsx`:

```diff
- const screens = ["Home", "Library", "Search", "Connections", "Logs"] as const;
+ const screens = ["Home", "Library", "Search", "Connections", "Logs", "Settings"] as const;
```

Add the icon entry:

```ts
Settings: (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.5v2 M8 12.5v2 M1.5 8h2 M12.5 8h2 M3.05 3.05l1.42 1.42 M11.53 11.53l1.42 1.42 M3.05 12.95l1.42-1.42 M11.53 4.47l1.42-1.42" />
  </svg>
),
```

Add `SettingsScreen` import:

```ts
import { SettingsScreen } from "./screens/SettingsScreen";
```

Wrap the entire return in `<SearchPreferencesProvider>` (inside `<IndexerStatusProvider>`):

```diff
   return (
     <IndexerStatusProvider>
+      <SearchPreferencesProvider>
       <UpdateBanner />
       ...
       <SupportPromptModal open={supportPromptOpen} onClose={() => setSupportPromptOpen(false)} />
+      </SearchPreferencesProvider>
     </IndexerStatusProvider>
   );
```

Add the screen render branch:

```ts
case "Settings":
  return <SettingsScreen />;
```

Add ⌘, shortcut. Find the existing `useEffect` for keyboard shortcuts (or add one if none). Add:

```ts
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === ",") {
      e.preventDefault();
      setActiveScreen("Settings");
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);
```

- [ ] **Step 3: Add CSS**

In `apps/desktop/src/renderer/styles.css`, append:

```css
.settings-screen {
  display: grid;
  gap: 12px;
  align-content: start;
  max-width: 720px;
}

.settings-screen__section-header h2 {
  margin: 0;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-500);
}

.settings-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16px;
  align-items: center;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--surface) 84%, #fff);
  border: 1px solid color-mix(in srgb, var(--ink-300) 36%, transparent);
  border-radius: 12px;
}

.settings-row__label {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink-900);
}

.settings-row__description {
  font-size: 12.5px;
  color: var(--ink-500);
  margin-top: 2px;
}

.settings-screen__divider {
  border: none;
  border-top: 1px solid color-mix(in srgb, var(--ink-300) 30%, transparent);
  margin: 12px 0 4px;
}

.settings-screen__index-status {
  padding: 12px 14px;
}

.settings-screen__index-status code {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 12px;
  color: var(--ink-700);
}

.settings-toggle {
  appearance: none;
  width: 38px;
  height: 22px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ink-300) 32%, transparent);
  border: 1px solid color-mix(in srgb, var(--ink-300) 50%, transparent);
  position: relative;
  cursor: pointer;
  transition: background-color 140ms ease;
}

.settings-toggle.is-on {
  background: var(--accent);
  border-color: var(--accent);
}

.settings-toggle__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: #fff;
  transition: transform 140ms ease;
}

.settings-toggle.is-on .settings-toggle__thumb {
  transform: translateX(16px);
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @archi/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Manual scenario**

Start dev. Open Settings via sidebar click and via `⌘,`. Toggle each setting. Restart app. Confirm toggle states persist.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/screens/SettingsScreen.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css
git commit -m "$(cat <<'EOF'
desktop: add Settings screen with Search section

Six-item sidebar adds Settings at the end. Search section exposes
showMatchSource / includeArchived / includeHidden toggles persisted
via the preferences IPC, plus an index-status read-out. ⌘, opens
Settings from anywhere.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `SearchScreen` refactor — preferences, single expandedId, controlled props

**Files:**
- Modify: `apps/desktop/src/renderer/screens/SearchScreen.tsx`

- [ ] **Step 1: Rewrite the screen**

Replace `apps/desktop/src/renderer/screens/SearchScreen.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchFilters, SearchResponse } from "@archi/search";
import { SearchResultCard } from "../components/SearchResultCard";
import { SearchFilterChips } from "../components/SearchFilterChips";
import { IndexingBanner } from "../components/IndexingBanner";
import { useSearchPreferences } from "../state/SearchPreferencesContext";
import { useIndexerStatus } from "../state/IndexerStatusContext";

type Props = {
  initialQuery: string;
  pendingExpandPassageId: string | null;
  onOpenWork: (workId: string, passageId: string) => void;
  onOpenSearchScreen: (query: string) => void;
};

export function SearchScreen({
  initialQuery,
  pendingExpandPassageId,
  onOpenWork,
  onOpenSearchScreen
}: Props): JSX.Element {
  const prefs = useSearchPreferences();
  const { status: indexerStatus } = useIndexerStatus();
  const [text, setText] = useState(initialQuery);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});

  // Auto-grow the textarea so a long find-similar seed is fully visible.
  const resizeInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, []);
  useEffect(() => {
    resizeInput();
  }, [text, resizeInput]);

  // Focus input on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Sync controlled initialQuery prop.
  useEffect(() => {
    setText(initialQuery);
  }, [initialQuery]);

  // ⌘/ refocuses search input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (e.key === "Escape" && expandedId !== null) {
        setExpandedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedId]);

  const runQuery = useCallback(
    async (q: string, f: SearchFilters) => {
      setLoading(true);
      try {
        const mergedFilters: SearchFilters = {
          ...f,
          isArchived: prefs.includeArchived ? true : f.isArchived,
          isHidden: prefs.includeHidden ? true : f.isHidden
        };
        const res = await window.archi.search.query({ text: q, filters: mergedFilters, limit: 50 });
        setResponse(res);
      } finally {
        setLoading(false);
      }
    },
    [prefs.includeArchived, prefs.includeHidden]
  );

  // Debounced live query.
  useEffect(() => {
    const handle = setTimeout(() => {
      void runQuery(text, filters);
    }, 150);
    return () => clearTimeout(handle);
  }, [text, filters, runQuery]);

  // When pendingExpandPassageId arrives, expand that card and scroll to it.
  useEffect(() => {
    if (!pendingExpandPassageId) return;
    if (!response?.results.some((r) => r.passageId === pendingExpandPassageId)) return;
    setExpandedId(pendingExpandPassageId);
    const node = cardRefs.current[pendingExpandPassageId];
    if (node) {
      node.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [pendingExpandPassageId, response]);

  const summary = useMemo(() => {
    if (!response) return "";
    return `Showing ${response.results.length} of ${response.totalCandidates} candidates (${response.durationMs} ms)`;
  }, [response]);

  const hasQuery = text.trim().length > 0;
  const isEmpty = !hasQuery && !loading;
  const helperCorpusLabel =
    indexerStatus !== null ? `${indexerStatus.total.toLocaleString()} highlights` : "your highlights";

  const clearFilters = () => setFilters({});

  return (
    <section className="search-screen">
      <textarea
        ref={inputRef}
        className="search-screen__input"
        placeholder="Search highlights…"
        value={text}
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter alone shouldn't insert a newline — query auto-runs via debounce.
          // Shift+Enter still inserts a newline for users who genuinely want one.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            inputRef.current?.blur();
          }
        }}
        aria-label="Search highlights"
      />
      <SearchFilterChips filters={filters} onChange={setFilters} />
      <div className="search-screen__summary">{loading ? "Searching…" : summary}</div>
      <div className="search-screen__results">
        {isEmpty ? (
          <p className="search-screen__hint">
            Type to search {helperCorpusLabel} · <kbd>⌘K</kbd> from anywhere · click a book in
            Library to browse one.
          </p>
        ) : (
          <>
            {response?.results.map((r) => (
              <div
                key={r.passageId}
                ref={(node) => {
                  cardRefs.current[r.passageId] = node;
                }}
              >
                <SearchResultCard
                  result={r}
                  showMatchSource={prefs.showMatchSource}
                  expanded={expandedId === r.passageId}
                  onToggle={() =>
                    setExpandedId((current) => (current === r.passageId ? null : r.passageId))
                  }
                  onOpenWork={onOpenWork}
                  onOpenSearchScreen={onOpenSearchScreen}
                />
              </div>
            ))}
            {response && response.results.length === 0 && !loading && (
              <div className="search-screen__empty">
                <p>No matches.</p>
                {Object.keys(filters).length > 0 && (
                  <button type="button" className="passage-card-action" onClick={clearFilters}>
                    Remove all filters
                  </button>
                )}
                {hasQuery && (
                  <button type="button" className="passage-card-action" onClick={() => setText("")}>
                    Clear query
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <IndexingBanner />
    </section>
  );
}
```

- [ ] **Step 2: Update `.search-screen__input` CSS to support multi-line**

In `apps/desktop/src/renderer/styles.css`, replace the existing `.search-screen__input` rule (lines ~2111–2125) with:

```css
.search-screen__input {
  display: block;
  width: 100%;
  max-width: 720px;
  min-height: 50px;
  max-height: 168px;
  padding: 13px 16px;
  font-size: 16px;
  font-family: Newsreader, Georgia, serif;
  font-weight: 500;
  line-height: 1.45;
  letter-spacing: -0.005em;
  color: var(--ink-900);
  background: color-mix(in srgb, var(--surface) 88%, #fff);
  border: 1px solid color-mix(in srgb, var(--ink-300) 42%, transparent);
  border-radius: 14px;
  box-shadow: 0 1px 0 rgba(88, 63, 43, 0.04);
  transition: border-color 140ms ease, box-shadow 140ms ease;
  resize: none;
  overflow-y: auto;
  field-sizing: content; /* progressive enhancement; JS resize is the canonical path */
}
```

`field-sizing: content` is a progressive-enhancement nice-to-have (Chromium 123+; Electron 30+ includes it). The JS-driven resize in Step 1 is the authoritative behavior — `field-sizing: content` just keeps the input at its content size during the brief window before React commits the height effect, eliminating visible flicker.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @archi/desktop typecheck
```

Expected: FAIL because `App.tsx` still passes the old props (`onFindSimilar`, `onOpenPassage`, `searchScreenInstance`). Update the `App.tsx` call site:

```diff
       case "Search":
         return (
           <SearchScreen
-            key={`search-${searchScreenInstance}`}
             initialQuery={searchInitialQuery}
-            onOpenPassage={openPassageFromSearch}
+            pendingExpandPassageId={pendingExpandPassageId}
             onOpenWork={(workId) => {
               setSelectedLibraryWorkId(workId);
               setActiveScreen("Library");
             }}
-            onFindSimilar={openSearchScreenWithQuery}
+            onOpenSearchScreen={openSearchScreenWithQuery}
           />
         );
```

Add `pendingExpandPassageId` state and clear it after Search renders:

```ts
const [pendingExpandPassageId, setPendingExpandPassageId] = useState<string | null>(null);
```

Remove the `searchScreenInstance` state declaration and remove `searchScreenInstance` from any `useMemo` dependency arrays. Remove `openPassageFromSearch` callback declaration.

Re-run typecheck. Expected: PASS.

- [ ] **Step 4: Manual scenario**

Start dev.

1. Click two collapsed cards in sequence — only the second is expanded. Press Esc on an expanded card — it collapses.
2. Press ⌘/ — input focuses and selects.
3. Toggle "Include archived" in Settings → return to Search → results widen on next character typed.
4. From any passage, click "Find similar" — the Search input expands vertically to show the entire seeded passage (up to 4 lines), then scrolls internally. Pressing Enter does NOT insert a newline; Shift+Enter does.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/screens/SearchScreen.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css
git commit -m "$(cat <<'EOF'
desktop: SearchScreen single-expand model + preferences + controlled props

Drops the searchScreenInstance re-mount hack — initialQuery and
pendingExpandPassageId now flow as controlled props. One expandedId at
a time. Search settings (showMatchSource, includeArchived,
includeHidden) merged into outgoing filters via
SearchPreferencesProvider. ⌘/ refocuses the input.

The input is now a textarea that auto-grows to fit a long find-similar
seed (capped at ~4 lines, then scrolls). Enter blurs instead of
inserting a newline; Shift+Enter still inserts one. Removes the
horizontal-clip problem where long seeded queries were invisible.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `LibraryBookDetailScreen` — `pendingScrollPassageId`, ring, breadcrumb

**Files:**
- Modify: `apps/desktop/src/renderer/screens/LibraryBookDetailScreen.tsx`
- Modify: `apps/desktop/src/renderer/styles.css` (add `.library-quote-card--ringed` keyframe)

- [ ] **Step 1: Extend the props**

In `apps/desktop/src/renderer/screens/LibraryBookDetailScreen.tsx`, update the `Props` type:

```ts
type Props = {
  work: LibraryWork;
  onOpenSearchScreen: (query: string) => void;
  pendingScrollPassageId?: string | null;
  breadcrumbFromSearch?: boolean;
  onBackToSearch?: () => void;
};
```

Accept and destructure the new props in the function signature.

- [ ] **Step 2: Implement scroll + ring**

Inside the component, after the existing useEffects, add:

```ts
const ringRefs = useRef<Record<string, HTMLLIElement | null>>({});
const [ringed, setRinged] = useState<string | null>(null);

useEffect(() => {
  if (!pendingScrollPassageId) return;
  if (!passages.some((p) => p.id === pendingScrollPassageId)) return;
  const node = ringRefs.current[pendingScrollPassageId];
  if (!node) return;
  node.scrollIntoView({ block: "center", behavior: "smooth" });
  setRinged(pendingScrollPassageId);
  const timer = window.setTimeout(() => setRinged(null), 1500);
  return () => window.clearTimeout(timer);
}, [pendingScrollPassageId, passages]);
```

Wire each `<li>` to capture a ref and apply the ring class:

```diff
- <li key={passage.id} className="library-quote-card">
+ <li
+   key={passage.id}
+   className={`library-quote-card${ringed === passage.id ? " library-quote-card--ringed" : ""}`}
+   ref={(node) => {
+     ringRefs.current[passage.id] = node;
+   }}
+ >
```

- [ ] **Step 3: Render the breadcrumb**

The `content-eyebrow` slot lives in `App.tsx`, not in `LibraryBookDetailScreen` itself — App.tsx already handles the eyebrow ("Library", "‹ Library", etc.). We add the breadcrumb in App.tsx in Task 14. The `LibraryBookDetailScreen` itself does NOT render the breadcrumb. Skip this step for this task.

- [ ] **Step 4: Add CSS for the ring**

In `apps/desktop/src/renderer/styles.css`, append:

```css
.library-quote-card--ringed {
  animation: library-quote-ring 1500ms ease-out 1;
  position: relative;
}

@keyframes library-quote-ring {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 60%, transparent);
  }
  60% {
    box-shadow: 0 0 0 8px color-mix(in srgb, var(--accent) 10%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent);
  }
}
```

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @archi/desktop typecheck
```

Expected: FAIL because the App.tsx call site doesn't pass `pendingScrollPassageId`. Stub with `pendingScrollPassageId={null}` for now (real wiring in Task 14):

```diff
        if (selectedWork) {
-         return <LibraryBookDetailScreen work={selectedWork} onOpenSearchScreen={openSearchScreenWithQuery} />;
+         return (
+           <LibraryBookDetailScreen
+             work={selectedWork}
+             onOpenSearchScreen={openSearchScreenWithQuery}
+             pendingScrollPassageId={null}
+           />
+         );
        }
```

Re-run typecheck. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/screens/LibraryBookDetailScreen.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css
git commit -m "$(cat <<'EOF'
desktop: LibraryBookDetailScreen scrolls + rings on pendingScrollPassageId

When the prop is set, scrolls the matching quote card into view and
pulses a 1.5s ring around it. App.tsx wiring stubbed; full reveal flow
lands in Task 14.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: `App.tsx` final wiring — reveal callbacks, breadcrumb, ⌘/ shortcut

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`

- [ ] **Step 1: Add the unified callbacks**

In `apps/desktop/src/renderer/App.tsx`, after `openSearchScreenWithQuery`, add:

```ts
const openSearchScreenForPassage = useCallback((query: string, expandPassageId?: string): void => {
  setSearchInitialQuery(query);
  setPendingExpandPassageId(expandPassageId ?? null);
  setSelectedLibraryWorkId(null);
  setActiveScreen("Search");
}, []);

const openBookAtPassage = useCallback((workId: string, passageId: string): void => {
  setSelectedLibraryWorkId(workId);
  setPendingScrollPassageId(passageId);
  setBreadcrumbFromSearch(true);
  setActiveScreen("Library");
}, []);
```

Add the supporting state:

```ts
const [pendingScrollPassageId, setPendingScrollPassageId] = useState<string | null>(null);
const [breadcrumbFromSearch, setBreadcrumbFromSearch] = useState(false);
```

Add a back-to-search callback:

```ts
const backToSearch = useCallback((): void => {
  setBreadcrumbFromSearch(false);
  setSelectedLibraryWorkId(null);
  setActiveScreen("Search");
}, []);
```

- [ ] **Step 2: Wire the GlobalSearchBar callback**

Replace the stub from Task 8:

```diff
-          <GlobalSearchBar
-            onEscalate={(query, passageId) => {
-              openSearchScreenWithQuery(query);
-              // passageId wiring lands in Task 14
-            }}
-          />
+          <GlobalSearchBar onEscalate={openSearchScreenForPassage} />
```

- [ ] **Step 3: Wire the Search screen `pendingExpandPassageId` clear**

After Search has rendered with the pending id, we should clear it so subsequent re-renders don't re-scroll. The simplest approach: clear when the user starts typing OR when they click elsewhere. Add to the `setText` handler indirectly via the SearchScreen — already handled by the screen's own useEffect that uses `pendingExpandPassageId` only when it matches a result. To prevent stale re-fires, add a clear-after-consume effect inside App when activeScreen leaves Search:

```ts
useEffect(() => {
  if (activeScreen !== "Search") {
    setPendingExpandPassageId(null);
  }
}, [activeScreen]);
```

- [ ] **Step 4: Wire `openBookAtPassage` into the Search render branch**

`SearchResultCard` (Task 7) and `SearchScreen` (Task 12) already declared `onOpenWork: (workId, passageId) => void`, and `SearchResultCard` already calls it with `(result.work.id, result.passageId)`. The Search render branch in `App.tsx` just needs the callback wired:

```diff
       case "Search":
         return (
           <SearchScreen
             initialQuery={searchInitialQuery}
             pendingExpandPassageId={pendingExpandPassageId}
-            onOpenWork={(workId) => {
-              setSelectedLibraryWorkId(workId);
-              setActiveScreen("Library");
-            }}
+            onOpenWork={openBookAtPassage}
             onOpenSearchScreen={openSearchScreenWithQuery}
           />
         );
```

- [ ] **Step 5: Render the breadcrumb in the header**

In `App.tsx`, find the `content-header` JSX and adjust:

```diff
          <div>
-           {selectedWork ? (
+           {selectedWork && breadcrumbFromSearch ? (
+             <button
+               type="button"
+               className="content-eyebrow content-eyebrow-link"
+               onClick={backToSearch}
+             >
+               <span aria-hidden="true">‹</span> Search results
+             </button>
+           ) : selectedWork ? (
              <button
                type="button"
                className="content-eyebrow content-eyebrow-link"
                onClick={() => setSelectedLibraryWorkId(null)}
              >
                <span aria-hidden="true">‹</span> Library
              </button>
            ) : (
              <p className="content-eyebrow">Workspace</p>
            )}
            <h1>{selectedWork ? selectedWork.title : activeScreen}</h1>
            {selectedWork ? <p className="content-subtitle">{selectedWork.creator || "Unknown author"}</p> : null}
          </div>
```

- [ ] **Step 6: Wire `pendingScrollPassageId` on the Library detail render**

```diff
         if (selectedWork) {
           return (
             <LibraryBookDetailScreen
               work={selectedWork}
               onOpenSearchScreen={openSearchScreenWithQuery}
-              pendingScrollPassageId={null}
+              pendingScrollPassageId={pendingScrollPassageId}
             />
           );
         }
```

Add a clear-after-consume on screen change:

```ts
useEffect(() => {
  if (activeScreen !== "Library") {
    setPendingScrollPassageId(null);
  }
}, [activeScreen]);
```

- [ ] **Step 7: Add ⌘/ shortcut at App level**

Add a new effect that jumps to Search and focuses its input. Since the SearchScreen owns its input focus, the App-level handler only needs to set `activeScreen` — the screen's own ⌘/ handler picks up the rest:

```ts
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "/") {
      e.preventDefault();
      setActiveScreen("Search");
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);
```

Note: SearchScreen already handles ⌘/ for refocus; this top-level handler ensures it works when on a different screen.

- [ ] **Step 8: Typecheck**

```bash
pnpm --filter @archi/desktop typecheck
```

Expected: PASS.

- [ ] **Step 9: Manual scenario (spec §11.2 #1–8)**

1. Type "anger" in global bar → dropdown shows ≥1 result → click a row → Search screen opens with that result expanded + scrolled into view, query preserved.
2. On the expanded card, click "Open book" → Library detail opens, scrolls to passage, rings ~1.5s. Header shows "‹ Search results" → click returns to Search with prior state.
3. Type "asdfqwerty" in global bar → dropdown shows "No matches. Press ⌘↵ to open Search." → press ⌘↵ → Search opens with text="asdfqwerty"; empty state shows; global bar is cleared.
4. ⌘/ from Home → lands on Search, input focused.
5. ⌘, from Home → lands on Settings.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/components/SearchResultCard.tsx
git commit -m "$(cat <<'EOF'
desktop: wire result-click reveals (inline expand + Open Book scroll-to)

GlobalSearchBar.onEscalate routes through openSearchScreenForPassage.
'Open Book' on an expanded card sets a pendingScrollPassageId on Library
detail and a breadcrumbFromSearch flag for the '‹ Search results' link.
⌘/ jumps to Search from anywhere.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: `NotionScreen` text fix + final verification pass

**Files:**
- Modify: `apps/desktop/src/renderer/screens/NotionScreen.tsx:10`

- [ ] **Step 1: Replace stale Passages reference**

In `apps/desktop/src/renderer/screens/NotionScreen.tsx`, find the line:

```tsx
<p>On first run, Archi auto-creates Library and Passages databases.</p>
```

Replace with:

```tsx
<p>On first run, Archi auto-creates your Library database in Notion and syncs your highlights as related entries.</p>
```

- [ ] **Step 2: Whole-repo gates**

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Expected: all PASS.

- [ ] **Step 3: Manual verification of remaining spec §11.2 scenarios**

Walk scenarios 9–12 from the spec:

9. Search screen filter chip "+ Add filter" → popover shows 6 dimensions; pick Date range → two date inputs; set range → results filter; chip shows the range.
10. Result card snippet contains `<mark>` highlights for keyword matches (verify via DevTools — the DOM has `<mark>` elements, not literal text).
11. Screen reader (VoiceOver, ⌘F5 to toggle): focus on a result card. Expected announcement: "Article. Expand result, button." Press space to expand. Now actions are reachable via Tab; each is announced as its own button.
12. Indexer pill: kill embedder process (touch `apps/desktop/resources/models/bge-small-en-v1.5/onnx/model_quantized.onnx` to make load fail, or stop the indexer service via DevTools). Pill flips to `⚠ Search degraded` or `⚠ Indexing failed`. Hover shows the lastError via title attribute.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/screens/NotionScreen.tsx
git commit -m "$(cat <<'EOF'
desktop: NotionScreen — drop stale Passages databases reference

The Passages renderer screen and Notion 'passages' database concept no
longer exist; this screen now describes the current single-database
Library-with-related-highlights setup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist

After implementing all 15 tasks, run the spec coverage check:

| Spec §3 item | Resolved by Task |
|---|---|
| 1. Click reveals passage | 7 (expand), 14 (Open Book scroll-to) |
| 2. Indexer state visible app-wide | 4 (provider), 10 (sidebar pill) |
| 3. Snippet/highlight pipeline | 1 (backend), 6 (HighlightedText), 7 (SearchResultCard) |
| 4. NotionScreen stale text | 15 |
| 5. Missing filter dimensions | 9 |
| 6. Settings surface | 5 (provider), 11 (screen) |
| 7. FindSimilarButton dedupe | 7 (consumed in SearchResultCard) |
| 8. Dropdown zero-state | 8 |
| 9. Escalate clears global bar | 8 |
| 10. Direct Search keyboard shortcut | 14 (⌘/) |
| 11. SearchScreen re-mount hack | 12 |
| 12. Accessibility on result card | 7 |
| 13. IndexingBanner polling dedupe | 10 (consumes shared hook) |

All items have an owning task. No gaps.
