# UI Consolidation: drop Passages, sharpen Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the Archi desktop renderer's nav from three highlight-related screens (Library / Passages / Search) into two top-level workspaces (Library / Search), folding Passages's per-row actions into the Search result card and deleting Passages outright.

**Architecture:** Frontend-only refactor inside `apps/desktop/src/renderer/`. No IPC, schema, or `@archi/search` package changes. The new Search screen reuses the existing `passage-card-*` CSS classes from Passages so visual continuity is preserved. The `Find similar` flow keeps using the existing `searchInitialQuery` + `searchScreenInstance` plumbing.

**Tech Stack:** React 18, TypeScript, Vite, Electron, existing `@archi/search` hybrid retrieval (vec0 + FTS5 + RRF). No new dependencies.

**Verification model:** This refactor has no automated test coverage on the affected screens. Each task ends with a manual verification step (run the dev server, click through the relevant flow). The plan is structured so the dev server stays usable after every commit — you should be able to revert any single task and the app still launches and the existing flows still work.

**Spec reference:** `docs/superpowers/specs/2026-06-04-ui-consolidation-search-first-design.md`

---

## File map

| File | Action | Why |
|---|---|---|
| `apps/desktop/src/renderer/components/SearchResultCard.tsx` | Modify | Add Copy / Open book / Find similar row actions. |
| `apps/desktop/src/renderer/screens/SearchScreen.tsx` | Modify | Pass new callbacks down to `SearchResultCard`; add empty-state helper line. |
| `apps/desktop/src/renderer/App.tsx` | Modify | Reorder sidebar, drop `Passages` from screens tuple, remove `PassagesScreen` import + render branch, update `openPassageFromSearch` to point to Search, pass `onOpenWork` to `SearchScreen`. |
| `apps/desktop/src/renderer/screens/PassagesScreen.tsx` | Delete | No longer reachable; functionality folded into Search. |
| `apps/desktop/src/renderer/styles.css` | Modify | Delete `.passages-screen` / `.passages-list-*` / `.passages-filters` / `.content[data-screen="Passages"]` rules. Keep `.passage-card*` and `.passage-card-action*` rules (Search result card now uses them). |

---

## Task 1: Plumb Copy / Open book / Find similar through `SearchResultCard`

The new Search screen needs the three row actions Passages had. We extend the card's prop signature to accept callbacks for each, then render the same action buttons + copied-confirmation pattern that `PassagesScreen.tsx` uses today (lines 35-76 and 143-174). Reusing the existing `.passage-card-actions` / `.passage-card-action` CSS classes keeps the visual unchanged.

**Files:**
- Modify: `apps/desktop/src/renderer/components/SearchResultCard.tsx`

- [ ] **Step 1: Replace the file contents with the extended version**

```tsx
import { useState } from "react";
import type { SearchResult } from "@archi/search";

type Props = {
  result: SearchResult;
  showMatchSource: boolean;
  onOpen: (passageId: string) => void;
  onOpenWork: (workId: string) => void;
  onFindSimilar: (passageBody: string) => void;
};

const matchLabel: Record<SearchResult["matchedVia"], string> = {
  vector: "meaning",
  fts5: "keyword",
  both: "meaning + keyword"
};

export function SearchResultCard({
  result,
  showMatchSource,
  onOpen,
  onOpenWork,
  onFindSimilar
}: Props) {
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

  return (
    <article
      className="search-result-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(result.passageId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(result.passageId);
        }
      }}
    >
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
      <p className="search-result-card__body">{result.snippet}</p>
      {result.readerNote && (
        <p className="search-result-card__note">
          <strong>Note</strong>
          {result.readerNote}
        </p>
      )}
      <div
        className="passage-card-actions"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="passage-card-action"
          onClick={() => onFindSimilar(result.body)}
          title="Find passages similar to this one"
        >
          <span className="passage-card-action-icon" aria-hidden="true">≈</span>
          Find similar
        </button>
        <button
          type="button"
          className="passage-card-action"
          onClick={() => onOpenWork(result.work.id)}
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
      {result.markedAt && (
        <footer className="search-result-card__footer">
          Marked {new Date(result.markedAt).toLocaleDateString()}
        </footer>
      )}
    </article>
  );
}
```

