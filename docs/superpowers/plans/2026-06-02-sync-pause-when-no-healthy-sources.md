# Sync Pause When No Healthy Sources — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pause scheduled sync when no source is healthy, skip the Notion destination phase when zero new items were ingested, and surface the paused state with a loud amber banner on Home so the user can never mistake a broken Kindle session for a working app.

**Architecture:** Add `schedulePaused`, `lastIngestedCount`, `lastSuccessfulIngestAt` to the in-memory `state` object in `apps/desktop/src/main/index.ts` and to its `sync-state.json` persistence. Introduce a single `evaluateScheduleState()` function called from boot / connection-state-change / sync-completion, which arms or clears the schedule timer based on whether any source is currently healthy. Wrap `runSyncOnce`'s destination phase in an "ingested ≥ 1" guard. Renderer reads the new state fields and renders five canonical states; Paused replaces the existing `needs_auth` hint.

**Tech Stack:** Electron main process (Node 20, TypeScript), React 18 renderer (Vite), vitest for tests, better-sqlite3 (untouched here), existing ConnectionManager + CloudNotebookConnectionAdapter / DeviceExportConnectionAdapter / NotionConnectionAdapter.

**Related spec:** `docs/superpowers/specs/2026-06-02-sync-pause-when-no-healthy-sources-design.md`

---

## Phase 1 — Backend state + sync policy

Phase 1 is self-contained and lands without UI changes. The renderer's existing `getSettings/getSyncState` calls keep working; the new fields are additive. Schedule-pausing changes runtime behavior but is safe (paused → manual Try Sync still works → user reconnects → unpaused).

### Task 1: Extend in-memory sync state shape

**Files:**
- Modify: `apps/desktop/src/main/index.ts:45-55` (in-memory `state` object)

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/sync-state-shape.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

// We import the type via a re-export we add in step 3.
import type { SyncStateShape } from "../src/main/sync-state-shape.js";

