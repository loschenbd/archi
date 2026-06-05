# Search + Homepage Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the local-semantic-search branch with the just-merged homepage redesign on `main`, producing a search-first reading dashboard where Home's existing content-header search becomes the entry point for hybrid (vec0 KNN + FTS5 + RRF) search; Library absorbs the old Passages screen as a sub-tab; Settings adds a Search tab.

**Architecture:** Work in the existing `/Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search` worktree on branch `worktree-local-semantic-search`. `git merge main` brings the homepage redesign into the semantic-search branch, then manual conflict resolution per file. Post-merge tasks materialize the merged design. Final fast-forward of `main` to the integration HEAD comes after the user signs off.

**Tech Stack:** React 18 + TypeScript + Vite Electron renderer, sqlite-vec + FTS5 in the main process, @xenova/transformers for embeddings, `@tanstack/react-virtual` for result virtualization. No frontend test framework; verification is `pnpm --filter @archi/desktop typecheck`, `pnpm --filter @archi/desktop lint`, plus `pnpm test` for the packages.

**Spec:** `docs/superpowers/specs/2026-06-05-search-and-homepage-integration-design.md`

---

## File structure

**Create:**
- `apps/desktop/src/renderer/screens/library/LibraryAllHighlights.tsx` — virtualized passages list lifted from the deleted PassagesScreen content

**Modify (substantial):**
- `apps/desktop/src/renderer/App.tsx` — sidebar to 3 items, provider wrapping, drop Passages route, add `homeSearchFilters` + `findSimilarPassageId` state
- `apps/desktop/src/renderer/screens/HomeScreen.tsx` — receive filter state, pass to HomeSearchResults
- `apps/desktop/src/renderer/screens/home/HomeSearchResults.tsx` — replace substring filter with hybrid IPC + filter chips + SearchResultCard
- `apps/desktop/src/renderer/screens/home/SyncBanner.tsx` — add `indexing` state, consume IndexerStatusContext
- `apps/desktop/src/renderer/screens/SettingsScreen.tsx` — third tab (Search) + ARIA + keyboard nav
- `apps/desktop/src/renderer/screens/LibraryScreen.tsx` — sub-toggle for By book | All highlights
- `apps/desktop/src/renderer/styles.css` — new module styles, removed orphans

**Delete:**
- `apps/desktop/src/renderer/screens/SearchScreen.tsx` — folded into HomeSearchResults
- `apps/desktop/src/renderer/components/GlobalSearchBar.tsx` — replaced by content-header search input
- `apps/desktop/src/renderer/components/IndexingBanner.tsx` — folded into SyncBanner
- `apps/desktop/src/renderer/components/IndexerStatusPill.tsx` — ambient awareness moves to SyncBanner + Settings

**Preserve (land verbatim from their branch):**
- `packages/search/*`, `packages/core/src/db/migrations.ts` v3, related tests
- `apps/desktop/src/main/searchModule.ts`, `apps/desktop/src/main/ipc/searchIpc.ts`
- `apps/desktop/src/renderer/state/SearchPreferencesContext.tsx`
- `apps/desktop/src/renderer/state/IndexerStatusContext.tsx`
- `apps/desktop/src/renderer/components/HighlightedText.tsx`
- `apps/desktop/src/renderer/components/SearchResultCard.tsx`
- `apps/desktop/src/renderer/components/SearchFilterChips.tsx`
- `apps/desktop/src/renderer/screens/LibraryBookDetailScreen.tsx` (their scroll-to-passage behavior)
- `apps/desktop/src/renderer/screens/NotionScreen.tsx`

---

## Verification gates (used at every task)

- **Typecheck:** `pnpm --filter @archi/desktop typecheck` — zero errors. (Run from worktree root.)
- **Lint:** `pnpm --filter @archi/desktop lint` — zero errors.
- **Package tests:** `pnpm -r test` — must pass (search + core have tests).
- **Manual sanity (final task only):** `pnpm --filter @archi/desktop dev` and walk the merged UX.

Run all gates from `/Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search`. Use `git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search <cmd>` for every git command to keep cwd drift from leaking commits to the wrong branch.

---

### Task 1: Commit the uncommitted EMBEDDING_MODEL_ID workaround

**Files:**
- Modify (commit existing change): `apps/desktop/src/renderer/screens/SettingsScreen.tsx`

The semantic-search worktree has one uncommitted change: `SettingsScreen.tsx` inlines `EMBEDDING_MODEL_ID = "bge-small-en-v1.5@v1"` instead of importing from `@archi/search`, because that barrel pulls `embedding/modelPaths.ts` which imports `node:fs` — and Vite stubs `node:fs` in the renderer bundle, throwing at module load. This must be committed before the merge so we start from a clean tree.

- [ ] **Step 1.1: Verify the only dirty file**

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search status --short
```
Expected: exactly one line — `M apps/desktop/src/renderer/screens/SettingsScreen.tsx`. If there are others, STOP and report.

- [ ] **Step 1.2: Verify the diff is only the EMBEDDING_MODEL_ID inline**

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search diff apps/desktop/src/renderer/screens/SettingsScreen.tsx
```

Expected diff shape (paraphrased):
```
-import { EMBEDDING_MODEL_ID } from "@archi/search";
+const EMBEDDING_MODEL_ID = "bge-small-en-v1.5@v1";
```
Plus an explanatory comment. If anything else changes, STOP.

- [ ] **Step 1.3: Commit**

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/screens/SettingsScreen.tsx
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search commit -m "tooling: inline EMBEDDING_MODEL_ID in SettingsScreen (Vite stubs node:fs from @archi/search barrel)"
```

- [ ] **Step 1.4: Verify clean state**

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search status --short
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search log --oneline -2
```
Expected: status empty, last commit is the new one.

---

### Task 2: Merge `main` into the worktree and resolve conflicts

**Files:**
- Modify: many — conflict resolution per file

This is the heaviest task. Resolve every conflict file by file using the rules below. After the merge resolves cleanly and typecheck passes (allowing pre-existing baseline errors documented per file), commit. The post-merge design materialization happens in subsequent tasks.

- [ ] **Step 2.1: Tag a recovery point before merging**

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search tag pre-integration-merge
```

If anything goes catastrophically wrong: `git -C <worktree> reset --hard pre-integration-merge` recovers.

- [ ] **Step 2.2: Fetch main's HEAD into the worktree's history**

`main` lives in the parent repo. The worktree's `git fetch` reads from the same shared git directory, so:

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search rev-parse main
```

Expected: a SHA (the current `main` tip, including the homepage redesign and the integration spec). If this fails, STOP — the branches aren't sharing the same repo and the merge path is different.

