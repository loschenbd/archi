# Pause sync when no source is healthy: design

**Date:** 2026-06-02
**Author:** Archi maintainers (drafted via brainstorming session)
**Status:** Draft, awaiting user review before implementation planning
**Scope:** `apps/desktop/src/main/index.ts` (scheduler, sync loop), `apps/desktop/src/renderer/screens/HomeScreen.tsx`, `apps/desktop/src/renderer/screens/ConnectionsScreen.tsx`, related preload IPC.

## Problem

When the Kindle cloud-notebook session expires and no clippings file exists locally, the app's scheduled sync continues to fire every 6 hours. Each tick produces no new ingested data (both sources fail or no-op), but the destination phase still re-pushes existing local SQLite rows to Notion. The result is a misleading experience:

- The Home screen's "recent activity" panel shows works/passages with no special signal — they look fresh, but they're from a sync that succeeded weeks earlier.
- Notion receives writes on every scheduled tick, so a user watching their Notion database sees activity and assumes sync is healthy.
- The Connections screen does say "Kindle Highlights — Needs Action," but the rest of the app behaves as if everything is fine, so the user has no reason to look there.

Concrete state observed in the wild on 2026-06-02: the user's cloud session has been `needs_auth` since 2026-05-21 (12 days), the clippings file path is empty, and yet the sync schedule has fired repeatedly and the Home screen still feels alive.

## Goals

- Eliminate the false-progress illusion: the user can trust at a glance whether new highlights are being captured.
- Stop running scheduled work that cannot produce new data. No Notion writes when no new source data was ingested.
- Make the "your Kindle needs reconnecting" message impossible to miss from the app's entry point (Home), not just from a sub-screen.
- Preserve the user's manual escape hatches: "Sync now" (renamed contextually) and per-source Connect / Reconnect / Test remain available in all states.

## Success criteria

- With cloud `needs_auth` and no clippings file, the app shows a "Sync is paused" banner on Home within one app launch / connection refresh, and the schedule fires zero automatic ticks.
- When the user successfully reconnects the cloud session, the Home banner disappears within ~2 seconds (driven by the connection-state-change side effect, not the next scheduled tick).
- A successful sync that ingests zero new items writes nothing to Notion and produces no `destination_notion_*` log entries for that run.
- The Home "Recent" panel never shows items older than the recency window without that fact being visible to the user.

## Non-goals

- Surfacing the device-export source as its own first-class card. It remains a hidden fallback path. (Not picked as a top frustration; expansion is a separate scope.)
- Sidebar / dock-icon badges for paused state. The Home banner is the primary signal. If it turns out to be too easy to miss after this ships, badges become a follow-up.
- OS-level push notifications for sync state changes.
- Proactive "your session is about to expire" warnings. Amazon doesn't give us a reliable expiry signal; reactive ("it expired, fix it") is good enough.
- Sync history view beyond what `Logs` already shows.
- Any changes to the Notion destination side beyond conditionally skipping its phase.

## Sync policy

The scheduler's decision rule:

| Source state | Behavior |
|---|---|
| Any source healthy (cloud session valid OR clippings file exists at `settings.deviceExportPath`) | Schedule runs. Each tick attempts every healthy source. |
| No source healthy (cloud unhealthy AND no clippings file) | **Schedule paused.** No automatic ticks. `state.nextRunAt` is null. The schedule re-arms automatically when any connection state change makes a source healthy. |
| Source phase completed and ingested zero new works/passages this run | Skip the destination phase entirely for that run. No Notion writes, no `destination_notion_*` progress events, no "Notion destination sync finished" log entry. Source attempt result is still logged. |

Manual sync remains available in all states; in the paused state the button copy is **Try sync** (not "Sync now") to make it clear it's the user's retry tool, not the same automatic flow.

### Source-health definition

A source is "healthy" if:

