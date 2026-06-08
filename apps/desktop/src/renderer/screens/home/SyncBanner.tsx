import { useEffect, useMemo, useState } from "react";
import { formatElapsed } from "./utils";

type ConnectionStatus = "connected" | "needs_action" | "error" | "disconnected" | "configuring";
type ConnectionProvider = "notion" | "cloud_notebook" | "device_export";

export type SyncBannerConnection = {
  provider: ConnectionProvider;
  label: string;
  status: ConnectionStatus;
};

export type SyncBannerProgress = {
  message: string;
  phase: string;
  status: "running" | "success" | "failed" | "needs_auth" | "partial_success" | "info";
  source?: "device-export" | "cloud-notebook" | "notion";
  elapsedMs: number;
  counts?: {
    processed?: number;
    total?: number;
    works?: number;
    passages?: number;
  };
} | null;

type Props = {
  isSyncing: boolean;
  isCancelingSync: boolean;
  syncProgress: SyncBannerProgress;
  connections: SyncBannerConnection[];
  lastError: string | null;
  noHealthySources: boolean;
  onCancelSync: () => void;
  onRetrySync: () => void;
  onNavigateToSettings: (tab: "connections" | "logs") => void;
};

const PHASE_LABELS: Record<string, string> = {
  sync_start: "Starting sync",
  sync_cancel_requested: "Cancelling",
  source_device_read: "Reading device export",
  source_device_upsert_works: "Saving works from device export",
  source_device_upsert_passages: "Saving passages from device export",
  source_cloud_fetch: "Fetching cloud highlights",
  source_cloud_upsert: "Saving cloud highlights",
  destination_notion_works: "Syncing works to Notion",
  destination_notion_passages: "Syncing passages to Notion",
  sync_complete: "Sync complete",
  sync_error: "Sync error"
};

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function SyncBanner(props: Props): JSX.Element | null {
  const {
    isSyncing,
    isCancelingSync,
    syncProgress,
    connections,
    lastError,
    noHealthySources,
    onCancelSync,
    onRetrySync,
    onNavigateToSettings
  } = props;

  const [progressBaseAtMs, setProgressBaseAtMs] = useState<number>(Date.now());
  const [tickAtMs, setTickAtMs] = useState<number>(Date.now());

  useEffect(() => {
    if (!syncProgress) return;
    setProgressBaseAtMs(Date.now());
    setTickAtMs(Date.now());
  }, [syncProgress]);

  useEffect(() => {
    const activeIntervalMs = isSyncing && syncProgress?.status === "running" ? 1000 : 15000;
    const interval = setInterval(() => setTickAtMs(Date.now()), activeIntervalMs);
    return () => clearInterval(interval);
  }, [isSyncing, syncProgress]);

  const displayedElapsedMs = useMemo(() => {
    if (!syncProgress) return 0;
    if (isSyncing && syncProgress.status === "running") {
      return syncProgress.elapsedMs + Math.max(0, tickAtMs - progressBaseAtMs);
    }
    return syncProgress.elapsedMs;
  }, [isSyncing, progressBaseAtMs, syncProgress, tickAtMs]);
  const elapsedSeconds = Math.max(0, Math.floor(displayedElapsedMs / 1000));
  const elapsedDisplay = formatElapsed(elapsedSeconds);

  const processed = syncProgress?.counts?.processed;
  const total = syncProgress?.counts?.total;
  const hasDeterminate = typeof processed === "number" && typeof total === "number" && total > 0;
  const pctComplete = hasDeterminate ? Math.min(100, Math.round((processed! / total!) * 100)) : null;

  const phaseLabel = syncProgress ? PHASE_LABELS[syncProgress.phase] ?? syncProgress.phase : null;
  const needsAuthConnection = connections.find((c) => c.status === "needs_action");

  // Priority: Cancelling > Running > NoHealthySources > NeedsAuth > Failed > Hidden
  // (Cancelling must short-circuit Running because isSyncing is still true while
  // a cancel propagates.)
  if (isCancelingSync) {
    return (
      <div className="sync-banner sync-banner-cancelling" role="status" aria-live="polite">
        <div className="sync-banner-row">
          <span className="sync-banner-message">
            <span className="sync-banner-dot" aria-hidden="true" /> Cancelling sync…
          </span>
          <span className="sync-banner-action sync-banner-action-pending" aria-hidden="true">
            <span className="sync-banner-spinner" />
          </span>
        </div>
      </div>
    );
  }

  if (isSyncing) {
    return (
      <div className="sync-banner sync-banner-running" role="status" aria-live="polite">
        <div className="sync-banner-row">
          <span className="sync-banner-message">
            <span className="sync-banner-dot" aria-hidden="true" />
            Syncing your library{phaseLabel ? ` · ${phaseLabel}` : ""} · <span className="tabular">{elapsedDisplay}</span>
          </span>
          <span className="sync-banner-action">
            {hasDeterminate ? (
              <span className="tabular sync-banner-counts">
                {processed}/{total}
              </span>
            ) : null}
            <button
              type="button"
              className="sync-banner-action-button"
              onClick={onCancelSync}
              disabled={isCancelingSync}
            >
              Cancel
            </button>
          </span>
        </div>
        <div
          className={`sync-banner-progress ${hasDeterminate ? "sync-banner-progress-determinate" : "sync-banner-progress-indeterminate"}`}
          role="progressbar"
          aria-valuemin={hasDeterminate ? 0 : undefined}
          aria-valuemax={hasDeterminate ? 100 : undefined}
          aria-valuenow={hasDeterminate ? pctComplete ?? undefined : undefined}
        >
          {hasDeterminate ? (
            <span className="sync-banner-progress-fill" style={{ width: `${pctComplete}%` }} />
          ) : (
            <span className="sync-banner-progress-indeterminate-fill" aria-hidden="true" />
          )}
        </div>
      </div>
    );
  }

  if (noHealthySources) {
    return (
      <div className="sync-banner sync-banner-warning" role="status">
        <div className="sync-banner-row">
          <span className="sync-banner-message">
            No connected sources — set one up to start syncing
          </span>
          <button
            type="button"
            className="sync-banner-action-button"
            onClick={() => onNavigateToSettings("connections")}
          >
            Open Settings → Connections
          </button>
        </div>
      </div>
    );
  }

  if (needsAuthConnection) {
    return (
      <div className="sync-banner sync-banner-warning" role="status">
        <div className="sync-banner-row">
          <span className="sync-banner-message">
            ⚠ {needsAuthConnection.label} needs reconnect
          </span>
          <button
            type="button"
            className="sync-banner-action-button"
            onClick={() => onNavigateToSettings("connections")}
          >
            Fix → Settings · Connections
          </button>
        </div>
      </div>
    );
  }

  if (lastError) {
    return (
      <div className="sync-banner sync-banner-error" role="status">
        <div className="sync-banner-row">
          <span className="sync-banner-message">
            Last sync failed: {truncate(lastError, 80)}
          </span>
          <span className="sync-banner-action">
            <button type="button" className="sync-banner-action-button" onClick={onRetrySync}>
              Try again
            </button>
            <button
              type="button"
              className="sync-banner-action-button"
              onClick={() => onNavigateToSettings("logs")}
            >
              Details → Settings · Logs
            </button>
          </span>
        </div>
      </div>
    );
  }

  return null;
}
