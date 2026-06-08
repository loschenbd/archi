// Maps a raw ConnectionState (from getConnections IPC) into the trimmed
// shape the SyncBanner consumes, applying the cloud-banner gate:
//
// cloud_notebook needs_action is HIDDEN from the SyncBanner unless a
// user-initiated sync has surfaced it (syncState.cloudAuthSurfaced === true).
// Auto/boot sync failures update the connector's network truth but stay quiet
// in the UI. See docs/superpowers/specs/2026-06-08-cloud-banner-on-user-sync-only.md.
//
// Note: Settings → Connections does NOT use this mapping — it reads the raw
// connection.status directly so the true state always surfaces there.

export type RawConnection = {
  provider: "notion" | "cloud_notebook" | "device_export";
  label: string;
  status: "connected" | "needs_action" | "error" | "disconnected" | "configuring";
  metadata?: { enabled?: boolean } | null | undefined;
};

export type BannerConnection = {
  provider: "notion" | "cloud_notebook" | "device_export";
  label: string;
  status: "connected" | "needs_action" | "error" | "disconnected" | "configuring";
  enabled: boolean;
};

export function maskConnectionForBanner(
  c: RawConnection,
  cloudAuthSurfaced: boolean
): BannerConnection {
  const status =
    c.provider === "cloud_notebook" && c.status === "needs_action" && !cloudAuthSurfaced
      ? "connected"
      : c.status;
  return {
    provider: c.provider,
    label: c.label,
    status,
    enabled: c.metadata?.enabled !== false
  };
}