- [ ] **Step 2.3: Initiate the merge (expect conflicts)**

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search merge main
```

Expected output: conflict markers in several files. Git stops. Do NOT abort — proceed to per-file resolution.

The exact conflicts will appear in approximately these files (read `git status` after the failed merge to confirm):
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/screens/SettingsScreen.tsx` (both branches added — "both added" conflict)
- `apps/desktop/src/renderer/screens/HomeScreen.tsx`
- `apps/desktop/src/renderer/styles.css`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/preload/index.ts`
- `pnpm-lock.yaml`
- possibly `package.json` and `apps/desktop/package.json`

- [ ] **Step 2.4: Resolve `apps/desktop/src/renderer/App.tsx`**

Strategy: take the homepage redesign's `App.tsx` (`main` side) as the base, then layer in the semantic-search branch's additions:
- The `SearchPreferencesProvider` and `IndexerStatusProvider` wrappers around `<main className="layout">` (top of `return`)
- The `import { SearchPreferencesProvider } from "./state/SearchPreferencesContext";` and `import { IndexerStatusProvider } from "./state/IndexerStatusContext";` imports
- DO NOT take their `screens` tuple — keep main's: `["Home", "Library", "Settings"]` after Task 4 reduces from main's current `["Home", "Library", "Passages", "Settings"]`. For this task, accept main's `["Home", "Library", "Passages", "Settings"]` as-is — Task 4 collapses to 3.
- DO NOT take their `Search`/`Connections`/`Logs` route cases — drop them. The Settings tab now owns Connections + Logs.
- DO NOT take their `GlobalSearchBar` rendering in the content-header — main's `.content-header-search` input is already there for Home.
- DO NOT take their `IndexerStatusPill` rendering in the sidebar — drop it.
- DO NOT take their `selectedPassageId` state — Passages is going away (Task 4) and Library is the new home for passage browsing (Task 6).

Concretely:

Open `App.tsx`. For each conflict block (`<<<<<<< HEAD ... ======= ... >>>>>>> main`):
- The `HEAD` side is the semantic-search branch
- The `main` side is the homepage redesign
- Use the `main` side and then manually add SearchPreferencesProvider + IndexerStatusProvider imports + JSX wrapping

Final `App.tsx` shape at the end of this step (relevant excerpts):

```tsx
import { ConnectionsScreen, type ConnectionState } from "./screens/ConnectionsScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { LibraryBookDetailScreen } from "./screens/LibraryBookDetailScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { LogsScreen } from "./screens/LogsScreen";
import { OnboardingScreen } from "./screens/OnboardingScreen";
import { PassagesScreen } from "./screens/PassagesScreen"; // KEEP until Task 4
import { SettingsScreen, type SettingsTab } from "./screens/SettingsScreen";
import { SearchPreferencesProvider } from "./state/SearchPreferencesContext";
import { IndexerStatusProvider } from "./state/IndexerStatusContext";
import { SupportButton } from "./components/SupportButton";
import { SupportPromptModal } from "./components/SupportPromptModal";
import { UpdateBanner } from "./components/UpdateBanner";
import { shouldShowSupportPrompt } from "./support-prompt";
import appLogo from "./assets/logo.png";
```

Bottom of file, wrap `<main>` and the `<SupportPromptModal>` inside the two providers:

```tsx
return (
  <>
    <UpdateBanner />
    <SearchPreferencesProvider>
      <IndexerStatusProvider>
        <main className={`layout${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
          {/* existing main content unchanged */}
        </main>
        <SupportPromptModal open={supportPromptOpen} onClose={() => setSupportPromptOpen(false)} />
      </IndexerStatusProvider>
    </SearchPreferencesProvider>
  </>
);
```

DO NOT change other state, props, or routes here. Tasks 3–13 alter App.tsx further.

- [ ] **Step 2.5: Resolve `apps/desktop/src/renderer/screens/SettingsScreen.tsx`**

This is a "both added" conflict — both branches created a SettingsScreen.

Open the file. You'll see Git has produced conflict markers separating the two versions. We KEEP the homepage redesign's tabbed version as the base and merge in the semantic-search branch's `Search` section content as a third tab in a subsequent task (Task 8). For now: keep the homepage redesign's version of `SettingsScreen.tsx` verbatim (with its two-tab Connections | Logs structure).

Find the `<<<<<<< HEAD` block and replace the entire conflict region (HEAD + `=======` + main) with the homepage redesign's `SettingsScreen.tsx` exactly as it lives on main. The simplest way:

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search checkout --theirs apps/desktop/src/renderer/screens/SettingsScreen.tsx
```

(In a merge, `--theirs` refers to the merge source, which is `main`. `--ours` is HEAD, the semantic-search branch. So `--theirs` takes main's version, which is what we want here.)

Mark as resolved:

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/screens/SettingsScreen.tsx
```

- [ ] **Step 2.6: Resolve `apps/desktop/src/renderer/screens/HomeScreen.tsx`**

The homepage redesign rewrote HomeScreen completely. The semantic-search branch barely touched it (largely the pre-redesign baseline). Take main's version wholesale:

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search checkout --theirs apps/desktop/src/renderer/screens/HomeScreen.tsx
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/screens/HomeScreen.tsx
```

- [ ] **Step 2.7: Resolve `apps/desktop/src/renderer/styles.css`**

Both branches made large additions AND large deletions. Strategy: keep main's `styles.css` as the base (homepage redesign + cleanup is the more recent + more aggressive deletion pass), then append the semantic-search branch's added classes.

Step A — take main's version as the base:

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search checkout --theirs apps/desktop/src/renderer/styles.css
```

Step B — recover the semantic-search-only CSS classes. From the worktree:

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search diff main..HEAD -- apps/desktop/src/renderer/styles.css > /tmp/semantic-search-css.diff
```

(This diff is theirs vs main. Inspect to find the `+` classes that don't conflict with main's deletions.)

Step C — manually append the following net-new selectors from their branch into the bottom of `styles.css`. Read the diff to find current values; verbatim from their branch:

- `.search-screen` and its sub-classes (`.search-screen__input`, `.search-screen__summary`, `.search-screen__results`, `.search-screen__hint`, `.search-screen__empty`) — these will be RENAMED or DELETED in Task 10 (HomeSearchResults rewrite), but keep them for now so existing imports build.
- `.search-result-card` and sub-classes (used by `SearchResultCard.tsx`)
- `.search-filter-chips` and sub-classes (used by `SearchFilterChips.tsx`)
- `.indexer-status-pill` — DELETE; the component is going away in Task 12.
- `.indexing-banner` — DELETE; the component is going away in Task 12.
- `.highlighted-text` and `.highlighted-text mark` (used by `HighlightedText.tsx`)
- `.passage-card-action` — likely shared; keep.
- `.settings-search-section` and sub-classes from their SettingsScreen — keep, will be reused by Task 8's Search tab.

After appending, mark resolved:

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/styles.css
```

- [ ] **Step 2.8: Resolve `apps/desktop/src/main/index.ts`**

Both branches touched this. Main has:
- `workId` surfacing on `listRecentActivity` (homepage redesign Task 6)
- `clearStaleNeedsAuthIfResolved` helper (homepage redesign WIP baseline)

Semantic-search has:
- `createSearchModule(db)` invocation in `app.whenReady`
- Registration of `archi:search:*` IPC handlers via `searchIpc.ts`
- Post-sync hook calling `indexer.tick()` after sync completes

Strategy: take HEAD (semantic-search) as the base, then re-apply main's additions (`workId` on listRecentActivity + `clearStaleNeedsAuthIfResolved`).

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search checkout --ours apps/desktop/src/main/index.ts
```

Now open the file and verify these are present (they should be — `--ours` is the semantic-search branch which already had them as part of its baseline OR didn't). If `clearStaleNeedsAuthIfResolved` is missing, restore from main:

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search show main:apps/desktop/src/main/index.ts > /tmp/main-index.ts
```

Then diff and copy the missing additions:
- The `clearStaleNeedsAuthIfResolved` function declaration (a small helper)
- Its three call sites inside the connection handlers

For `workId` on `listRecentActivity`: find the IPC handler for `archi:list-recent-activity`. There are two return mappings (run-touched + cold). Each maps a passage row to a small object including `id`, `body`, `workTitle`, `ingestedAt`. Add `workId` to BOTH return objects. The source row already has the work id under a field like `work_id` or accessible via a join — verify by reading the surrounding query.

Mark resolved:

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/main/index.ts
```

- [ ] **Step 2.9: Resolve `apps/desktop/src/preload/index.ts`**

The semantic-search branch added `archi:search:*` typings. Main added (implicitly) the `workId` field on `listRecentActivity` return type. Take HEAD as the base, then add the `workId?: string` field to the `passages` array element type in the `listRecentActivity` method signature.

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search checkout --ours apps/desktop/src/preload/index.ts
```

Open the file, find the `listRecentActivity` return type. The passages array element type currently lacks `workId`. Add `workId?: string`:

```ts
passages: Array<{
  id: string;
  body: string;
  workTitle: string;
  ingestedAt: string;
  workId?: string;
}>;
```

Then mark resolved:

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/preload/index.ts
```

- [ ] **Step 2.10: Resolve `pnpm-lock.yaml` and `package.json` (if present)**

If `pnpm-lock.yaml` has conflicts, take HEAD (semantic-search has more packages):

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search checkout --ours pnpm-lock.yaml
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search checkout --ours package.json 2>/dev/null || true
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search checkout --ours apps/desktop/package.json 2>/dev/null || true
```

Re-resolve the lockfile cleanly:

```bash
cd /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search
pnpm install --no-frozen-lockfile
```

Stage the regenerated lockfile:

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add pnpm-lock.yaml
```

- [ ] **Step 2.11: Verify no remaining conflicts**

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search diff --name-only --diff-filter=U
```

Expected: empty. If any file is still in conflict (`U` state), resolve it before proceeding.

- [ ] **Step 2.12: Build workspace deps and run typecheck**

```bash
cd /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search
pnpm --filter @archi/desktop build:deps
pnpm --filter @archi/desktop typecheck 2>&1 | grep -c "error TS"
```

Expected: zero. If typecheck has errors, they're real and need fixing inline before committing the merge.

Common likely errors:
- `App.tsx` references components from the semantic-search branch that are no longer reachable from the route table (e.g. `SearchScreen` imported but unused) — drop the imports for now
- `SettingsScreen.tsx` may import context hooks that the homepage redesign's version doesn't use — its current version takes only Connections + Logs props
- `PassagesScreen` may have been deleted on the semantic-search side but main still routes to it — the route survives until Task 4, so re-add the PassagesScreen file if needed:
  ```bash
  git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search checkout main -- apps/desktop/src/renderer/screens/PassagesScreen.tsx
  ```

Iterate until typecheck reports zero errors.

- [ ] **Step 2.13: Run lint**

```bash
pnpm --filter @archi/desktop lint 2>&1 | tail -5
```

Expected: zero errors. Fix any newly-flagged unused imports by deleting them.

- [ ] **Step 2.14: Run package tests**

```bash
pnpm -r test 2>&1 | tail -10
```

Expected: all pass. The semantic-search and core tests must continue to pass.

- [ ] **Step 2.15: Commit the merge**

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search commit -m "merge: integrate homepage redesign from main

Resolves conflicts in App.tsx, SettingsScreen.tsx, HomeScreen.tsx, styles.css,
main/index.ts, preload/index.ts. Keeps homepage redesign's SettingsScreen +
HomeScreen + sidebar shape; layers semantic-search providers and IPC over the
top. Subsequent tasks materialize the integrated UX (3-item sidebar, Library
sub-toggle, Settings third tab, hybrid Home search, indexing banner state)."
```

The commit is large but cohesive: it's the structural merge. Subsequent tasks make targeted changes on top.

---

### Task 3: Wrap App with the two providers

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`

Task 2 should have already added the provider wrapping. This task is a verification + minor adjustment task. Confirm the wrapping order and that both providers are reachable from every child.

- [ ] **Step 3.1: Verify provider order**

Read `App.tsx`. The return statement should look like:

```tsx
return (
  <>
    <UpdateBanner />
    <SearchPreferencesProvider>
      <IndexerStatusProvider>
        <main className={...}>
          {/* WindowTitleBar, sidebar, content */}
        </main>
        <SupportPromptModal ... />
      </IndexerStatusProvider>
    </SearchPreferencesProvider>
  </>
);
```

If either provider is missing or in the wrong place, fix it.

Also wrap the onboarding-only render path (the `if (!onboardingCompleted)` return) with the same providers so HomeSearchResults doesn't break if the user gets onboarded inside a single session.

```tsx
if (!onboardingCompleted) {
  return (
    <SearchPreferencesProvider>
      <IndexerStatusProvider>
        <main className="onboarding-layout">
          {/* existing onboarding content */}
        </main>
      </IndexerStatusProvider>
    </SearchPreferencesProvider>
  );
}
```

- [ ] **Step 3.2: Verify the loading state**

The `if (!settingsLoaded)` early return shows a "Loading workspace..." screen. Wrap it the same way:

```tsx
if (!settingsLoaded) {
  return (
    <SearchPreferencesProvider>
      <IndexerStatusProvider>
        <main className="onboarding-layout">
          {/* existing loading content */}
        </main>
      </IndexerStatusProvider>
    </SearchPreferencesProvider>
  );
}
```

(Strictly speaking the loading screen doesn't consume either context, but consistent provider wrapping prevents future bugs and removes the need for null guards in children.)

- [ ] **Step 3.3: Typecheck + Lint**

```bash
pnpm --filter @archi/desktop typecheck
pnpm --filter @archi/desktop lint
```
Both zero.

- [ ] **Step 3.4: Commit**

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/App.tsx
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search commit -m "desktop: wrap App with SearchPreferences + IndexerStatus providers on all render paths"
```

---

### Task 4: Sidebar to 3 items; drop Passages route

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Delete: `apps/desktop/src/renderer/screens/PassagesScreen.tsx`

After this task: sidebar shows Home / Library / Settings only. Library still renders only the "By book" view (Task 6 adds the sub-toggle). Visiting the URL or screen tuple no longer routes to Passages.

- [ ] **Step 4.1: Update `screens` tuple**

In `App.tsx`, find:
```ts
const screens = ["Home", "Library", "Passages", "Settings"] as const;
```

Replace with:
```ts
const screens = ["Home", "Library", "Settings"] as const;
```

- [ ] **Step 4.2: Remove `Passages` icon from `screenIcons`**

Find the `Passages:` entry inside `screenIcons` and delete it. The record now has exactly 3 entries: Home, Library, Settings.

- [ ] **Step 4.3: Remove `case "Passages":` from the route switch**

Find the `case "Passages":` block in the `screenContent` `useMemo` switch and delete it entirely. Remove the import too:

```ts
import { PassagesScreen } from "./screens/PassagesScreen";  // ← delete this line
```

- [ ] **Step 4.4: Delete the PassagesScreen file**

We will recover its content into `LibraryAllHighlights.tsx` in Task 5. Before deleting, save a copy:

```bash
cp /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search/apps/desktop/src/renderer/screens/PassagesScreen.tsx /tmp/PassagesScreen.tsx.bak
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search rm apps/desktop/src/renderer/screens/PassagesScreen.tsx
```

- [ ] **Step 4.5: Drop the `passages`-routing-only state if any**

Search `App.tsx` for `selectedPassageId` (or similar). If it's only used to navigate to a single passage on the Passages screen, delete it and its handlers. If it's used by LibraryBookDetailScreen too, KEEP it.

```bash
grep -n "selectedPassageId" /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search/apps/desktop/src/renderer/App.tsx
```

If references exist outside the deleted Passages block, leave them alone.

- [ ] **Step 4.6: Typecheck + Lint + Commit**

```bash
pnpm --filter @archi/desktop typecheck
pnpm --filter @archi/desktop lint
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/screens/PassagesScreen.tsx
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search commit -m "desktop: drop Passages top-level route; sidebar shrinks to 3 items"
```

---

### Task 5: Build `LibraryAllHighlights` from the backed-up PassagesScreen

**Files:**
- Create: `apps/desktop/src/renderer/screens/library/LibraryAllHighlights.tsx`

The deleted PassagesScreen content (saved at `/tmp/PassagesScreen.tsx.bak`) becomes a new component that renders inside Library's "All highlights" sub-tab.

- [ ] **Step 5.1: Create the directory**

```bash
mkdir -p /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search/apps/desktop/src/renderer/screens/library
```

- [ ] **Step 5.2: Create `LibraryAllHighlights.tsx`**

Take the backed-up `PassagesScreen.tsx` content. Rename the component from `PassagesScreen` to `LibraryAllHighlights`. Keep the Props type the same as PassagesScreen had — typically:

```ts
type Props = {
  passages: Array<{
    id: string;
    body: string;
    workId: string;
    workTitle: string;
  }>;
  onOpenWork: (workId: string) => void;
};
```

Write the file with the renamed export, e.g.:

```tsx
import { /* existing imports from PassagesScreen */ } from "...";

type Props = {
  passages: Array<{
    id: string;
    body: string;
    workId: string;
    workTitle: string;
  }>;
  onOpenWork: (workId: string) => void;
};

export function LibraryAllHighlights({ passages, onOpenWork }: Props): JSX.Element {
  /* body: copy verbatim from /tmp/PassagesScreen.tsx.bak, with className updates if needed */
}
```

Read `/tmp/PassagesScreen.tsx.bak` to get the exact existing implementation and reuse it. The substring-filter input, virtualized list, "no results / no passages" empty states all carry forward unchanged.

- [ ] **Step 5.3: Verify the file builds in isolation**

```bash
pnpm --filter @archi/desktop typecheck 2>&1 | grep -c "error TS"
```
Expected: zero. The new file isn't wired into App yet, but it shouldn't introduce errors.

- [ ] **Step 5.4: Commit**

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/screens/library/LibraryAllHighlights.tsx
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search commit -m "desktop(library): add LibraryAllHighlights from recovered PassagesScreen content"
```

---

### Task 6: Library sub-toggle (By book | All highlights)

**Files:**
- Modify: `apps/desktop/src/renderer/screens/LibraryScreen.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

Adds a sub-toggle at the top of Library that switches between the existing book grid and the new LibraryAllHighlights view.

- [ ] **Step 6.1: Refactor `LibraryScreen.tsx` to host the toggle**

Read the current `LibraryScreen.tsx`. Identify the existing render of the book grid (works, filter input, click handler). Wrap that JSX in a new `LibraryByBook` inner component (or keep it inline). Add the toggle + conditional render at the top:

```tsx
import { useState } from "react";
import { LibraryAllHighlights } from "./library/LibraryAllHighlights";

type LibraryTab = "by-book" | "all-highlights";

type Passage = {
  id: string;
  body: string;
  workId: string;
  workTitle: string;
};

type Props = {
  works: /* existing Work[] type */;
  selectedWorkId?: string;
  onSelectWork: (workId: string) => void;
  passages: Passage[];
  onOpenWork: (workId: string) => void;
};

export function LibraryScreen({ works, selectedWorkId, onSelectWork, passages, onOpenWork }: Props): JSX.Element {
  const [activeTab, setActiveTab] = useState<LibraryTab>("by-book");

  return (
    <section className="library-screen">
      <div className="library-tabs" role="tablist" aria-label="Library views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "by-book"}
          className={`library-tab-button${activeTab === "by-book" ? " library-tab-button-active" : ""}`}
          onClick={() => setActiveTab("by-book")}
        >
          By book
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "all-highlights"}
          className={`library-tab-button${activeTab === "all-highlights" ? " library-tab-button-active" : ""}`}
          onClick={() => setActiveTab("all-highlights")}
        >
          All highlights
        </button>
      </div>

      <div className="library-tab-panel" role="tabpanel">
        {activeTab === "by-book" ? (
          /* existing book grid JSX, unchanged */
          /* ... */
        ) : (
          <LibraryAllHighlights passages={passages} onOpenWork={onOpenWork} />
        )}
      </div>
    </section>
  );
}
```

Copy the existing book grid JSX verbatim into the `activeTab === "by-book"` branch. Existing props (`works`, `selectedWorkId`, `onSelectWork`) drive that branch.

- [ ] **Step 6.2: Thread `passages` and `onOpenWork` to LibraryScreen from App.tsx**

In `App.tsx`, in the `case "Library":` render of `screenContent`, add the two new props:

```tsx
case "Library":
  if (selectedLibraryWorkId) {
    const selectedWork = works.find((work) => work.id === selectedLibraryWorkId);
    if (selectedWork) {
      return <LibraryBookDetailScreen work={selectedWork} />;
    }
  }
  return (
    <LibraryScreen
      works={works}
      selectedWorkId={selectedLibraryWorkId ?? undefined}
      onSelectWork={(workId) => setSelectedLibraryWorkId(workId)}
      passages={passages}
      onOpenWork={(workId) => {
        setSelectedLibraryWorkId(workId);
        setActiveScreen("Library");
      }}
    />
  );
```

If `passages` isn't already in App's state at this point (it is — used by HomeScreen for search), no new state is needed.

- [ ] **Step 6.3: Add `.library-tabs` / `.library-tab-button` styles**

Append to `styles.css`:

```css
.library-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  background: color-mix(in srgb, var(--ink-300) 12%, transparent);
  border-radius: 999px;
  width: max-content;
  margin-bottom: 14px;
}

.library-tab-button {
  border: none;
  background: transparent;
  padding: 6px 16px;
  border-radius: 999px;
  font: inherit;
  font-size: 13px;
  color: var(--ink-700);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.library-tab-button:hover:not(.library-tab-button-active) {
  color: var(--accent-strong);
}

.library-tab-button-active {
  background: var(--surface);
  color: var(--accent-strong);
  box-shadow: 0 2px 6px rgba(72, 53, 41, 0.06);
}

.library-tab-panel {
  display: block;
}
```

- [ ] **Step 6.4: Typecheck + Lint + Commit**

```bash
pnpm --filter @archi/desktop typecheck
pnpm --filter @archi/desktop lint
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/screens/LibraryScreen.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search commit -m "desktop(library): add By book | All highlights sub-toggle"
```

---

### Task 7: SettingsScreen — third tab (Search) + ARIA polish + keyboard nav

**Files:**
- Modify: `apps/desktop/src/renderer/screens/SettingsScreen.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`

Adds the Search tab, makes the tab strip fully ARIA-compliant, and adds ArrowLeft/ArrowRight keyboard nav. This consolidates the homepage redesign's open follow-up FU-1.

- [ ] **Step 7.1: Extend `SettingsTab` type**

In `SettingsScreen.tsx`:

```ts
export type SettingsTab = "connections" | "logs" | "search";
```

Update `props.defaultTab` consumer + initial state to accept any of the three.

- [ ] **Step 7.2: Add the Search section UI**

Add inside SettingsScreen's component, after the existing imports add:

```tsx
import { useSearchPreferences } from "../state/SearchPreferencesContext";
import { useIndexerStatus } from "../state/IndexerStatusContext";

const EMBEDDING_MODEL_ID = "bge-small-en-v1.5@v1";
// Inlined here for the same reason it was inlined upstream: the @archi/search
// barrel pulls embedding/modelPaths.ts which imports node:fs. Vite stubs node:fs
// in the renderer bundle, so importing through the barrel throws at module load.
```

Add a `Toggle` helper component at the top of the file:

```tsx
function Toggle({
  checked,
  onChange,
  label,
  description
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}): JSX.Element {
  return (
    <label className="settings-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        {description ? <span className="settings-toggle-description">{description}</span> : null}
      </span>
    </label>
  );
}
```

Add a `SearchSection` component (also at top of file or inline):

```tsx
function SearchSection(): JSX.Element {
  const prefs = useSearchPreferences();
  const { status, indexed, total } = useIndexerStatus();
  const totalLabel = total > 0 ? total.toLocaleString() : "—";
  const indexedLabel = indexed.toLocaleString();
  const statusLabel = status === "running" ? "Indexing in progress" : status === "idle" ? "Idle" : status;
  const onReindex = (): void => {
    void window.archi.search.startIndexing();
  };
  return (
    <div className="settings-search-section">
      <Toggle
        checked={prefs.showMatchSource}
        onChange={prefs.setShowMatchSource}
        label="Show match-source labels"
        description="Show KEYWORD / VECTOR / BOTH badges on results."
      />
      <Toggle
        checked={prefs.includeArchived}
        onChange={prefs.setIncludeArchived}
        label="Include archived passages"
      />
      <Toggle
        checked={prefs.includeHidden}
        onChange={prefs.setIncludeHidden}
        label="Include hidden passages"
      />
      <div className="settings-search-index-status">
        <p className="content-eyebrow">Index status</p>
        <p>
          <span className="tabular">{indexedLabel}</span> of <span className="tabular">{totalLabel}</span> indexed
          <span aria-hidden="true"> · </span>
          model <code>{EMBEDDING_MODEL_ID}</code>
          <span aria-hidden="true"> · </span>
          {statusLabel}
        </p>
        <button
          type="button"
          className="settings-search-reindex"
          onClick={onReindex}
          disabled={status === "running"}
        >
          Re-index now
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7.3: Add Search tab button + panel; add ARIA linkage**

In SettingsScreen's render, expand the existing two-button tab strip to three, with full ARIA + keyboard navigation. Replace the existing `<div className="settings-tabs" ...>` block with:

```tsx
const tabIds = {
  connections: { tabId: "settings-tab-connections", panelId: "settings-panel-connections" },
  logs: { tabId: "settings-tab-logs", panelId: "settings-panel-logs" },
  search: { tabId: "settings-tab-search", panelId: "settings-panel-search" }
} as const;

const tabOrder: readonly SettingsTab[] = ["connections", "logs", "search"];

const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: SettingsTab): void => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return;
  }
  event.preventDefault();
  const index = tabOrder.indexOf(current);
  const nextIndex = event.key === "ArrowLeft"
    ? (index - 1 + tabOrder.length) % tabOrder.length
    : (index + 1) % tabOrder.length;
  const nextTab = tabOrder[nextIndex];
  setActiveTab(nextTab);
  // Move focus to the newly active tab button
  document.getElementById(tabIds[nextTab].tabId)?.focus();
};

return (
  <section className="settings-screen">
    <div className="settings-tabs" role="tablist" aria-label="Settings sections">
      {tabOrder.map((tab) => {
        const ids = tabIds[tab];
        const active = activeTab === tab;
        const label = tab === "connections" ? "Connections" : tab === "logs" ? "Logs" : "Search";
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            id={ids.tabId}
            aria-selected={active}
            aria-controls={ids.panelId}
            tabIndex={active ? 0 : -1}
            className={`settings-tab-button${active ? " settings-tab-button-active" : ""}`}
            onClick={() => setActiveTab(tab)}
            onKeyDown={(event) => onTabKeyDown(event, tab)}
          >
            {label}
          </button>
        );
      })}
    </div>

    <div
      className="settings-tab-panel"
      role="tabpanel"
      id={tabIds[activeTab].panelId}
      aria-labelledby={tabIds[activeTab].tabId}
    >
      {activeTab === "connections" ? (
        <ConnectionsScreen
          /* ... existing connections props ... */
        />
      ) : activeTab === "logs" ? (
        <LogsScreen entries={props.logs} />
      ) : (
        <SearchSection />
      )}
    </div>
  </section>
);
```

Keep the existing ConnectionsScreen prop list unchanged.

- [ ] **Step 7.4: Add `.settings-search-section` styles**

Append to `styles.css`:

```css
.settings-search-section {
  display: grid;
  gap: 18px;
  max-width: 600px;
}

.settings-toggle {
  display: grid;
  grid-template-columns: 18px 1fr;
  gap: 12px;
  align-items: start;
  cursor: pointer;
}

.settings-toggle input[type="checkbox"] {
  margin-top: 3px;
}

.settings-toggle-description {
  display: block;
  font-size: 12px;
  color: var(--ink-500);
  margin-top: 2px;
}

.settings-search-index-status {
  background: var(--surface);
  border: 1px solid color-mix(in srgb, var(--ink-300) 18%, transparent);
  border-radius: 12px;
  padding: 14px 18px;
  display: grid;
  gap: 8px;
}

.settings-search-index-status p {
  margin: 0;
  font-size: 13px;
  color: var(--ink-700);
}

.settings-search-reindex {
  justify-self: start;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  color: var(--accent-strong);
  padding: 5px 12px;
  border-radius: 999px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.settings-search-reindex:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.settings-search-reindex:disabled {
  opacity: 0.5;
  cursor: default;
}
```

- [ ] **Step 7.5: Verify the existing post-onboarding nav and banner-click routes still work**

The existing post-onboarding redirect sets `settingsDefaultTab` to `"connections"` and navigates to Settings. That still works. The sync-banner click destinations are `"connections"` and `"logs"`. Both are still valid `SettingsTab` values. No banner currently routes to `"search"`.

- [ ] **Step 7.6: Typecheck + Lint + Commit**

```bash
pnpm --filter @archi/desktop typecheck
pnpm --filter @archi/desktop lint
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/screens/SettingsScreen.tsx apps/desktop/src/renderer/styles.css
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search commit -m "desktop(settings): add Search tab + ARIA tablist + arrow-key nav"
```

---

### Task 8: SyncBanner — indexing state

**Files:**
- Modify: `apps/desktop/src/renderer/screens/home/SyncBanner.tsx`

Adds the `indexing` state between Running and NoHealthySources. Pulls indexer state from `IndexerStatusContext` instead of accepting it as a prop (keeps HomeScreen's prop surface stable).

- [ ] **Step 8.1: Import the indexer status hook**

At the top of `SyncBanner.tsx`:

```tsx
import { useIndexerStatus } from "../../state/IndexerStatusContext";
```

- [ ] **Step 8.2: Consume the hook + insert the new state branch**

Inside the `SyncBanner` component, after the existing destructuring and helpers, add:

```tsx
const { status: indexerStatus, indexed, total } = useIndexerStatus();
const isIndexing = indexerStatus === "running";
```

In the state-precedence cascade, insert the indexing branch AFTER `isSyncing` (Running) and BEFORE `noHealthySources`. Find the line that returns the Running banner — directly after that block, before the `if (noHealthySources) {` line, add:

```tsx
if (isIndexing) {
  const hasTotal = total > 0;
  const indexingPct = hasTotal ? Math.min(100, Math.round((indexed / total) * 100)) : null;
  const onReindex = (): void => {
    void window.archi.search.startIndexing();
  };
  return (
    <div className="sync-banner sync-banner-indexing" role="status" aria-live="polite">
      <div className="sync-banner-row">
        <span className="sync-banner-message">
          <span className="sync-banner-dot" aria-hidden="true" />
          Indexing your library · <span className="tabular">{indexed.toLocaleString()}</span> / <span className="tabular">{total.toLocaleString()}</span> highlights
        </span>
        <span className="sync-banner-action">
          {indexingPct !== null ? (
            <span className="tabular sync-banner-counts">{indexingPct}%</span>
          ) : null}
          <button type="button" className="sync-banner-action-button" onClick={onReindex}>
            Re-index
          </button>
        </span>
      </div>
      <div
        className={`sync-banner-progress ${hasTotal ? "sync-banner-progress-determinate" : "sync-banner-progress-indeterminate"}`}
        role="progressbar"
        aria-valuemin={hasTotal ? 0 : undefined}
        aria-valuemax={hasTotal ? 100 : undefined}
        aria-valuenow={indexingPct ?? undefined}
      >
        {hasTotal ? (
          <span className="sync-banner-progress-fill" style={{ width: `${indexingPct}%` }} />
        ) : (
          <span className="sync-banner-progress-indeterminate-fill" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
```

Update the priority comment above the cascade to:

```tsx
// Priority: Cancelling > Running > Indexing > NoHealthySources > NeedsAuth > Failed > Hidden
// (Cancelling must short-circuit Running because isSyncing is still true while
// a cancel propagates. Indexing is hidden while a sync runs because the sync
// banner is the primary signal during sync.)
```

- [ ] **Step 8.3: Add `.sync-banner-indexing` style**

Append to `styles.css`:

```css
.sync-banner-indexing {
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  color: var(--accent-strong);
}
```

(Lighter than Running so the visual distinction reads.)

- [ ] **Step 8.4: Typecheck + Lint + Commit**

```bash
pnpm --filter @archi/desktop typecheck
pnpm --filter @archi/desktop lint
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/screens/home/SyncBanner.tsx apps/desktop/src/renderer/styles.css
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search commit -m "desktop(home): SyncBanner indexing state"
```

---

### Task 9: `HomeSearchResults` rewrite — hybrid IPC + filter chips + cards

**Files:**
- Modify: `apps/desktop/src/renderer/screens/home/HomeSearchResults.tsx`

Replace the substring-filter rendering with the semantic-search branch's hybrid search experience, inlined into HomeSearchResults.

- [ ] **Step 9.1: Restructure HomeSearchResults's Props**

Read the existing `HomeSearchResults.tsx`. Replace its Props with:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchFilters, SearchResponse } from "@archi/search";
import { SearchFilterChips } from "../../components/SearchFilterChips";
import { SearchResultCard } from "../../components/SearchResultCard";
import { useSearchPreferences } from "../../state/SearchPreferencesContext";

type Props = {
  query: string;
  filters: SearchFilters;
  onFiltersChange: (next: SearchFilters) => void;
  onOpenWork: (workId: string, passageId: string) => void;
  onFindSimilar: (passage: { id: string; body: string }) => void;
};
```

Drop the existing `works: Work[]` and `passages: Passage[]` props (HomeScreen no longer passes them — the IPC call handles result fetching). Drop the local virtualizer for now — we'll use the same `SearchResultCard` rendering pattern as the old SearchScreen.

- [ ] **Step 9.2: Re-implement the component body**

```tsx
export function HomeSearchResults({
  query,
  filters,
  onFiltersChange,
  onOpenWork,
  onFindSimilar
}: Props): JSX.Element {
  const prefs = useSearchPreferences();
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  useEffect(() => {
    const handle = setTimeout(() => {
      void runQuery(query, filters);
    }, 150);
    return () => clearTimeout(handle);
  }, [query, filters, runQuery]);

  const summary = response
    ? `Showing ${response.results.length} of ${response.totalCandidates} candidates (${response.durationMs} ms)`
    : "";

  const handleCopy = (body: string): void => {
    void navigator.clipboard.writeText(body);
  };

  return (
    <div className="home-search-results-v2">
      <SearchFilterChips filters={filters} onChange={onFiltersChange} />
      <div className="home-search-results-v2-summary">{loading ? "Searching…" : summary}</div>
      <div className="home-search-results-v2-list">
        {response?.results.map((r) => (
          <SearchResultCard
            key={r.passageId}
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
        ))}
        {response && response.results.length === 0 && !loading ? (
          <p className="home-search-empty">No matches.</p>
        ) : null}
      </div>
    </div>
  );
}
```

Note: `SearchResultCard` may not currently have `onCopy` and `onFindSimilar` props. Read the existing component and add them if missing (a small modification to the existing SearchResultCard.tsx). Buttons inside the card invoke these.

- [ ] **Step 9.3: Verify SearchResultCard has the necessary action props**

```bash
grep -n "onCopy\|onFindSimilar" /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search/apps/desktop/src/renderer/components/SearchResultCard.tsx
```

If `onCopy` and `onFindSimilar` are not present, edit `SearchResultCard.tsx`:
- Add `onCopy?: () => void;` and `onFindSimilar?: () => void;` to its Props
- Render Copy and Find similar buttons in the card's action row, gated on the optional callbacks being defined

Sample button JSX inside the card:

```tsx
{props.onCopy ? (
  <button type="button" className="passage-card-action" onClick={props.onCopy}>
    Copy
  </button>
) : null}
{props.onFindSimilar ? (
  <button type="button" className="passage-card-action" onClick={props.onFindSimilar}>
    Find similar
  </button>
) : null}
```

(The existing "Open book" button already exists per their branch.)

- [ ] **Step 9.4: Add minimal styles for the new wrapper**

Append to `styles.css`:

```css
.home-search-results-v2 {
  display: grid;
  gap: 14px;
}

.home-search-results-v2-summary {
  font-size: 12px;
  color: var(--ink-500);
}

.home-search-results-v2-list {
  display: grid;
  gap: 10px;
}
```

- [ ] **Step 9.5: Typecheck + Lint + Commit**

```bash
pnpm --filter @archi/desktop typecheck
pnpm --filter @archi/desktop lint
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/screens/home/HomeSearchResults.tsx apps/desktop/src/renderer/components/SearchResultCard.tsx apps/desktop/src/renderer/styles.css
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search commit -m "desktop(home): rewrite HomeSearchResults with hybrid IPC + filter chips + SearchResultCard"
```

---

### Task 10: App.tsx state — `homeSearchFilters`, `findSimilarPassageId`; thread to HomeScreen

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/screens/HomeScreen.tsx`

Adds the state Home needs to drive the filter chips and the "Find similar" flow.

- [ ] **Step 10.1: Add state to App.tsx**

Near the other `useState` declarations:

```tsx
import type { SearchFilters } from "@archi/search";

const [homeSearchFilters, setHomeSearchFilters] = useState<SearchFilters>({});
const [findSimilarPassage, setFindSimilarPassage] = useState<{ id: string; body: string } | null>(null);
```

- [ ] **Step 10.2: Compute the effective query**

When `findSimilarPassage` is set, the header search input shows a sentinel label (handled below) and the search uses the passage body as the query text. Otherwise, use `homeSearchQuery`:

```tsx
const effectiveSearchQuery = findSimilarPassage?.body ?? homeSearchQuery;
const effectiveSearchTrimmed = effectiveSearchQuery.trim();
```

- [ ] **Step 10.3: Pass new props to HomeScreen**

In the `case "Home":` of `screenContent`:

```tsx
case "Home":
  return (
    <HomeScreen
      /* existing props */
      homeSearchQuery={effectiveSearchQuery}
      homeSearchFilters={homeSearchFilters}
      findSimilarPassage={findSimilarPassage}
      onFiltersChange={setHomeSearchFilters}
      onFindSimilar={(passage) => setFindSimilarPassage(passage)}
      onOpenWork={(workId, passageId) => {
        // passageId is forwarded for LibraryBookDetailScreen's pendingScrollPassageId
        setSelectedLibraryWorkId(workId);
        setPendingScrollPassageId(passageId ?? null);
        setActiveScreen("Library");
        // Clear search when opening a work
        setHomeSearchQuery("");
        setFindSimilarPassage(null);
      }}
    />
  );
```

If `setPendingScrollPassageId` doesn't exist yet, add it as a new state value and pass it to LibraryBookDetailScreen via the Library route. (Search the codebase first — the semantic-search branch may already have wired this.)

```bash
grep -n "pendingScrollPassageId" /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search/apps/desktop/src/renderer/App.tsx
```

If absent, add:
```tsx
const [pendingScrollPassageId, setPendingScrollPassageId] = useState<string | null>(null);
```

And pass it to `<LibraryBookDetailScreen pendingScrollPassageId={pendingScrollPassageId} />`.

- [ ] **Step 10.4: Update the content-header search input**

In `App.tsx`, the existing content-header search input renders Home-only. Modify it to display the sentinel when `findSimilarPassage` is set:

```tsx
{activeScreen === "Home" ? (
  <div className="content-header-search">
    {findSimilarPassage ? (
      <div className="content-header-search-sentinel">
        Similar to "<span>{findSimilarPassage.body.slice(0, 40)}{findSimilarPassage.body.length > 40 ? "…" : ""}</span>"
        <button
          type="button"
          className="content-header-search-clear"
          onClick={() => setFindSimilarPassage(null)}
          aria-label="Clear find similar"
        >
          ×
        </button>
      </div>
    ) : (
      <>
        <input
          type="search"
          className="content-header-search-input"
          placeholder="Search your library…"
          value={homeSearchQuery}
          onChange={(event) => setHomeSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && homeSearchQuery) {
              event.preventDefault();
              setHomeSearchQuery("");
            }
          }}
          aria-label="Search your library"
          autoFocus
        />
        {homeSearchQuery ? (
          <button
            type="button"
            className="content-header-search-clear"
            onClick={() => setHomeSearchQuery("")}
            aria-label="Clear search"
            tabIndex={-1}
          >
            ×
          </button>
        ) : null}
      </>
    )}
  </div>
) : null}
```

Add `.content-header-search-sentinel` style:

```css
.content-header-search-sentinel {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
  border-radius: 999px;
  padding: 4px 10px 4px 14px;
  font-size: 12px;
  color: var(--accent-strong);
  max-width: 280px;
}

.content-header-search-sentinel > span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-style: italic;
}
```

- [ ] **Step 10.5: Update HomeScreen Props**

In `HomeScreen.tsx`, extend Props with the new fields and pass them to HomeSearchResults:

```tsx
type Props = {
  /* existing props */
  homeSearchQuery: string;
  homeSearchFilters: SearchFilters;
  findSimilarPassage: { id: string; body: string } | null;
  onFiltersChange: (next: SearchFilters) => void;
  onFindSimilar: (passage: { id: string; body: string }) => void;
  onOpenWork: (workId: string, passageId?: string) => void; // signature gains optional passageId
};
```

Update the destructuring and the conditional render to:

```tsx
{trimmedQuery ? (
  <HomeSearchResults
    query={trimmedQuery}
    filters={homeSearchFilters}
    onFiltersChange={onFiltersChange}
    onOpenWork={(workId, passageId) => onOpenWork(workId, passageId)}
    onFindSimilar={onFindSimilar}
  />
) : (
  <>
    {/* StatsStrip, BooksRail, highlights-split */}
  </>
)}
```

`onOpenWork` signature changes from `(workId: string) => void` to `(workId: string, passageId?: string) => void`. Update the `BooksRail`, `LatestHighlights`, `RandomHighlight` call sites to match — pass `undefined` for passageId.

- [ ] **Step 10.6: Typecheck + Lint + Commit**

```bash
pnpm --filter @archi/desktop typecheck
pnpm --filter @archi/desktop lint
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/screens/HomeScreen.tsx apps/desktop/src/renderer/styles.css
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search commit -m "desktop(home): wire homeSearchFilters + findSimilarPassage; sentinel chip in header"
```

---

### Task 11: Delete dead components (SearchScreen, GlobalSearchBar, IndexerStatusPill, IndexingBanner)

**Files:**
- Delete: `apps/desktop/src/renderer/screens/SearchScreen.tsx`
- Delete: `apps/desktop/src/renderer/components/GlobalSearchBar.tsx`
- Delete: `apps/desktop/src/renderer/components/IndexerStatusPill.tsx`
- Delete: `apps/desktop/src/renderer/components/IndexingBanner.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` (drop any lingering imports)

Strip components that no longer have a role.

- [ ] **Step 11.1: Confirm zero remaining references**

```bash
cd /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search
grep -RE "SearchScreen|GlobalSearchBar|IndexerStatusPill|IndexingBanner" apps/desktop/src/ 2>&1 | grep -v "node_modules"
```

Expected: only matches inside the four files we're about to delete, plus their CSS classes (which are addressed in Task 13). If any other `.tsx` file imports one of these, STOP — that's a wiring leftover from Task 10 or earlier. Fix the import before deleting.

- [ ] **Step 11.2: Delete the files**

```bash
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search rm apps/desktop/src/renderer/screens/SearchScreen.tsx
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search rm apps/desktop/src/renderer/components/GlobalSearchBar.tsx
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search rm apps/desktop/src/renderer/components/IndexerStatusPill.tsx
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search rm apps/desktop/src/renderer/components/IndexingBanner.tsx
```

- [ ] **Step 11.3: Typecheck + Lint + Commit**

```bash
pnpm --filter @archi/desktop typecheck
pnpm --filter @archi/desktop lint
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search commit -m "desktop: drop SearchScreen, GlobalSearchBar, IndexerStatusPill, IndexingBanner"
```

---

### Task 12: CSS cleanup — delete orphan classes from the dropped components

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 12.1: Identify orphan classes**

Search the rendered `.tsx` tree for each class. Run:

```bash
cd /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search
for class in search-screen indexer-status-pill indexing-banner global-search-bar; do
  count=$(grep -RE "\"${class}\"|'${class}'|\.${class}\b" apps/desktop/src --include="*.tsx" --include="*.ts" 2>/dev/null | wc -l)
  echo "$class: $count consumer(s)"
done
```

Expected: each reports 0 consumers (apart from styles.css itself). Any non-zero count means a usage survived — investigate before deleting.

- [ ] **Step 12.2: Delete orphan rules**

In `apps/desktop/src/renderer/styles.css`, delete all rules whose selector starts with:
- `.search-screen` (and all `.search-screen__*` BEM children)
- `.indexer-status-pill`
- `.indexing-banner`
- `.global-search-bar`

Preserve:
- `.search-result-card` and children (consumed by `SearchResultCard.tsx`)
- `.search-filter-chips` and children (consumed by `SearchFilterChips.tsx`)
- `.highlighted-text` and children
- `.passage-card-action` (shared)
- `.settings-search-section` and children (Task 7)
- `.home-search-results-v2` and children (Task 9)

- [ ] **Step 12.3: Verify with grep that all deleted classes have zero remaining references**

```bash
grep -RE "search-screen|indexer-status-pill|indexing-banner|global-search-bar" apps/desktop/src/renderer/ 2>&1 | grep -v "node_modules"
```

Expected: empty.

- [ ] **Step 12.4: Typecheck + Lint + Commit**

```bash
pnpm --filter @archi/desktop typecheck
pnpm --filter @archi/desktop lint
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search add apps/desktop/src/renderer/styles.css
git -C /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search commit -m "desktop: drop orphan CSS for dropped search components"
```

---

### Task 13: Manual verification

**Files:** none (verification only).

- [ ] **Step 13.1: Build deps + start dev**

```bash
cd /Users/benjaminloschen/Projects/archi/.claude/worktrees/local-semantic-search
pnpm --filter @archi/desktop build:deps
pnpm --filter @archi/desktop dev
```

Electron window opens.

- [ ] **Step 13.2: Walk the golden path**

Verify each:

1. Sidebar shows exactly 3 items: Home, Library, Settings.
2. Home shows: SyncBanner (hidden if healthy), StatsStrip, BooksRail, RandomHighlight + LatestHighlights split.
3. Header search input present on Home only; absent on Library + Settings.
4. Type into Home header search → modules below collapse → filter chips + result cards appear with SearchResultCard rendering, KEYWORD/VECTOR/BOTH badges (if `showMatchSource` pref is on).
5. Click "Copy" on a result → clipboard contains the passage body.
6. Click "Open book" on a result → navigates to Library → By book → book detail with the passage scrolled-to-and-ringed.
7. Click "Find similar" → header shows "Similar to '…'" sentinel → results refresh with the passage body as query → clicking × on the sentinel returns to the prior query.
8. Library: "By book" tab shows existing grid; "All highlights" tab shows the recovered Passages experience with substring filter.
9. Settings: three tabs (Connections | Logs | Search); ArrowLeft/ArrowRight cycles focus + activates between them; Search tab shows toggles + Index status; clicking Re-index fires `archi:search:startIndexing` (verify the indexer status reflects this).
10. Indexer running: SyncBanner shows "Indexing your library · X / Y highlights" with progress bar; once idle the banner hides (or shows the next-priority state if applicable).
11. Disconnect Notion (or trigger needs_action via the test path) → banner amber, click → Settings → Connections tab; warning dot appears on the Settings gear in the sidebar.

- [ ] **Step 13.3: Edge cases**

- Empty corpus: First-run, no indexed passages. Settings shows `0 of 0 indexed`; Home search empty state shows "No matches"; banner indeterminate or hidden.
- Search while sync runs: SyncBanner running state above; HomeSearchResults below.
- Search while indexing: search returns partial (indexed-only) results; banner shows indexing.
- Find similar with no body text: button is disabled or hidden (verify SearchResultCard behavior).
- Esc in header search clears query; Esc on sentinel clears find-similar.
- Library tab switch persists per session but not across reloads.

- [ ] **Step 13.4: If issues, fix in a follow-up commit**

Each fix becomes its own commit on this branch. Don't amend prior commits.

- [ ] **Step 13.5: Stop the dev server**

When done verifying, close the Electron window. The TaskStop signal will propagate to the concurrently-managed processes.

---

## Spec coverage check

| Spec section | Tasks |
|---|---|
| Sidebar 3 items (Home / Library / Settings) | 4 |
| Drop Passages route | 4 |
| Library sub-toggle (By book \| All highlights) | 5, 6 |
| Recovered Passages content → LibraryAllHighlights | 5 |
| Settings 3 tabs (Connections \| Logs \| Search) | 7 |
| Settings tab ARIA + keyboard nav | 7 |
| SearchPreferences + IndexerStatus providers wrap App | 3 |
| SyncBanner indexing state | 8 |
| Home header search drives hybrid IPC | 9, 10 |
| Filter chips on Home active search | 9 |
| SearchResultCard with Copy / Open book / Find similar | 9 |
| Find similar sentinel + state | 10 |
| EMBEDDING_MODEL_ID inline workaround | 1 |
| Delete SearchScreen / GlobalSearchBar / IndexerStatusPill / IndexingBanner | 11 |
| CSS cleanup | 12 |
| Merge conflict resolution from main | 2 |
| Provider wrapping on all render paths | 3 |
| Manual verification | 13 |
| workId on listRecentActivity preserved | 2 (step 2.8) |
| clearStaleNeedsAuthIfResolved preserved | 2 (step 2.8) |