- **cloud_notebook**: the connection manager's status is `connected`. `needs_action`, `error`, `configuring`, `disconnected` all count as unhealthy. The `enabled` toggle being off counts as unhealthy (treat as "user has opted out of this source," not "broken").
- **device_export**: `fs.existsSync(settings.deviceExportPath)` is true.

The existing `hasConfiguredSource()` helper at `apps/desktop/src/main/index.ts:444` is the closest current analog but is too permissive — it returns `true` when cloud is `enabled` regardless of authentication state. The new check must consult the live connection manager status, not just the settings toggle.

### Schedule lifecycle

The scheduler today has a single `setTimeout` chain that re-arms itself on completion. The new lifecycle:

1. **On boot** (after `app.whenReady` + connection bootstrap completes): evaluate source health. If any source healthy → arm timer. If none → leave paused, set `state.nextRunAt = null`.
2. **On connection-state-change** (any successful Connect/Reconnect/Test/Disconnect, or device-export path change): re-evaluate source health.
   - Paused → any healthy: arm timer, set `state.nextRunAt`. Optionally trigger an immediate sync (yes — newly-reconnected user expects "do it now").
   - Any healthy → paused: clear timer, set `state.nextRunAt = null`. Don't cancel an in-flight sync; let it finish then don't re-arm.
3. **On sync completion**: re-evaluate. If still healthy → re-arm. If now unhealthy (sync revealed expired cookies, etc.) → pause.

The trigger surface is the existing `ConnectionManager` operations in `apps/desktop/src/main/connections.ts` — they already update internal state on success. Add a single callback hook so the main process can react.

### Destination-skip rule

In `runSyncOnce`, after the source phase but before the destination phase, count `runTouchedWorkIds.size + runTouchedPassageIds.size`. If both are zero, emit a `sync_complete` event with `status: "info"` and message `"Sync complete — no new highlights."` and return, skipping the entire `destination_notion_*` phase.

This is a small change. The touched-IDs sets at `apps/desktop/src/main/index.ts:447-461` already exist for the "new this run" Home feed; we just gate the destination on them.

## Renderer / UI surfaces

### Home screen states

Five canonical states. Today's screen blends them; the change is to make them visually distinct.

| State | Trigger | Treatment |
|---|---|---|
| **Paused** | No healthy sources | Amber banner replaces the Sync-now block: title "Sync is paused", subtitle "Kindle session expired N days ago. No new highlights since `<date>`." Primary button: **Reconnect Kindle** (navigates to Connections, triggers reconnect). Below: "Recent activity" panel rendered at reduced opacity and labeled "From last successful sync." |
| **Up to date** | Sources healthy, last sync ingested zero new items | Quiet status line: "Up to date — last checked `<relative time>`." No banner. "Recently added" panel below; empty state if nothing new in 14 days: "No new highlights this week." |
| **Active** | Sources healthy, recent sync ingested ≥1 new item | Today's behavior, kept. "Last synced `<relative>` — `<N>` new highlights." Recently-added panel shows the new items at the top. |
| **Running** | Sync in progress | Today's behavior, kept. Progress phase + counts. |
| **Failed** | Last sync threw a non-auth runtime error (network blip during Notion write, malformed clippings file, unexpected exception). Auth-related failures route to **Paused**, not Failed. | Today's behavior, kept. Red banner with error message and "Try again" button. |

State derivation:

The renderer combines three pieces of `SyncState` to pick its visual state:

| Visual state | Derivation |
|---|---|
| **Paused** | `schedulePaused === true` (new field — overrides everything else, even if a last-run status exists) |
| **Running** | `status === "running"` |
| **Failed** | `status === "failed"` |
| **Up to date** | not paused, not running, not failed, AND `lastIngestedCount === 0` |
| **Active** | not paused, not running, not failed, AND `lastIngestedCount >= 1` |

`SyncState` (currently `{ status, lastRunAt, nextRunAt, lastError }`) gains three fields:

