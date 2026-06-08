# Cloud notebook banner: surface only on user-initiated sync failures

Date: 2026-06-08
Status: implemented

## Decision

The home-screen "Cloud notebook needs reconnect" banner is gated by a sticky
boolean `state.cloudAuthSurfaced` persisted in `sync-state.json`.

- Boot/scheduled (auto) syncs that hit `needs_auth` **update the connector's
  cached network status** so Settings → Connections shows the truth, but
  **do not set** `cloudAuthSurfaced`. The home banner stays hidden.
- User-initiated syncs (`archi:run-sync-now`, `archi:force-full-kindle-sync`,
  `archi:refresh-notion-media`) that hit `needs_auth` set `cloudAuthSurfaced`
  to true. The banner appears.
- A successful cloud fetch clears the flag regardless of trigger.
- A successful cloud reconnect or test connection clears the flag.

Implementation lives in `apps/desktop/src/main/cloudAuthSurfaced.ts`
(pure helper) and `apps/desktop/src/renderer/lib/syncBannerMapping.ts`
(renderer-side mask). Both are covered by
`apps/desktop/tests/cloud-auth-surfaced.test.ts`.

## In-flight trigger upgrade

`runSync()` deduplicates concurrent calls by returning the existing in-flight
promise. The trigger is tracked in module-level `inFlightTrigger`, NOT
captured by `runSyncOnce`'s closure. If a user click arrives while an auto
run is mid-fetch, the trigger is **upgraded** from `auto` → `user` and the
needs_auth check at end-of-fetch reads the live (upgraded) value. Without
this upgrade, the user's click would silently inherit the auto outcome and
no banner would appear.

## Why this design

### Why not validate proactively on boot

A prior iteration (commit `920b551`, 2026-06-05 14:40 PT) scheduled a cheap
HTTP probe `validateCloudViaNet()` 2 seconds after boot and every 5 minutes
thereafter, on the theory that Electron's net stack bypasses Amazon's
headless-Chromium detection so the proactive probe is "safe."

This was reverted on 2026-06-08 because the probe pushed the banner up
even when the user had no intent to sync. The probe's correctness wasn't
the issue — the **UX surface** was.

### Why the connector status itself is still allowed to change on auto sync

The connector's cached status is **ground truth** for sync routing. We need
auto syncs to update it so the next sync attempt knows cloud is dead and
can skip retries / surface the right state to Settings → Connections. Only
the **banner display** is gated; the underlying state machine is untouched.

### Why a sticky flag rather than "last sync that completed"

A "show banner only if last sync was user-initiated and failed" rule would
flicker: user fails → banner ON → 5 min later auto-sync runs → banner OFF.
Sticky-until-resolved matches the user's mental model of "the issue is
unresolved until I fix it."

## History note

This spec corrects a 31-minute regression between two commits on 2026-06-05:

- `757dd27` (14:09 PT) — *"validate on sync, not on routine status reads"* —
  established that the banner stays quiet between syncs and only fires after
  a real sync attempt couldn't continue.
- `920b551` (14:40 PT) — *"validate session via Electron net, not Playwright"* —
  reintroduced proactive probing on boot + 5-min interval, undoing the
  principle without explicitly revisiting it.

Future contributors: if you find yourself wanting to "just probe at boot
because it's cheap," re-read this spec first. The cost isn't compute; it's
showing the user a problem before they tried to do anything.

## Files touched (initial implementation)

- `apps/desktop/src/main/index.ts` — state shape, hydration, runSync
  trigger threading, cloudAuthSurfaced transitions, clearStaleNeedsAuthIfResolved
- `apps/desktop/src/main/cloudAuthSurfaced.ts` — pure transition helper
- `apps/desktop/src/preload/index.ts` — SyncState type
- `apps/desktop/src/renderer/env.d.ts` — global IPC return types
- `apps/desktop/src/renderer/App.tsx` — SyncState type, initial value, mask call
- `apps/desktop/src/renderer/lib/syncBannerMapping.ts` — renderer mask helper
- `apps/desktop/tests/cloud-auth-surfaced.test.ts` — unit tests
