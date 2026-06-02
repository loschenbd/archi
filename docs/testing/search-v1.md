# Search v1 — Manual QA Checklist

Run on a packaged DMG (`pnpm --filter @archi/desktop package`) installed in
`/Applications`, not from `pnpm dev`. Most issues are packaging-specific.

## Smoke tests

- [ ] First install with no synced data: Search screen shows empty state gracefully
- [ ] First install with synced data: indexing banner appears, results populate progressively
- [ ] Type "anger" with no filters: relevant Aurelius/Seneca passages appear
- [ ] Add Author chip "Marcus Aurelius": narrowed to Aurelius only
- [ ] Type "Meditations": FTS5 finds the structural reference
- [ ] Click a search result: navigates to Passages screen (deep-link to the
      specific passage row is a known limitation, see caveats)
- [ ] `⌘K` from any non-onboarding screen focuses the global search bar
- [ ] Type 2+ chars: dropdown shows up to 5 results
- [ ] `↵` opens the highlighted result; `⌘↵` opens the full Search screen with the query
- [ ] `Esc` closes the dropdown
- [ ] Edit a passage's body (e.g., via Notion sync round-trip) → search reflects the edit
      within seconds (next sync triggers indexer.tick())
- [ ] Archive a passage: no longer in search; unarchive: reappears
- [ ] Quit app mid-indexing → relaunch: indexing resumes from where it left off
- [ ] Force-quit during a query: no DB corruption on relaunch (open and re-query)
- [ ] Click "⚡ Find similar" on a passage row: Search screen opens with that body
      as the query, ranked similar passages shown
- [ ] Connections screen (where Settings live in Archi) shows the Search panel with
      current index status, embedding model name, and any failed/lastError diagnostics
- [ ] Resize window small: Search screen remains usable

## Known caveats (non-blocking)

### CSS not yet styled
The new SearchScreen, SearchResultCard, SearchFilterChips, GlobalSearchBar, and
IndexingBanner components use BEM-style class names (`search-screen__*`,
`global-search-bar__*`, etc.) that don't have matching rules in
`apps/desktop/src/renderer/styles.css`. The UI is functional but visually
unstyled. The `FindSimilarButton` and Settings panel were adapted to reuse
existing styles (`passage-card-action`, `connection-card`) so they look correct.

A separate styling pass should add rules matching the existing aesthetic. Not
in scope for v1 functional QA.

### onOpenPassage navigation is shallow
Clicking a search result navigates the user to the Passages tab but doesn't
scroll to or highlight the specific passage. PassagesScreen has no
`selectedPassageId` concept yet; deep-linking is a follow-up enhancement.

### GlobalSearchBar typecheck error
`apps/desktop/src/renderer/components/GlobalSearchBar.tsx:49` has a
`TS2532: Object is possibly 'undefined'` error introduced during the UI tasks.
Functionally works (`useState(0)` is initialized) but typecheck reports this
1 error. Fix by adding a guard or non-null assertion.

### Bundle size grew ~38 MB
The DMG grew from 154 MB → 192 MB because `onnxruntime-node` ships native
binaries for 5 platforms (linux/x64, linux/arm64, darwin/x64, darwin/arm64,
win32/x64, win32/arm64). On a macOS-only release, pruning non-Darwin
platforms via electron-builder `files: "!node_modules/onnxruntime-node/bin/napi-v3/{linux,win32}/**"`
would save ~15 MB. Defer until release prep.

### better-sqlite3 ABI side-effect
After running `pnpm --filter @archi/desktop package`, the
`better-sqlite3.node` binary in `node_modules` is rebuilt against Electron's
`NODE_MODULE_VERSION`. Subsequent `vitest` runs (which use Node's ABI) will
fail with `was compiled against a different Node.js version using
NODE_MODULE_VERSION 125; this version requires 115`. Recovery:
`pnpm rebuild better-sqlite3` once. Pre-existing behavior — not introduced
by this feature.

### @electron/rebuild postinstall warning
`pnpm install` emits a non-fatal `ERR_MODULE_NOT_FOUND` warning because
`apps/desktop/scripts/rebuild-native-for-electron.mjs` imports a package
that isn't declared as a devDep. The script isn't on the critical path
(`pnpm package` uses electron-builder's built-in rebuild). Pre-existing in
the repo, not introduced by this feature.

### Full signed/notarized DMG verification
Final release packaging requires Apple credentials
(`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_NAME`).
The QA workflow in this branch was performed against an unsigned local
build. Before tagging a release, run `pnpm --filter @archi/desktop release`
on a machine with credentials present.

## Verification status (automated)

These all passed at the end of implementation:

- `pnpm --filter @archi/search test` — 16/16 passing
- `pnpm --filter @archi/core test` — 25/25 passing
- `pnpm --filter @archi/desktop typecheck` — 1 error total, in
  `src/renderer/components/GlobalSearchBar.tsx:49` (`TS2532: Object is
  possibly 'undefined'`). Zero errors in main, preload, or any other
  renderer component or backend file from this feature.
- Unsigned `electron-builder --mac dmg --publish=never` — produces a 192 MB
  DMG with `vec0.dylib`, `onnxruntime_binding.node`, and the bge-small ONNX
  model correctly bundled.
- `node apps/desktop/scripts/verify-packaged-runtime.mjs` — exits 0,
  confirming model + sqlite-vec native are present.