- `schedulePaused: boolean` — true when the main-process scheduler has decided not to run (no healthy sources). Orthogonal to `status`, which still describes the result of the most recent run.
- `lastIngestedCount: number` — number of works+passages touched on the most recent run.
- `lastSuccessfulIngestAt: string | null` — ISO timestamp of the last run that ingested ≥1 item. Drives the "No new highlights since `<date>`" copy in the paused banner.

`status` is **kept as-is** (`"idle" | "running" | "success" | "partial_success" | "failed" | "needs_auth" | "cancelled"`). It captures the outcome of the last sync attempt, regardless of whether the scheduler is currently paused. This avoids collapsing existing semantics like `partial_success` (one source worked, another didn't) into a single "paused" sentinel.

`needs_auth` as a `status` value remains valid — it can fire when a sync attempt revealed a source's auth expired mid-run. But its UI effect is now subsumed: when `needs_auth` fires AND no other source carried the run successfully, the connection-state-change side effect (the scheduler re-evaluating) flips `schedulePaused` to true on the next tick. The renderer then displays the Paused banner. The user never sees the bare "Needs authentication" copy on Home — they see the paused banner with its richer "Reconnect Kindle" CTA. The existing `status === "needs_auth"` callsite at `HomeScreen.tsx:205-216` becomes dead code and is removed.

### Recently-added panel

Today's "Recent activity" panel is a rolling top-N regardless of age. Replace with:

- Title: "Recently added" (not "Recent activity").
- Bounded by recency window: items added in the last 14 days. Show up to 8.
- Each row shows its ingest timestamp ("3 hours ago", "2 days ago").
- Empty state when window is empty: "No new highlights this week. `<Reconnect / Sync now>` button."
- In the Paused state, the panel is rendered at 60% opacity and the title becomes "From last successful sync" — items still listed for orientation, but visually de-emphasized.

The underlying IPC (`archi:list-recent-activity`) already returns ingest timestamps; the renderer just changes its filter and labeling.

### Connections card

The Kindle Highlights card already exists and is mostly right. Minor changes:

- **Match paused urgency.** When the global sync state is paused, the card's status pill uses the same amber treatment as the Home banner — visual consistency across surfaces.
- **CTA hierarchy.** When the card's status is `needs_action`, Reconnect becomes the primary (filled) button; Connect / Test demote to secondary. Mirrors the Home banner's primary CTA.
- **Last-pulled subtitle.** Below the card title, add a small line: "Last pulled highlights: `<relative time>`" or "Never" if the card has never delivered. Helps the user understand per-source freshness when one source is healthy and the other isn't.
- **No device-export card.** Per the non-goals, the device-export source remains hidden.

### Manual sync button copy

In the existing `HomeScreen`, the "Sync now" button copy is context-dependent:

- Paused → **Try sync** (user override; will retry but will likely fail again until they reconnect).
- Up to date / Active / Failed → **Sync now** (current copy).
- Running → button disabled, shows "Syncing…" (today's behavior).

## IPC / data flow changes

Renderer-visible shape changes:

```ts
// preload/index.ts → getSyncState() return type
type SyncState = {
  status: "idle" | "running" | "success" | "partial_success" | "failed" | "needs_auth" | "cancelled";  // unchanged
  lastRunAt: string | null;
  nextRunAt: string | null;          // null when schedulePaused === true
  lastError: string | null;
  schedulePaused: boolean;            // NEW
  lastIngestedCount: number;          // NEW
  lastSuccessfulIngestAt: string | null;  // NEW
};
```

Callers reading `status` continue to work without changes. The `HomeScreen.tsx:205-216` block that special-cases `status === "needs_auth"` to render a "Reconnect" hint is removed — the Paused banner subsumes that affordance more clearly.

Main-process changes:

- Persisted `sync-state.json` shape extended to include the two new fields. Migration: missing fields default to `0` / `null`. No destructive rename.
- New private method `evaluateScheduleState()` called from: (a) boot, (b) every connection-manager state change, (c) every sync completion. Returns "should-be-armed" or "should-be-paused" and reconciles the timer accordingly.
- `runSyncOnce` increments a per-run touched counter and stamps `lastIngestedCount` + `lastSuccessfulIngestAt` on `state` before persisting.
- `runSyncOnce`'s destination phase guarded by `if (touchedWorks + touchedPassages > 0)`.

No new IPC channels needed — existing `archi:get-sync-state` and the `archi:sync-progress` event stream carry the new fields.

## Edge cases

- **In-flight sync at the moment a source becomes unhealthy.** Let it finish naturally; don't cancel. After it completes, the schedule re-evaluation will see no-healthy-sources and pause. The completed sync's destination phase is still skipped if it ingested zero new items.
- **Reconnect succeeds, but the immediate sync triggered by re-arm finds zero new items.** Banner disappears (state is no longer "paused"), Home flips to "Up to date" with `lastSuccessfulIngestAt` carried forward (it doesn't update on a zero-ingest run). The user sees "Up to date — last checked just now."
- **Clippings file appears mid-paused state** (user dropped a file into `~/Documents/`). The schedule does NOT auto-detect this — `fs.existsSync` isn't watched. The next manual Try Sync, or the next connection-related IPC call, triggers re-evaluation and unpause. Out of scope to add a filesystem watcher; an FS-watcher would be a small follow-up if this proves to be a common path.
- **Boot order**: connection-manager bootstrap is asynchronous (cloud validation is a Playwright operation). Initial schedule decision should not block boot waiting for cloud validation. Treat unknown source health on boot as "healthy enough to arm once" — let the first scheduled run discover the true state. Subsequent re-evaluations driven by real connection events will pause if needed. (Alternative considered: block boot until first health check returns. Rejected — adds latency, no clear UX win.)
- **Source enabled toggle**: the existing `Enable Kindle Highlights sync` checkbox on the Connections card. If the user disables it, that source becomes unhealthy. If both sources are disabled / missing, the schedule pauses. This is consistent with the user actively saying "I don't want this," so the paused banner copy in that case should read "Sync is paused — no sources enabled" with a CTA pointing to Connections rather than "Reconnect Kindle." Two banner variants:
  - "Session expired" variant when cloud was `connected` and flipped to `needs_auth`.
  - "No sources" variant when nothing is enabled / configured.

## Testing

Unit:

- `evaluateScheduleState()` returns "paused" when both sources unhealthy; returns "armed" when either is healthy. Cover the four cells of the truth table.
- Destination phase is skipped when `touchedWorks + touchedPassages === 0` and runs when ≥1. Verified by counting `destination_notion_*` progress events for two synthetic runs.

Integration:

- Boot with cloud `needs_auth` and no clippings file → `state.status === "paused"`, `state.nextRunAt === null`, no scheduled run fires within 30s.
- Boot in paused state → call `connectionManager.reconnect("cloud_notebook")` with a stubbed-success → state flips to non-paused within 2s and an immediate sync is triggered.
- Sync run with `lastIngestedCount: 0` produces zero `destination_notion_*` log lines.

Manual smoke (in the dev app):

- Reproduce the screenshot scenario (cloud needs_auth, no clippings file). Open Home → amber banner present, Reconnect CTA prominent, recent activity dimmed.
- Click Reconnect → complete Amazon flow → return to app → banner gone within 2s, status shifts to Running, then Up-to-date.
- Move clippings file into `~/Documents/` then click Try Sync → device-export ingest runs.

## Implementation order (rough sketch — refined in the plan)

1. Backend: extend `SyncState` shape + persistence. Add `evaluateScheduleState()`. Wire connection-manager state-change hook. Destination-skip guard. New `paused` status sentinel.
2. Renderer: new Home banner component for paused state. "Recently added" panel rewrite with recency window. CTA copy switching.
3. Connections card polish: amber pill, CTA hierarchy, last-pulled subtitle.
4. Tests at each layer per the testing plan.

Implementation plan to be drafted in the follow-up `writing-plans` pass.
