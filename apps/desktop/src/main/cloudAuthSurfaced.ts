// Pure transition for the `cloudAuthSurfaced` sticky bit that drives the
// home-screen "Cloud notebook needs reconnect" banner.
//
// The rule (see docs/superpowers/specs/2026-06-08-cloud-banner-on-user-sync-only.md):
//   - A successful cloud fetch clears the flag, regardless of trigger.
//   - A needs_auth result during a USER-initiated sync sets the flag.
//   - A needs_auth result during an AUTO sync leaves the flag alone (auto
//     failures update the connector's network truth but stay quiet in the UI).
//   - Anything else leaves the flag alone.

export type CloudSyncStepOutcome = "success" | "needs_auth" | "other" | "skipped";
export type SyncTrigger = "user" | "auto";

export function nextCloudAuthSurfaced(
  current: boolean,
  outcome: CloudSyncStepOutcome,
  trigger: SyncTrigger
): boolean {
  if (outcome === "success") {
    return false;
  }
  if (outcome === "needs_auth" && trigger === "user") {
    return true;
  }
  return current;
}