Note the `onClick={(e) => e.stopPropagation()}` on the `passage-card-actions` wrapper: without it, clicking an action button would also bubble up and trigger the card's `onClick` (which opens the passage). The same applies to keyboard events.

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @archi/desktop typecheck 2>&1 | tail -20`

Expected: failures on `SearchScreen.tsx` because it doesn't yet pass the new required `onOpenWork` / `onFindSimilar` props. That's expected — we wire them in Task 2. Anything ELSE failing means review the diff against Step 1.

- [ ] **Step 3: Stage but do not commit yet**

The file compiles in isolation; the consumer breaks. We'll commit Task 1 + Task 2 together once `SearchScreen.tsx` is wired up so the tree compiles between commits.

```bash
git add apps/desktop/src/renderer/components/SearchResultCard.tsx
```

---

## Task 2: Wire callbacks + empty-state helper into `SearchScreen`

`SearchScreen` needs to:
1. Accept and forward `onOpenWork` and `onFindSimilar` callbacks to each `SearchResultCard`.
2. Render an empty-state helper line below the input when the user hasn't typed anything.
3. Pull the live total passage count from `window.archi.search.indexerStatus()` for the helper-line copy.

**Files:**
- Modify: `apps/desktop/src/renderer/screens/SearchScreen.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchFilters, SearchResponse } from "@archi/search";
import { SearchResultCard } from "../components/SearchResultCard";
import { SearchFilterChips } from "../components/SearchFilterChips";
import { IndexingBanner } from "../components/IndexingBanner";

type Props = {
  initialQuery?: string;
  onOpenPassage: (passageId: string) => void;
  onOpenWork: (workId: string) => void;
  onFindSimilar: (passageBody: string) => void;
  showMatchSource?: boolean;
};