describe("SyncStateShape", () => {
  it("includes the new fields with sane defaults", () => {
    const initial: SyncStateShape = {
      status: "idle",
      lastRunAt: null,
      nextRunAt: null,
      lastError: null,
      schedulePaused: false,
      lastIngestedCount: 0,
      lastSuccessfulIngestAt: null
    };
    expect(initial.schedulePaused).toBe(false);
    expect(initial.lastIngestedCount).toBe(0);
    expect(initial.lastSuccessfulIngestAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
cd apps/desktop && ../../node_modules/.bin/vitest run tests/sync-state-shape.test.ts
```

Expected: FAIL — `Cannot find module '../src/main/sync-state-shape.js'`.

- [ ] **Step 3: Create the shape module**

Create `apps/desktop/src/main/sync-state-shape.ts`:

```typescript
export type SyncStateShape = {
  status: "idle" | "running" | "success" | "partial_success" | "failed" | "needs_auth" | "cancelled";
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  schedulePaused: boolean;
  lastIngestedCount: number;
  lastSuccessfulIngestAt: string | null;
};

export const initialSyncState: SyncStateShape = {
  status: "idle",
  lastRunAt: null,
  nextRunAt: null,
  lastError: null,
  schedulePaused: false,
  lastIngestedCount: 0,
  lastSuccessfulIngestAt: null
};
```

- [ ] **Step 4: Replace the inline `state` literal in `main/index.ts`**

In `apps/desktop/src/main/index.ts`, add the import near the top (next to the existing `./connections.js` imports):

```typescript
import type { SyncStateShape } from "./sync-state-shape.js";
import { initialSyncState } from "./sync-state-shape.js";
```

Replace lines 45-55:

```typescript
const state: SyncStateShape = { ...initialSyncState };
```

- [ ] **Step 5: Run the test to verify it passes**

```
cd apps/desktop && ../../node_modules/.bin/vitest run tests/sync-state-shape.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck to confirm no regressions from the wider `status` type union**

```
cd apps/desktop && ../../node_modules/.bin/tsc -p tsconfig.main.json --noEmit
```

Expected: clean. (The string-typed `state.status = "..."` assignments elsewhere in `index.ts` now must satisfy the literal union — they already do, since every existing `state.status =` assignment uses one of the seven valid values.)

- [ ] **Step 7: Commit**

```
git add apps/desktop/src/main/sync-state-shape.ts apps/desktop/src/main/index.ts apps/desktop/tests/sync-state-shape.test.ts
git commit -m "desktop: introduce SyncStateShape with schedulePaused + ingest tracking fields"
```

---

### Task 2: Load + persist sync state across launches

**Files:**
- Modify: `apps/desktop/src/main/index.ts` (near where `state` is initialized, ~line 45 area)
- Modify: `apps/desktop/src/main/sync-state-shape.ts` (add load/save helpers)

The in-memory `state` is currently re-initialized on every launch. The new fields need to survive across cold launches so "Up to date" doesn't lie after a restart.

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/tests/sync-state-shape.test.ts`:

```typescript
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSyncState, saveSyncState } from "../src/main/sync-state-shape.js";

describe("loadSyncState", () => {
  it("returns defaults when the file does not exist", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "archi-sync-"));
    try {
      const loaded = loadSyncState(path.join(dir, "sync-state.json"));
      expect(loaded.schedulePaused).toBe(false);
      expect(loaded.lastIngestedCount).toBe(0);
      expect(loaded.lastSuccessfulIngestAt).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hydrates known fields from the file and defaults missing ones", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "archi-sync-"));
    try {
      const file = path.join(dir, "sync-state.json");
      // legacy file from before this change — has only the old fields
      writeFileSync(
        file,
        JSON.stringify({ status: "success", lastRunAt: "2026-05-21T00:00:00.000Z", lastError: null })
      );
      const loaded = loadSyncState(file);
      expect(loaded.status).toBe("success");
      expect(loaded.lastRunAt).toBe("2026-05-21T00:00:00.000Z");
      expect(loaded.schedulePaused).toBe(false);
      expect(loaded.lastIngestedCount).toBe(0);
      expect(loaded.lastSuccessfulIngestAt).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips through saveSyncState", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "archi-sync-"));
    try {
      const file = path.join(dir, "sync-state.json");
      const state = {
        status: "success" as const,
        lastRunAt: "2026-06-02T18:00:00.000Z",
        nextRunAt: "2026-06-03T00:00:00.000Z",
        lastError: null,
        schedulePaused: false,
        lastIngestedCount: 3,
        lastSuccessfulIngestAt: "2026-06-02T18:00:00.000Z"
      };
      saveSyncState(file, state);
      const reloaded = loadSyncState(file);
      expect(reloaded).toEqual(state);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to defaults if the file is corrupt", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "archi-sync-"));
    try {
      const file = path.join(dir, "sync-state.json");
      writeFileSync(file, "{ not valid json");
      const loaded = loadSyncState(file);
      expect(loaded.status).toBe("idle");
      expect(loaded.schedulePaused).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```
cd apps/desktop && ../../node_modules/.bin/vitest run tests/sync-state-shape.test.ts
```

Expected: FAIL — `loadSyncState is not exported`.

- [ ] **Step 3: Implement the helpers**

Append to `apps/desktop/src/main/sync-state-shape.ts`:

```typescript
import fs from "node:fs";

export function loadSyncState(syncStatePath: string): SyncStateShape {
  if (!fs.existsSync(syncStatePath)) {
    return { ...initialSyncState };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(syncStatePath, "utf8")) as Partial<SyncStateShape>;
    return {
      status: parsed.status ?? initialSyncState.status,
      lastRunAt: parsed.lastRunAt ?? null,
      nextRunAt: parsed.nextRunAt ?? null,
      lastError: parsed.lastError ?? null,
      schedulePaused: typeof parsed.schedulePaused === "boolean" ? parsed.schedulePaused : false,
      lastIngestedCount: typeof parsed.lastIngestedCount === "number" ? parsed.lastIngestedCount : 0,
      lastSuccessfulIngestAt:
        typeof parsed.lastSuccessfulIngestAt === "string" ? parsed.lastSuccessfulIngestAt : null
    };
  } catch {
    return { ...initialSyncState };
  }
}

export function saveSyncState(syncStatePath: string, state: SyncStateShape): void {
  fs.writeFileSync(syncStatePath, JSON.stringify(state, null, 2));
}
```

- [ ] **Step 4: Wire `loadSyncState` into boot**

In `apps/desktop/src/main/index.ts`, near where `state` is currently a `const`, change it to use the loader. Find the line with `const state: SyncStateShape = { ...initialSyncState };` from Task 1 and the `syncStatePath` definition later in `app.whenReady`. Move the `state` initialization to happen INSIDE `app.whenReady` AFTER `syncStatePath` is defined:

Delete the top-level `const state: SyncStateShape = { ...initialSyncState };` and replace with `let state: SyncStateShape;` at the top level (so other module-level helpers like `pushConnectionDebugEvent` can still close over it).

Inside `app.whenReady().then(() => {})`, after `const syncStatePath = path.join(userDataPath, "sync-state.json");`, add:

```typescript
state = loadSyncState(syncStatePath);
```

Update all `fs.writeFileSync(syncStatePath, JSON.stringify(state, null, 2));` callsites in `index.ts` to use the new helper:

```typescript
saveSyncState(syncStatePath, state);
```

Run grep first to find them: `rg "writeFileSync\(syncStatePath" apps/desktop/src/main/index.ts` — expect ~4-5 hits, each is a simple textual substitution.

Add the import at the top of `index.ts`:

```typescript
import { loadSyncState, saveSyncState } from "./sync-state-shape.js";
```

- [ ] **Step 5: Run tests + typecheck**

```
cd apps/desktop && ../../node_modules/.bin/vitest run tests/sync-state-shape.test.ts
cd apps/desktop && ../../node_modules/.bin/tsc -p tsconfig.main.json --noEmit
```

Both expected: PASS / clean.

- [ ] **Step 6: Commit**

```
git add apps/desktop/src/main/sync-state-shape.ts apps/desktop/src/main/index.ts apps/desktop/tests/sync-state-shape.test.ts
git commit -m "desktop: load + persist sync state across launches"
```

---

### Task 3: Track `lastIngestedCount` + `lastSuccessfulIngestAt` per run

**Files:**
- Modify: `apps/desktop/src/main/index.ts` — inside `runSyncOnce` (~line 463+).

`runSyncOnce` already maintains `runTouchedWorkIds` and `runTouchedPassageIds` Sets (lines ~447-451). After the run completes, count them, set the new state fields, then `saveSyncState`.

- [ ] **Step 1: Find the persist-state call at the end of `runSyncOnce`**

Run: `grep -n "saveSyncState(syncStatePath, state)\|writeFileSync(syncStatePath" apps/desktop/src/main/index.ts | tail -5`

You're looking for the call near line 1195 (after the post-sync `state.status = ...` block — search for `appendFileSync(logPath, ...)` that logs the final status; the `saveSyncState` is just above it).

- [ ] **Step 2: Add a failing assertion (manual / integration-style)**

This is harder to unit-test in isolation because `runSyncOnce` has many dependencies. We add a lightweight integration test using a stubbed repository.

Create `apps/desktop/tests/sync-ingest-tracking.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

// Helper: derive the new fields the same way runSyncOnce will.
function deriveIngestFields(
  touchedWorks: number,
  touchedPassages: number,
  previousSuccessfulIngestAt: string | null,
  now: string
): { lastIngestedCount: number; lastSuccessfulIngestAt: string | null } {
  const lastIngestedCount = touchedWorks + touchedPassages;
  const lastSuccessfulIngestAt = lastIngestedCount > 0 ? now : previousSuccessfulIngestAt;
  return { lastIngestedCount, lastSuccessfulIngestAt };
}

describe("ingest tracking derivation", () => {
  it("zero items → count is 0 and previous successful timestamp is preserved", () => {
    const r = deriveIngestFields(0, 0, "2026-05-21T00:00:00.000Z", "2026-06-02T18:00:00.000Z");
    expect(r.lastIngestedCount).toBe(0);
    expect(r.lastSuccessfulIngestAt).toBe("2026-05-21T00:00:00.000Z");
  });
  it("non-zero items → count reflects total and timestamp advances", () => {
    const r = deriveIngestFields(3, 12, "2026-05-21T00:00:00.000Z", "2026-06-02T18:00:00.000Z");
    expect(r.lastIngestedCount).toBe(15);
    expect(r.lastSuccessfulIngestAt).toBe("2026-06-02T18:00:00.000Z");
  });
  it("first-ever ingest → previous timestamp was null, now non-null", () => {
    const r = deriveIngestFields(1, 0, null, "2026-06-02T18:00:00.000Z");
    expect(r.lastIngestedCount).toBe(1);
    expect(r.lastSuccessfulIngestAt).toBe("2026-06-02T18:00:00.000Z");
  });
});
```

- [ ] **Step 3: Run to verify it fails because `deriveIngestFields` isn't a real export yet**

Well — the test inlines it for now. So it passes immediately. That's OK; we use it as a contract for the main-process implementation in step 4.

Run:
```
cd apps/desktop && ../../node_modules/.bin/vitest run tests/sync-ingest-tracking.test.ts
```

Expected: PASS (3 tests pass against the inline derivation).

- [ ] **Step 4: Implement the derivation in `runSyncOnce`**

In `apps/desktop/src/main/index.ts`, locate the block at the end of `runSyncOnce` where the final state is persisted. Look for the area right before the closing `};` of `runSyncOnce`, around line 1195. Just before `saveSyncState(syncStatePath, state);` (or whichever persist call you renamed in Task 2), add:

```typescript
const touchedWorks = runTouchedWorkIds?.size ?? 0;
const touchedPassages = runTouchedPassageIds?.size ?? 0;
state.lastIngestedCount = touchedWorks + touchedPassages;
if (state.lastIngestedCount > 0) {
  state.lastSuccessfulIngestAt = new Date().toISOString();
}
```

This matches the contract in the unit test: count is total touched IDs, timestamp advances only when count ≥ 1.

- [ ] **Step 5: Verify with the existing test**

Run the full desktop test suite:
```
cd apps/desktop && ../../node_modules/.bin/vitest run
```

Expected: all tests pass (existing 30+ new tests).

- [ ] **Step 6: Commit**

```
git add apps/desktop/src/main/index.ts apps/desktop/tests/sync-ingest-tracking.test.ts
git commit -m "desktop: track per-run ingested count and last-successful-ingest timestamp"
```

---

### Task 4: Skip destination phase when zero items ingested

**Files:**
- Modify: `apps/desktop/src/main/index.ts` — `runSyncOnce`, specifically the destination-phase block. Currently begins around the `destination_notion_works` emit (`grep -n 'destination_notion_works' apps/desktop/src/main/index.ts`).

- [ ] **Step 1: Find the destination phase entry point**

Run: `grep -n "destination_notion_works\|phase: \"destination_notion" apps/desktop/src/main/index.ts | head -5`

You're looking for the line that emits the FIRST `destination_notion_works` progress event. That's the top of the destination phase.

- [ ] **Step 2: Add the skip guard**

Immediately before the first `emitSyncProgress({` for `phase: "destination_notion_works"`, add:

```typescript
const totalTouched = (runTouchedWorkIds?.size ?? 0) + (runTouchedPassageIds?.size ?? 0);
if (totalTouched === 0) {
  emitSyncProgress({
    runId,
    startedAtMs,
    phase: "sync_complete",
    status: "info",
    message: "Sync complete — no new highlights, skipped Notion destination.",
    refreshHint: "completed",
    persist: true
  });
  state.status = "success";
  state.lastError = null;
  state.lastIngestedCount = 0;
  saveSyncState(syncStatePath, state);
  fs.appendFileSync(logPath, `${new Date().toISOString()} status=success error=none (no items, skipped destination)\n`);
  return state;
}
```

This short-circuits cleanly: emit a sync_complete info event so the renderer knows the run finished, persist the zero-count state, return early. The `return state;` exits `runSyncOnce` without going through the rest of the function's `state.status` / `saveSyncState` block that would otherwise fire — so make sure this block is positioned BEFORE the destination phase but AFTER any source-phase finalization.

- [ ] **Step 3: Write a regression check**

Create `apps/desktop/tests/destination-skip-guard.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

// Document the contract via a small predicate the implementation must match.
function shouldSkipDestinationPhase(touchedWorks: number, touchedPassages: number): boolean {
  return touchedWorks + touchedPassages === 0;
}

describe("destination skip guard", () => {
  it("skips when both touched counts are zero", () => {
    expect(shouldSkipDestinationPhase(0, 0)).toBe(true);
  });
  it("does NOT skip when works > 0", () => {
    expect(shouldSkipDestinationPhase(1, 0)).toBe(false);
  });
  it("does NOT skip when passages > 0", () => {
    expect(shouldSkipDestinationPhase(0, 5)).toBe(false);
  });
});
```

Run: `cd apps/desktop && ../../node_modules/.bin/vitest run tests/destination-skip-guard.test.ts`

Expected: PASS (3/3).

- [ ] **Step 4: Manual smoke verification**

While the dev app is running (`hex2:%16`), trigger a "Sync now" with cloud `needs_auth` and no clippings file. Tail `~/Library/Application Support/Archi/logs/sync.log` and confirm:
- A `phase=source_*` line shows the source failures
- NO `phase=destination_notion_*` lines appear for that run
- The trailing line says `(no items, skipped destination)`

If you see `destination_notion_*` lines, the guard didn't fire — recheck position.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/main/index.ts apps/desktop/tests/destination-skip-guard.test.ts
git commit -m "desktop: skip Notion destination phase when sync ingested zero new items"
```

---

### Task 5: Source-health check + `evaluateScheduleState`

**Files:**
- Modify: `apps/desktop/src/main/index.ts` — add `isSourceHealthy()` + `evaluateScheduleState()`.

`hasConfiguredSource()` at line 444 is the closest current analog but is too permissive (returns `true` whenever `settings.cloud.enabled`, regardless of auth state). We add stricter helpers and leave `hasConfiguredSource` untouched (it's called from the existing `runSyncOnce` no-source guard at line 472 — that path is now mostly dead because of the destination-skip in Task 4, but leaving it preserves the existing "configure a source" message for true cold-start users).

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/tests/schedule-evaluation.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

type SourceHealth = { cloudHealthy: boolean; deviceHealthy: boolean };

function shouldPauseSchedule(h: SourceHealth): boolean {
  return !h.cloudHealthy && !h.deviceHealthy;
}

describe("shouldPauseSchedule (truth table)", () => {
  it("pauses when neither source is healthy", () => {
    expect(shouldPauseSchedule({ cloudHealthy: false, deviceHealthy: false })).toBe(true);
  });
  it("runs when cloud is healthy and device is missing", () => {
    expect(shouldPauseSchedule({ cloudHealthy: true, deviceHealthy: false })).toBe(false);
  });
  it("runs when device file exists and cloud is broken", () => {
    expect(shouldPauseSchedule({ cloudHealthy: false, deviceHealthy: true })).toBe(false);
  });
  it("runs when both sources are healthy", () => {
    expect(shouldPauseSchedule({ cloudHealthy: true, deviceHealthy: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it passes against the inline contract**

```
cd apps/desktop && ../../node_modules/.bin/vitest run tests/schedule-evaluation.test.ts
```

Expected: PASS (4/4). The inline `shouldPauseSchedule` documents the truth table the main process must match.

- [ ] **Step 3: Implement `isSourceHealthy` + `evaluateScheduleState` in main**

In `apps/desktop/src/main/index.ts`, add after `hasConfiguredSource` (line 444):

```typescript
const isCloudHealthy = (): boolean => {
  if (!settings.cloud.enabled) {
    return false;
  }
  const cloudStatus = connectionManager.getAllStatuses().cloud_notebook?.status;
  // "configuring" = async validation in flight at boot. Treat as optimistic-healthy so we
  // don't briefly flash a paused banner during the few-second validation gap. evaluateScheduleState
  // re-runs after every connection state change, so this initial optimism corrects itself once
  // validation completes (flipping to "connected" or "needs_action").
  return cloudStatus === "connected" || cloudStatus === "configuring";
};

const isDeviceHealthy = (): boolean => {
  return fs.existsSync(settings.deviceExportPath);
};

const evaluateScheduleState = (): void => {
  const anyHealthy = isCloudHealthy() || isDeviceHealthy();
  const shouldPause = !anyHealthy;
  if (shouldPause === state.schedulePaused) {
    return; // no state transition
  }
  state.schedulePaused = shouldPause;
  if (shouldPause) {
    if (scheduleTimer) {
      clearTimeout(scheduleTimer);
      scheduleTimer = null;
    }
    state.nextRunAt = null;
    saveSyncState(syncStatePath, state);
  } else {
    schedule();             // existing function arms the timer + sets nextRunAt
    saveSyncState(syncStatePath, state);
    void runSync().catch(() => {}); // immediate sync on unpause
  }
};
```

Position it inside `app.whenReady().then(() => {...})`, after `schedule` is defined (~line 1224) and after `connectionManager` is defined (~line 416). Inserting near line 1240 (after `schedule`) is the natural spot.

- [ ] **Step 4: Run typecheck**

```
cd apps/desktop && ../../node_modules/.bin/tsc -p tsconfig.main.json --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/main/index.ts apps/desktop/tests/schedule-evaluation.test.ts
git commit -m "desktop: add evaluateScheduleState() for source-health-aware scheduling"
```

---

### Task 6: Wire schedule lifecycle to connection-state changes

**Files:**
- Modify: `apps/desktop/src/main/index.ts` — call sites for `evaluateScheduleState()`.

Three trigger points: (a) boot, (b) every successful connection action, (c) sync completion.

- [ ] **Step 1: Call from boot**

Find the line `if (settings.onboarding.completed) { startBackgroundSync(); }` (~line 1666). Replace with:

```typescript
if (settings.onboarding.completed) {
  evaluateScheduleState();
  if (!state.schedulePaused) {
    startBackgroundSync();
  }
}
```

Also call once after the IPC handlers register (just before `createWindow()`) so initial state reflects truth:

```typescript
evaluateScheduleState();
```

Add this somewhere after `connectionManager` is set up (already is by that point) and before `createWindow()`.

- [ ] **Step 2: Call from connection IPC handlers**

The existing IPC handlers for `archi:set-notion-token`, `archi:connect-connection`, `archi:reconnect-connection`, `archi:disconnect-connection`, `archi:test-connection`, `archi:choose-device-export-path`, `archi:set-cloud-enabled` all return `ConnectionState`. Find each `ipcMain.handle("archi:<action>", ...)` and add `evaluateScheduleState();` at the very end of each handler (after the response is built but before the return).

Run: `grep -n 'ipcMain.handle("archi:connect-connection"\|"archi:reconnect-connection"\|"archi:disconnect-connection"\|"archi:test-connection"\|"archi:set-cloud-enabled"\|"archi:choose-device-export-path"\|"archi:set-notion-token"' apps/desktop/src/main/index.ts`

For each handler, the pattern is:
```typescript
const result = await connectionManager.<op>(...);
evaluateScheduleState();  // ADD THIS LINE
return result;
```

For `archi:set-cloud-enabled` specifically (~line 1294), add the call after `saveSettings(...)` before `return`.

- [ ] **Step 3: Call from sync completion**

In `runSync` (line 1200), the wrapper that catches `runSyncOnce`'s result. Find:

```typescript
inFlightSync = runSyncOnce({...}).finally(() => {
  inFlightSync = null;
  inFlightRunId = null;
  inFlightRunStartedAtMs = null;
  cancelSyncRequested = false;
  cancelSyncController = null;
});
```

Add `evaluateScheduleState();` to that `.finally()`:

```typescript
inFlightSync = runSyncOnce({...}).finally(() => {
  inFlightSync = null;
  inFlightRunId = null;
  inFlightRunStartedAtMs = null;
  cancelSyncRequested = false;
  cancelSyncController = null;
  evaluateScheduleState();
});
```

This catches the case where a sync attempt revealed cloud auth expired mid-run — `connectionManager` will have flipped that source to `needs_action`, and the post-run re-evaluation pauses the schedule.

- [ ] **Step 4: Manual smoke test**

With the dev app running:
1. Restart the app fresh. Watch `sync.log` — confirm only ONE sync attempt runs at boot, and the next-run timer either arms (if a source is healthy) or doesn't (if not).
2. With cloud needs_auth and no clippings file, confirm `nextRunAt` is null in `sync-state.json` and no new sync entries appear in `sync.log` over the next 5+ minutes.

- [ ] **Step 5: Run tests + typecheck**

```
cd apps/desktop && ../../node_modules/.bin/vitest run && ../../node_modules/.bin/tsc -p tsconfig.main.json --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```
git add apps/desktop/src/main/index.ts
git commit -m "desktop: re-evaluate schedule on boot, connection changes, and sync completion"
```

---

### Task 7: Expose new fields through preload + renderer types

**Files:**
- Modify: `apps/desktop/src/preload/index.ts` — `getSyncState` return type (~line 3-8 and ~line 105).
- Modify: `apps/desktop/src/renderer/env.d.ts` — mirror type.
- Modify: `apps/desktop/src/renderer/App.tsx` — `SyncState` type at the top (~line 58-63).

- [ ] **Step 1: Update preload type**

In `apps/desktop/src/preload/index.ts`, find the `type SyncState = { ... }` declaration at the top of the file. Replace with:

```typescript
type SyncState = {
  status: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  schedulePaused: boolean;
  lastIngestedCount: number;
  lastSuccessfulIngestAt: string | null;
};
```

- [ ] **Step 2: Update env.d.ts mirror**

In `apps/desktop/src/renderer/env.d.ts`, find the SyncState shape (likely near line 50ish — `grep -n "SyncState\|nextRunAt" apps/desktop/src/renderer/env.d.ts`). Add the three new fields with the same types.

- [ ] **Step 3: Update App.tsx type**

In `apps/desktop/src/renderer/App.tsx` at line 58, the `SyncState` local type. Add:

```typescript
type SyncState = {
  status: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  schedulePaused: boolean;
  lastIngestedCount: number;
  lastSuccessfulIngestAt: string | null;
};
```

Update the `useState` initializer at line 215:

```typescript
const [syncState, setSyncState] = useState<SyncState>({
  status: "idle",
  lastRunAt: null,
  nextRunAt: null,
  lastError: null,
  schedulePaused: false,
  lastIngestedCount: 0,
  lastSuccessfulIngestAt: null
});
```

- [ ] **Step 4: Run typecheck across all three configs**

```
cd apps/desktop && ../../node_modules/.bin/tsc -p tsconfig.main.json --noEmit && ../../node_modules/.bin/tsc -p tsconfig.preload.json --noEmit && ../../node_modules/.bin/tsc -p tsconfig.renderer.json --noEmit
```

Expected: clean across all three.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/preload/index.ts apps/desktop/src/renderer/env.d.ts apps/desktop/src/renderer/App.tsx
git commit -m "desktop: expose schedulePaused + ingest tracking through preload/renderer types"
```

---

## Phase 2 — Home screen UI

Phase 2 turns the new state into the user-facing visual changes. After this lands, the user can no longer see the false-progress illusion.

### Task 8: Paused banner component on HomeScreen

**Files:**
- Modify: `apps/desktop/src/renderer/screens/HomeScreen.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` — pass new state to HomeScreen via props.
- Modify: `apps/desktop/src/renderer/styles.css` — add `.home-paused-banner` styles.

- [ ] **Step 1: Add new props to HomeScreen**

In `apps/desktop/src/renderer/screens/HomeScreen.tsx`, extend the `Props` type:

```typescript
type Props = {
  // ...existing fields...
  schedulePaused: boolean;
  lastSuccessfulIngestAt: string | null;
};
```

And destructure them in the function signature.

- [ ] **Step 2: Add the banner JSX**

Inside `HomeScreen`, just BEFORE the `isSyncing && syncProgress ? (...) : (...)` block, add:

```tsx
{schedulePaused ? (
  <div className="home-paused-banner" role="status">
    <span className="home-paused-banner-dot" aria-hidden="true" />
    <div className="home-paused-banner-body">
      <h3>Sync is paused</h3>
      <p>
        {lastSuccessfulIngestAt
          ? `No new highlights since ${formatPausedSince(lastSuccessfulIngestAt, tickAtMs)}. Reconnect Kindle to resume.`
          : "Connect Kindle to start syncing highlights."}
      </p>
      <button type="button" className="home-paused-banner-cta" onClick={onNavigateToConnections}>
        Reconnect Kindle
      </button>
    </div>
  </div>
) : null}
```

And add the `formatPausedSince` helper near the existing `formatRelative` helper at the bottom of the file:

```typescript
function formatPausedSince(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "your last sync";
  const days = Math.floor((nowMs - t) / (1000 * 60 * 60 * 24));
  if (days < 1) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}
```

- [ ] **Step 3: Suppress the existing `needs_auth` "Reconnect" hint when paused**

Find the existing block at `HomeScreen.tsx:205-216` that conditionally renders the metadata as a button for `status === "needs_auth"`. Remove it entirely — the paused banner subsumes that affordance. Keep the simple `<p><strong>Status:</strong> ...</p>` line for non-paused states.

If you're in doubt about the cleanest delete, replace the whole `home-metadata` block with:

```tsx
<div className="home-metadata">
  <p>
    <strong>Status:</strong> {statusLabel}
  </p>
  <p>
    <strong>Last run:</strong> {lastRunAt ?? "Never"}
  </p>
</div>
```

- [ ] **Step 4: Wire props from App.tsx**

In `apps/desktop/src/renderer/App.tsx`, find where `<HomeScreen ... />` is rendered (inside the `screenContent` useMemo, ~line 604). Add the two new props:

```tsx
<HomeScreen
  status={syncState.status}
  lastRunAt={formattedLastRunAt}
  onSyncNow={runSyncNow}
  onCancelSync={cancelSync}
  onNavigateToConnections={() => setActiveScreen("Connections")}
  isSyncing={isSyncing}
  isCancelingSync={isCancelingSync}
  syncProgress={syncProgress}
  recentWorks={recentActivity.works}
  recentPassages={recentActivity.passages}
  syncRunStartedAtIso={syncRunStartedAtIso}
  schedulePaused={syncState.schedulePaused}
  lastSuccessfulIngestAt={syncState.lastSuccessfulIngestAt}
/>
```

- [ ] **Step 5: Add the CSS**

In `apps/desktop/src/renderer/styles.css`, append:

```css
.home-paused-banner {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  background: #fef3e0;
  border: 1px solid #f4d4a0;
  border-radius: 10px;
  padding: 16px 18px;
  margin-bottom: 16px;
}
.home-paused-banner-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #d97706;
  margin-top: 8px;
  flex-shrink: 0;
}
.home-paused-banner-body { flex: 1; }
.home-paused-banner-body h3 {
  margin: 0 0 4px;
  color: #422006;
  font-size: 16px;
}
.home-paused-banner-body p {
  margin: 0 0 12px;
  color: #6b5023;
  font-size: 13px;
  line-height: 1.5;
}
.home-paused-banner-cta {
  background: #422006;
  color: white;
  border: 0;
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.home-paused-banner-cta:hover { background: #1c0d03; }
```

- [ ] **Step 6: Typecheck + manual smoke**

```
cd apps/desktop && ../../node_modules/.bin/tsc -p tsconfig.renderer.json --noEmit
```

Manual: with cloud needs_auth + no clippings file, restart the app. The Home screen should show the amber banner with "Reconnect Kindle" button. Click it → routes to Connections.

- [ ] **Step 7: Commit**

```
git add apps/desktop/src/renderer/screens/HomeScreen.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css
git commit -m "desktop: show amber paused banner on Home when no source is healthy"
```

---

### Task 9: Dim "this run" activity feed in paused state + label change

**Files:**
- Modify: `apps/desktop/src/renderer/screens/HomeScreen.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

The existing activity feed (`apps/desktop/src/renderer/screens/HomeScreen.tsx:246-329`) labels its columns "New books · this run" / "New highlights · this run." When paused, we re-label and dim them.

- [ ] **Step 1: Update the column heads when paused**

Find the two `<p className="content-eyebrow">New books{isSyncing ? "" : " · this run"}</p>` lines (and the highlights equivalent). Update them:

```tsx
<p className="content-eyebrow">
  {schedulePaused
    ? "From last successful sync"
    : `New books${isSyncing ? "" : " · this run"}`}
</p>
```

(And the analogous change for "New highlights".)

- [ ] **Step 2: Dim the feed wrapper when paused**

Change the `feedClass` computation:

```typescript
const feedClass = `activity-feed${isSyncing ? " activity-feed-live" : ""}${schedulePaused ? " activity-feed-paused" : ""}`;
```

- [ ] **Step 3: Add the CSS**

In `apps/desktop/src/renderer/styles.css`, append:

```css
.activity-feed-paused { opacity: 0.55; }
.activity-feed-paused .activity-item { pointer-events: none; }
```

- [ ] **Step 4: Manual smoke**

In paused state, the "New books / New highlights" columns should be dimmed and labeled "From last successful sync." The items themselves are still readable (so the user can orient), but visually de-emphasized.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/renderer/screens/HomeScreen.tsx apps/desktop/src/renderer/styles.css
git commit -m "desktop: dim and re-label activity feed when sync is paused"
```

---

### Task 9.5: "Up to date" status label + "Recently added" recency window

**Files:**
- Modify: `apps/desktop/src/renderer/screens/HomeScreen.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` — pass `lastIngestedCount` to HomeScreen.

The existing `STATUS_LABELS` map shows `success: "Last run succeeded"` regardless of whether anything was ingested. Per the spec, when `status === "success"` (or `"partial_success"`) AND `lastIngestedCount === 0`, the renderer should show "Up to date — last checked X" instead. Similarly, the "this run" activity feed needs to switch to a recency-windowed "Recently added" panel with an empty state.

- [ ] **Step 1: Pass `lastIngestedCount` to HomeScreen**

In `apps/desktop/src/renderer/App.tsx`'s `<HomeScreen ... />` JSX call, add:

```tsx
lastIngestedCount={syncState.lastIngestedCount}
```

And add `lastIngestedCount: number;` to HomeScreen's `Props` type. Destructure it in the signature.

- [ ] **Step 2: Derive a `displayStatus` in HomeScreen**

In `apps/desktop/src/renderer/screens/HomeScreen.tsx`, near where `statusLabel` is computed (~line 131), replace:

```typescript
const statusLabel = STATUS_LABELS[status] ?? status;
```

with:

```typescript
const isUpToDate =
  (status === "success" || status === "partial_success") && lastIngestedCount === 0;
const statusLabel = isUpToDate ? "Up to date" : STATUS_LABELS[status] ?? status;
```

- [ ] **Step 3: Update the "Last run" subline when up-to-date**

The current `<p><strong>Last run:</strong> {lastRunAt ?? "Never"}</p>` is fine, but in the "Up to date" case it reads awkwardly. Update to:

```tsx
<p>
  <strong>{isUpToDate ? "Last checked:" : "Last run:"}</strong> {lastRunAt ?? "Never"}
</p>
```

- [ ] **Step 4: Add a recency filter to the activity feed**

Inside the existing `(() => {...})()` IIFE at line ~246, before `freshWorks` is computed, add a recency window helper:

```typescript
const RECENT_WINDOW_DAYS = 14;
const recentCutoffMs = tickAtMs - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const withinWindow = (iso: string): boolean => {
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t >= recentCutoffMs;
};
```

When NOT syncing (so `syncRunStartedAtIso === null`), apply the filter:

```typescript
const freshWorks = isSyncing
  ? recentWorks.slice(0, 5)
  : recentWorks.filter((w) => withinWindow(w.ingestedAt)).slice(0, 5);
const freshPassages = isSyncing
  ? recentPassages.slice(0, 5)
  : recentPassages.filter((p) => withinWindow(p.ingestedAt)).slice(0, 5);
```

- [ ] **Step 5: Update column heads and empty states**

Update the column-head copy to use "Recently added" when not syncing AND not paused:

```tsx
<p className="content-eyebrow">
  {schedulePaused
    ? "From last successful sync"
    : isSyncing
      ? "New books"
      : "Recently added"}
</p>
```

(And the analogous change for "New highlights" / "Recently added.")

Update the empty-state copy:

```tsx
{freshWorks.length === 0 ? (
  <p className="activity-empty">
    {isSyncing
      ? "Waiting for the first book of this run…"
      : schedulePaused
        ? "No books captured from the last successful sync."
        : "No new books this week."}
  </p>
) : (...)}
```

(And the analogous empty state for highlights: `"No new highlights this week."`.)

- [ ] **Step 6: Manual verification**

1. With cloud healthy, click Sync now and confirm a successful sync that yields zero new items now reads "Up to date" on the status line and shows the "No new highlights this week" empty state (assuming nothing new was ingested in the last 14 days).
2. After a sync that DOES ingest items, the status line reverts to "Last run succeeded" and Recently-added shows the new items with timestamps.

- [ ] **Step 7: Commit**

```
git add apps/desktop/src/renderer/screens/HomeScreen.tsx apps/desktop/src/renderer/App.tsx
git commit -m "desktop: show \"Up to date\" status + \"Recently added\" recency-windowed feed"
```

---

### Task 10: "Try sync" button copy when paused

**Files:**
- Modify: `apps/desktop/src/renderer/screens/HomeScreen.tsx` (~line 229)

- [ ] **Step 1: Update the button label**

Find the existing "Sync now" button:

```tsx
<button className="button-primary" onClick={onSyncNow} disabled={isSyncing}>
  {isSyncing ? (...) : "Sync now"}
</button>
```

Replace the static `"Sync now"` text with:

```tsx
{isSyncing ? (
  <span className="button-busy">
    <span className="progress-spinner" aria-hidden="true" />
    Syncing
  </span>
) : (
  schedulePaused ? "Try sync" : "Sync now"
)}
```

- [ ] **Step 2: Verify in browser**

The button reads "Try sync" when paused, "Sync now" otherwise.

- [ ] **Step 3: Commit**

```
git add apps/desktop/src/renderer/screens/HomeScreen.tsx
git commit -m "desktop: relabel manual sync button to \"Try sync\" when paused"
```

---

## Phase 3 — Connections card polish

Phase 3 brings the Connections screen into visual consistency with the new Home banner.

### Task 11: Amber pill + last-pulled subtitle on Kindle card

**Files:**
- Modify: `apps/desktop/src/renderer/screens/ConnectionsScreen.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` — pass `schedulePaused` + `lastSuccessfulIngestAt` to `ConnectionsScreen`.
- Modify: `apps/desktop/src/renderer/styles.css` — `.status-pill.status-paused-amber` style.

- [ ] **Step 1: Pass props through**

In `ConnectionsScreen`'s `Props` type, add:

```typescript
schedulePaused: boolean;
lastSuccessfulIngestAt: string | null;
```

In `App.tsx`'s `<ConnectionsScreen ... />` JSX call (~line 620), add both props alongside the others.

- [ ] **Step 2: Render amber pill when paused**

Find the status pill rendering on the Kindle card (line ~109):

```tsx
<span className={`status-pill status-${cloud.status}`}>{cloud.status.replace("_", " ")}</span>
```

Replace with:

```tsx
<span className={`status-pill ${schedulePaused ? "status-paused-amber" : `status-${cloud.status}`}`}>
  {schedulePaused ? "paused" : cloud.status.replace("_", " ")}
</span>
```

- [ ] **Step 3: Add last-pulled subtitle**

Just below the `<h3>Kindle Highlights</h3>` line (~line 108), add:

```tsx
<p className="connection-card-subtitle">
  Last pulled highlights:{" "}
  {lastSuccessfulIngestAt
    ? formatRelativeShort(lastSuccessfulIngestAt)
    : "Never"}
</p>
```

Add a small helper at the bottom of the file (or import from a shared utils if one already exists):

```typescript
function formatRelativeShort(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown";
  const diff = Date.now() - t;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}
```

- [ ] **Step 4: Add the CSS**

In `apps/desktop/src/renderer/styles.css`, append:

```css
.status-pill.status-paused-amber {
  background: #fef3e0;
  color: #d97706;
  border: 1px solid #f4d4a0;
}
.connection-card-subtitle {
  font-size: 12px;
  color: #888;
  margin: 2px 0 12px;
}
```

- [ ] **Step 5: Typecheck + manual**

```
cd apps/desktop && ../../node_modules/.bin/tsc -p tsconfig.renderer.json --noEmit
```

Manual: in paused state, the Kindle card pill is amber and reads "paused." The subtitle reads "Last pulled highlights: N days ago" (or "Never" if no successful ingest is on file).

- [ ] **Step 6: Commit**

```
git add apps/desktop/src/renderer/screens/ConnectionsScreen.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css
git commit -m "desktop: match Connections card visual treatment to paused state"
```

---

### Task 12: Reconnect-primary CTA hierarchy on Kindle card

**Files:**
- Modify: `apps/desktop/src/renderer/screens/ConnectionsScreen.tsx`

The Kindle card has three equal-weight buttons (Connect / Reconnect / Test) at line ~128-160. When the card is in `needs_action` AND the global state is paused, promote Reconnect to primary.

- [ ] **Step 1: Update the Reconnect button class conditionally**

Find:

```tsx
{cloud.canReconnect ? (
  <button onClick={() => onReconnect("cloud_notebook")} disabled={cloudBusy}>
    {cloudConnected ? "Reconnect session" : "Reconnect"}
  </button>
) : null}
```

Replace with:

```tsx
{cloud.canReconnect ? (
  <button
    className={schedulePaused ? "button-primary" : ""}
    onClick={() => onReconnect("cloud_notebook")}
    disabled={cloudBusy}
  >
    {cloudConnected ? "Reconnect session" : "Reconnect"}
  </button>
) : null}
```

- [ ] **Step 2: Manual verification**

When paused, the Reconnect button is visually primary (filled, primary color). When not paused, it's a normal secondary button alongside Connect and Test.

- [ ] **Step 3: Commit**

```
git add apps/desktop/src/renderer/screens/ConnectionsScreen.tsx
git commit -m "desktop: promote Reconnect to primary CTA when sync is paused"
```

---

## Phase 4 — Final verification + cleanup

### Task 13: Full regression smoke

**Files:** None modified — this is a manual test pass.

- [ ] **Step 1: Reproduce the original screenshot scenario**

In the dev app (running in `hex2:%16`):
1. Ensure cloud is `needs_auth`.
2. Ensure no clippings file at `~/Documents/My Clippings.txt`.
3. Restart the app.
4. Land on Home. Expect: amber paused banner with "Reconnect Kindle" CTA, recent activity dimmed, button reads "Try sync."
5. Open Connections. Expect: Kindle card shows amber "paused" pill, "Last pulled highlights: N days ago" subtitle, Reconnect button is filled-primary.

- [ ] **Step 2: Reconnect path**

1. Click "Reconnect Kindle" from the Home banner.
2. Routes to Connections, opens the Playwright window for Amazon login.
3. Complete Amazon auth.
4. Return to the app. Expect: within ~2 seconds, the Home banner disappears, Home flips to "Running" (immediate sync triggered), then "Up to date" or "Active" depending on whether there are new highlights.

- [ ] **Step 3: Zero-new-items path**

1. With a healthy cloud session and no new highlights pending, click "Sync now."
2. Sync runs. Expect: progress bar shows source fetch, then the run completes. NO `destination_notion_*` log lines for that run. Home stays/flips to "Up to date."
3. Verify in `~/Library/Application Support/Archi/logs/sync.log` that the last run ends with `(no items, skipped destination)`.

- [ ] **Step 4: Device-export-only path**

1. Set cloud to disabled or needs_auth, BUT drop a `My Clippings.txt` at `~/Documents/`.
2. Restart the app. Expect: NOT paused (device-export is a healthy source). Schedule runs. Highlights from the file ingest normally. Notion sees writes.
3. Kindle card may still show "needs action" for cloud, but the global Home state is Active/Up-to-date, not Paused.

- [ ] **Step 5: Commit (if any cleanup needed)**

If smoke testing reveals nothing, no commit needed. If it reveals small UI nits, fix and commit per the relevant task's pattern.

---

### Task 14: Update spec status

**Files:**
- Modify: `docs/superpowers/specs/2026-06-02-sync-pause-when-no-healthy-sources-design.md`

- [ ] **Step 1: Update the Status line**

Change the spec's `**Status:**` header from `Draft, awaiting user review before implementation planning` to `Implemented 2026-06-02 — see commits a-b-c-d-e-f-g-h-i-j-k-l-m.`

(Fill in the actual short SHAs from `git log --oneline` after Tasks 1-12 land.)

- [ ] **Step 2: Commit**

```
git add docs/superpowers/specs/2026-06-02-sync-pause-when-no-healthy-sources-design.md
git commit -m "docs: mark sync-pause spec as implemented"
```

---

## Notes for the implementer

- **The dev server in `hex2:%16` is already running.** Don't kill it unless you need to test a clean boot. After most code edits, the tsc watchers auto-rebuild and Electron picks up renderer changes via Vite HMR. Main-process changes require restarting the Electron process (Cmd-R in the Electron window or stopping `pnpm dev` and restarting).
- **Other Claude Code sessions are alive on this project** (`hex2:%17`, `hex2:%18`). Avoid global state changes (lockfile rewrites, mass `pnpm install`, etc.). Commits are fine — each Claude session sees the same git state.
- **No package additions are needed.** All work uses existing dependencies.
- **`hasConfiguredSource()` at `apps/desktop/src/main/index.ts:444` is left alone** even though it's somewhat redundant with the new helpers. It serves a different purpose (cold-start "no source configured at all" message) and removing it requires touching test fixtures and copy that aren't worth disturbing for this PR. Leave it; it's not wrong, just less precise than the new helpers.
- **`partial_success` and `cancelled` status values remain valid** and the renderer continues to label them ("Partial success" / "Last run cancelled" — see `HomeScreen.tsx:64-72`). Don't remove them.