export function SearchScreen({
  initialQuery = "",
  onOpenPassage,
  onOpenWork,
  onFindSimilar,
  showMatchSource = true
}: Props) {
  const [text, setText] = useState(initialQuery);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [availableCreators, setAvailableCreators] = useState<string[]>([]);
  const [totalPassages, setTotalPassages] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load available creators once for the filter dropdown.
  useEffect(() => {
    void (async () => {
      const browseRes = await window.archi.search.query({ text: "", filters: {}, limit: 200 });
      const unique = Array.from(
        new Set(browseRes.results.map((r) => r.work.creator).filter((c): c is string => Boolean(c)))
      ).sort();
      setAvailableCreators(unique);
    })();
  }, []);

  // Load indexer status for the empty-state helper line.
  useEffect(() => {
    void (async () => {
      try {
        const status = await window.archi.search.indexerStatus();
        setTotalPassages(status.total);
      } catch {
        setTotalPassages(null);
      }
    })();
  }, []);

  const runQuery = useCallback(async (q: string, f: SearchFilters) => {
    setLoading(true);
    try {
      const res = await window.archi.search.query({ text: q, filters: f, limit: 50 });
      setResponse(res);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced live query.
  useEffect(() => {
    const handle = setTimeout(() => {
      void runQuery(text, filters);
    }, 150);
    return () => clearTimeout(handle);
  }, [text, filters, runQuery]);

  const summary = useMemo(() => {
    if (!response) return "";
    return `Showing ${response.results.length} of ${response.totalCandidates} candidates (${response.durationMs} ms)`;
  }, [response]);

  const hasQuery = text.trim().length > 0;
  const isEmpty = !hasQuery && !loading;
  const helperCorpusLabel =
    totalPassages !== null ? `${totalPassages.toLocaleString()} highlights` : "your highlights";

  return (
    <section className="search-screen">
      <input
        ref={inputRef}
        className="search-screen__input"
        type="search"
        placeholder="Search highlights…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Search highlights"
      />
      <SearchFilterChips filters={filters} onChange={setFilters} availableCreators={availableCreators} />
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
              <SearchResultCard
                key={r.passageId}
                result={r}
                showMatchSource={showMatchSource}
                onOpen={onOpenPassage}
                onOpenWork={onOpenWork}
                onFindSimilar={onFindSimilar}
              />
            ))}
            {response && response.results.length === 0 && !loading && (
              <div className="search-screen__empty">
                No matches. Try fewer filters or different words.
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

- [ ] **Step 2: Add the helper-line style to `styles.css`**

Open `apps/desktop/src/renderer/styles.css` and find the existing `.search-screen__empty` rule. Add a `.search-screen__hint` rule next to it:

Search for `.search-screen__empty` in the file. Right above or below it, add:

```css
.search-screen__hint {
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary, #8a857a);
  font-style: italic;
  padding: 48px 16px 8px;
  margin: 0;
}

.search-screen__hint kbd {
  font-family: inherit;
  background: var(--surface-2, #f0ebe0);
  border: 1px solid var(--border, #d8d2c6);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 11px;
}
```

If you can't find `.search-screen__empty` (it may not exist yet as a styled class), add both rules near the other `.search-screen__*` rules.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @archi/desktop typecheck 2>&1 | tail -20`

Expected: failures on `App.tsx` because `SearchScreen` now requires `onOpenWork` and `onFindSimilar` props that aren't being passed. That's expected — Task 3 wires them. No errors should reference `SearchScreen.tsx` or `SearchResultCard.tsx` themselves.

- [ ] **Step 4: Stage**

```bash
git add apps/desktop/src/renderer/screens/SearchScreen.tsx apps/desktop/src/renderer/styles.css
```

---

## Task 3: Wire `SearchScreen` props from `App.tsx`, swap `openPassageFromSearch` target

App.tsx already has `openSearchScreenWithQuery` (the "find similar" handler) and a "open the book in Library" callback in the Passages render branch. We:
1. Pass `onOpenWork` (uses the same handler as the Passages branch).
2. Pass `onFindSimilar` (reuses `openSearchScreenWithQuery`).
3. Change `openPassageFromSearch` to navigate to `"Search"` instead of `"Passages"` — the user clicked a result from inside Search; we just clear the work selection and stay put (effectively a no-op now, but we keep the call for future "open passage detail" expansion).

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`

- [ ] **Step 1: Update `openPassageFromSearch`**

Find the function around line 563:

```ts
const openPassageFromSearch = useCallback((): void => {
  setSelectedLibraryWorkId(null);
  setActiveScreen("Passages");
}, []);
```

Replace with:

```ts
const openPassageFromSearch = useCallback((): void => {
  setSelectedLibraryWorkId(null);
  setActiveScreen("Search");
}, []);
```

- [ ] **Step 2: Update the `Search` render branch**

Find the `case "Search":` block around line 721:

```tsx
case "Search":
  return (
    <SearchScreen
      key={`search-${searchScreenInstance}`}
      initialQuery={searchInitialQuery}
      onOpenPassage={openPassageFromSearch}
    />
  );
```

Replace with:

```tsx
case "Search":
  return (
    <SearchScreen
      key={`search-${searchScreenInstance}`}
      initialQuery={searchInitialQuery}
      onOpenPassage={openPassageFromSearch}
      onOpenWork={(workId) => {
        setSelectedLibraryWorkId(workId);
        setActiveScreen("Library");
      }}
      onFindSimilar={openSearchScreenWithQuery}
    />
  );
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @archi/desktop typecheck 2>&1 | tail -20`

Expected: zero new errors. Any pre-existing baseline errors remain (capture them once at the start with `pnpm --filter @archi/desktop typecheck 2>&1 | grep "error TS" | wc -l` to confirm count is unchanged).

- [ ] **Step 4: Manual smoke check**

Start dev: `pnpm dev` (from `apps/desktop`).

1. App launches cleanly, no console errors.
2. Click sidebar → Search. Type a query. Result cards now show Find similar / Open book / Copy buttons.
3. Click Copy on a card → "Copied" feedback for ~1.4s, clipboard contains the passage body.
4. Click Open book on a card → app switches to Library, that book is selected/highlighted.
5. Click Find similar on a card → Search reloads with that passage's body as the query, vector matches show.
6. Clicking elsewhere on the card body (not the action buttons) still triggers the existing `onOpenPassage` callback (currently a no-op that stays on Search; just verify no error).

Stop the dev server (`Ctrl-C`) before continuing.

- [ ] **Step 5: Commit Tasks 1–3 together**

```bash
git add apps/desktop/src/renderer/App.tsx
git commit -m "$(cat <<'EOF'
desktop: add row actions + empty-state helper to Search screen

SearchResultCard gains Copy / Open book / Find similar actions matching
the pattern from PassagesScreen so the Search screen can replace
Passages without losing per-row affordances. SearchScreen shows a
centered helper line (with live passage count) when the query is empty.
App.tsx wires onOpenWork and onFindSimilar callbacks and points
openPassageFromSearch at Search instead of Passages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Delete `PassagesScreen` and remove all references

With the Search screen carrying the load, the Passages screen is dead code. We remove the file, its import, its sidebar entry, its render branch, the dependency-array reference, and its icon glyph.

**Files:**
- Delete: `apps/desktop/src/renderer/screens/PassagesScreen.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`

- [ ] **Step 1: Remove the `PassagesScreen` import in App.tsx**

Delete this line (around line 8):

```ts
import { PassagesScreen } from "./screens/PassagesScreen";
```

- [ ] **Step 2: Remove `"Passages"` from the `screens` tuple and reorder**

Find line 17:

```ts
const screens = ["Home", "Connections", "Library", "Passages", "Search", "Logs"] as const;
```

Replace with:

```ts
const screens = ["Home", "Library", "Search", "Connections", "Logs"] as const;
```

Note the reorder: Library and Search now sit adjacent (the two daily workspaces), Connections moves to fourth (setup-time surface).

- [ ] **Step 3: Remove the `Passages` icon entry**

Find the `Passages:` key in the icon map (around lines 40-49):

```tsx
Passages: (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6c0-1.4 1-2.5 2.5-2.5" />
    <path d="M3 6v2c0 1 .8 2 2 2" />
    <path d="M3 6h2.8v4H3z" />
    <path d="M8.5 6c0-1.4 1-2.5 2.5-2.5" />
    <path d="M8.5 6v2c0 1 .8 2 2 2" />
    <path d="M8.5 6h2.8v4H8.5z" />
  </svg>
),
```

Delete the entire entry, including the trailing comma if it's the last one. Verify no remaining keys reference `"Passages"`.

- [ ] **Step 4: Remove the `case "Passages":` render branch**

Find the block around lines 710-720:

```tsx
case "Passages":
  return (
    <PassagesScreen
      passages={passages}
      onOpenWork={(workId) => {
        setSelectedLibraryWorkId(workId);
        setActiveScreen("Library");
      }}
      onOpenSearchScreen={openSearchScreenWithQuery}
    />
  );
```

Delete the whole `case` block. Leave the surrounding `case "Library":` and `case "Search":` branches intact.

- [ ] **Step 5: Delete the `PassagesScreen.tsx` file**

```bash
rm apps/desktop/src/renderer/screens/PassagesScreen.tsx
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm --filter @archi/desktop typecheck 2>&1 | tail -20`

Expected: zero new errors. If a `passages` state variable or a related dependency-array entry is flagged as unused, leave it for Task 5 (we'll grep-sweep there).

- [ ] **Step 7: Manual smoke check**

Start dev: `pnpm dev`.

1. App launches. Sidebar shows: Home, Library, Search, Connections, Logs (5 items, in that order).
2. Clicking each sidebar item lands on the right screen with no console error.
3. Search screen still works (query, filters, result actions).
4. Library still works (browse, click into book, see passages).
5. `⌘K` still focuses the global search bar.

Stop dev.

- [ ] **Step 8: Commit**

```bash
git add -A apps/desktop/src/renderer/screens/PassagesScreen.tsx apps/desktop/src/renderer/App.tsx
git commit -m "$(cat <<'EOF'
desktop: delete Passages screen; reorder sidebar to 5 items

Passages duplicated Search with a worse local-substring backend. Its
per-row actions moved into SearchResultCard in the previous commit.
Sidebar order is now Home / Library / Search / Connections / Logs —
Library and Search sit together as the two daily workspaces.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Sweep unused state and the `passages-*` CSS rules

After Task 4 the `passages` state variable, `setPassages` setter, the `listPassages` IPC call, and a chunk of `.passages-*` CSS are unreferenced. Decisions:

- **Keep `passages` state + `setPassages` + the `window.archi.listPassages()` call.** Other screens may still want this data later (e.g. Home's recent-activity feed already references `recentActivity.passages` separately). Removing it is out of scope; we just verify nothing references the old `passages` prop chain.
- **Delete the `.passages-*` CSS rules** that styled the deleted screen's structure (`.passages-screen`, `.passages-list-scroll`, `.passages-list-inner`, `.passages-list-row`, `.passages-filters`, `.content[data-screen="Passages"]`). Keep `.passage-card*` and `.passage-card-action*` — Search uses them.
- **Delete the `.select-input` rule** ONLY if no other screen uses it. Grep first.

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Confirm what to delete**

```bash
grep -rn "passages-screen\|passages-list-scroll\|passages-list-inner\|passages-list-row\|passages-filters" apps/desktop/src/renderer/
```

Expected: only matches inside `styles.css`. If anything in `.tsx` matches, stop and investigate before deleting.

```bash
grep -rn "select-input\b" apps/desktop/src/renderer/
```

If `.tsx` files still use `.select-input`, KEEP the rule. (Likely it's referenced from Connections / Settings — check.)

```bash
grep -rn 'data-screen="Passages"' apps/desktop/src/renderer/
```

Expected: only inside `styles.css` (the dead selector). The `[data-screen]` attribute itself is still written by App.tsx — that's fine, we're only removing the `Passages`-specific selector.

- [ ] **Step 2: Delete the dead rules**

Open `apps/desktop/src/renderer/styles.css`. Around line 1668-1729 you'll see the block starting with `.passages-screen, .logs-screen {` and continuing through `.passages-filters`. Delete these specific blocks:

```css
.passages-screen,
.logs-screen {
  display: grid;
  gap: 12px;
}

/* Passages screen: pin filters/count, scroll the list inside its own box. */
.content[data-screen="Passages"] {
  overflow: hidden;
  grid-template-rows: auto 1fr;
  align-content: stretch;
}

.content[data-screen="Passages"] .screen-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.passages-screen {
  /* Override the original `display: grid; gap: 12px;` so the list region can flex. */
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  height: 100%;
}

.passages-list-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  /* Leave a sliver so the bottom-most card's shadow isn't clipped. */
  padding-bottom: 4px;
}

.passages-list-inner {
  position: relative;
  width: 100%;
}

.passages-list-row {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  /* Replaces the original `.passages-list` grid gap. */
  padding-bottom: 8px;
  box-sizing: border-box;
}

.passages-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(170px, 220px);
  gap: 10px;
}
```

**Important:** the first rule combines `.passages-screen, .logs-screen` — split it so `.logs-screen` survives. Replace the combined selector with:

```css
.logs-screen {
  display: grid;
  gap: 12px;
}
```

Then delete all the `.passages-*` rules and the two `.content[data-screen="Passages"]` rules.

- [ ] **Step 3: Also delete the media-query block for `.passages-filters`**

Around line 1941 there's a media-query reference:

```css
@media (max-width: ...) {
  .passages-filters {
    ...
  }
}
```

Find and delete the inner `.passages-filters` block. If it leaves an empty `@media` query, delete the empty query too.

```bash
grep -n "passages-filters" apps/desktop/src/renderer/styles.css
```

Expected output: zero matches.

- [ ] **Step 4: Grep for any remaining `passages-` (with trailing hyphen) classes**

```bash
grep -n "\.passages-" apps/desktop/src/renderer/styles.css
```

Expected output: zero matches. The `.passage-card*` rules (singular `passage`, no `s`) MUST remain.

```bash
grep -n "\.passage-card" apps/desktop/src/renderer/styles.css | head
```

Expected: multiple matches (the card styles that Search now uses).

- [ ] **Step 5: Manual smoke check**

`pnpm dev` from `apps/desktop`. Click each sidebar item. Expected:

1. Library: book grid renders correctly, click-into-book detail still works.
2. Search: result cards still have the proper card styling (the `passage-card` rules), Copy/Find similar/Open book buttons styled the same as before.
3. Home, Connections, Logs: unchanged.
4. No layout regressions, no console errors, no missing-class warnings (you'd see these as flat unstyled lists).

Stop dev.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/styles.css
git commit -m "$(cat <<'EOF'
desktop: drop dead .passages-* CSS rules after Passages screen removal

The passage-card / passage-card-action rules stay — SearchResultCard
now uses them. Only the screen-layout rules (.passages-screen,
.passages-list-*, .passages-filters, .content[data-screen=\"Passages\"])
are removed, plus the media-query specialization for .passages-filters.
.logs-screen is split out of its combined selector so it keeps its
display rules.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: End-to-end manual verification

This is the final sign-off pass per spec §7. No code changes; just walk the user-visible flows and confirm they all work.

**Files:** none.

- [ ] **Step 1: Start the dev server**

```bash
pnpm dev
```

From `apps/desktop`. Wait for the renderer at `http://localhost:5173` to be ready and the Electron window to open.

- [ ] **Step 2: Sidebar inspection**

Five items in order: Home · Library · Search · Connections · Logs. Each has its icon. Clicking each switches the screen without console errors.

- [ ] **Step 3: Library**

Click Library. Grid of book covers renders. Local title-substring search and letter-pill filter still work. Click a book → `LibraryBookDetailScreen` opens; passages grouped by location are visible.

- [ ] **Step 4: Search empty state**

Click Search. Input is focused. Below the input you see one centered italic line:
*"Type to search 3,132 highlights · ⌘K from anywhere · click a book in Library to browse one."*

The number matches the actual passage count. (If the indexer hasn't fully run, the count may be lower or fall back to "your highlights".)

- [ ] **Step 5: Search querying**

Type a query that's clearly paraphrastic (e.g. `"feeling rejected"`, `"taking risks"`). Within ~150ms (the debounce) you see result cards. Some cards display VECTOR or BOTH badges (not all KEYWORD).

- [ ] **Step 6: Row actions on a Search result**

Click Copy on a card → "Copied" feedback for ~1.4s. Paste somewhere outside the app → the passage body is in the clipboard.

Click Open book on the same row → app switches to Library and that book is selected.

Return to Search. Click Find similar on a different row → Search reloads with that passage's body as the query; vector-driven matches appear.

- [ ] **Step 7: `⌘K` from a non-Search screen**

Click Home (or Library). Press `⌘K`. Global search bar focuses. Type a word, press Enter. App lands on Search prefilled with the query.

- [ ] **Step 8: Find similar from Library/Book detail**

Library → click a book → on any passage row, click Find similar. Search opens prefilled with that passage's body.

- [ ] **Step 9: No regressions in non-affected screens**

Quick spot check: Connections shows its panels, Logs renders, Home shows recent activity. No errors in DevTools console anywhere during the above flows.

- [ ] **Step 10: Stop dev and commit nothing**

Stop the dev server (`Ctrl-C`). No commit needed — this task is verification only. If any step fails, file a follow-up task fix on a per-failure basis; do not unwind prior commits.

---

## Post-implementation

After all six tasks land, the worktree's branch is ready for a PR (or merge to main, depending on the team's flow). The final git log should show three new commits on top of `92670fb`:

```
desktop: drop dead .passages-* CSS rules after Passages screen removal
desktop: delete Passages screen; reorder sidebar to 5 items
desktop: add row actions + empty-state helper to Search screen
```

No follow-up work is required by this plan. The deferred items (in-book search inside `LibraryBookDetailScreen`, optimizing the `availableCreators` fetch, renaming "Search") are noted in the spec §8 and each warrants a separate decision.
