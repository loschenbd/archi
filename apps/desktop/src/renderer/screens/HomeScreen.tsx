import { useEffect, useMemo, useState } from "react";

type RecentWork = {
  id: string;
  title: string;
  creator?: string;
  coverImageUrl?: string;
  ingestedAt: string;
};

type RecentPassage = {
  id: string;
  body: string;
  workTitle: string;
  ingestedAt: string;
};

type Props = {
  status: string;
  lastRunAt: string | null;
  onSyncNow: () => void;
  onCancelSync: () => void;
  onNavigateToConnections: () => void;
  isSyncing: boolean;
  isCancelingSync: boolean;
  syncProgress: {
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
  recentWorks: RecentWork[];
  recentPassages: RecentPassage[];
  syncRunStartedAtIso: string | null;
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

const SOURCE_LABELS: Record<string, string> = {
  "cloud-notebook": "Cloud notebook",
  "device-export": "Device export",
  notion: "Notion"
};

const STATUS_LABELS: Record<string, string> = {
  idle: "Idle",
  running: "Running",
  success: "Last run succeeded",
  failed: "Last run failed",
  needs_auth: "Needs authentication",
  partial_success: "Partial success",
  cancelled: "Last run cancelled"
};

export function HomeScreen({
  status,
  lastRunAt,
  onSyncNow,
  onCancelSync,
  onNavigateToConnections,
  isSyncing,
  isCancelingSync,
  syncProgress,
  recentWorks,
  recentPassages,
  syncRunStartedAtIso
}: Props): JSX.Element {
  const [progressBaseAtMs, setProgressBaseAtMs] = useState<number>(Date.now());
  const [tickAtMs, setTickAtMs] = useState<number>(Date.now());

  useEffect(() => {
    if (!syncProgress) {
      return;
    }
    setProgressBaseAtMs(Date.now());
    setTickAtMs(Date.now());
  }, [syncProgress]);

  useEffect(() => {
    const activeIntervalMs = isSyncing && syncProgress?.status === "running" ? 1000 : 15000;
    const interval = setInterval(() => {
      setTickAtMs(Date.now());
    }, activeIntervalMs);
    return () => {
      clearInterval(interval);
    };
  }, [isSyncing, syncProgress]);

  const displayedElapsedMs = useMemo(() => {
    if (!syncProgress) {
      return 0;
    }
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
  const booksCount = syncProgress?.counts?.works;
  const quotesCount = syncProgress?.counts?.passages;

  const phaseLabel = syncProgress ? PHASE_LABELS[syncProgress.phase] ?? syncProgress.phase : null;
  const sourceLabel = syncProgress?.source ? SOURCE_LABELS[syncProgress.source] ?? syncProgress.source : null;

  const liveModeClass = isCancelingSync ? "sync-live-cancelling" : "sync-live-running";
  const statusLabel = STATUS_LABELS[status] ?? status;
  const headerSubtitle = isSyncing
    ? isCancelingSync
      ? "Wrapping up the current step, then stopping."
      : "Working in the background — keep using the app."
    : "Ready to run a fresh sync.";

  return (
    <section className="home-screen">
      <header className="home-header">
        <h2>Sync Status</h2>
        <p>{headerSubtitle}</p>
      </header>

      {isSyncing && syncProgress ? (
        <div className={`sync-live ${liveModeClass}`}>
          <div className="sync-live-head">
            <div className="sync-live-phase">
              <span className="live-dot" aria-hidden="true" />
              <div>
                {sourceLabel ? <p className="content-eyebrow">{sourceLabel}</p> : null}
                <h3>{phaseLabel}</h3>
              </div>
            </div>
            <p className="sync-live-elapsed" aria-label={`Elapsed ${elapsedSeconds} seconds`}>
              {elapsedDisplay}
            </p>
          </div>

          <div
            className={`progress-bar ${hasDeterminate ? "progress-bar-determinate" : "progress-bar-indeterminate"}`}
            role="progressbar"
            aria-valuemin={hasDeterminate ? 0 : undefined}
            aria-valuemax={hasDeterminate ? 100 : undefined}
            aria-valuenow={hasDeterminate ? pctComplete ?? undefined : undefined}
          >
            {hasDeterminate ? (
              <span className="progress-bar-fill" style={{ width: `${pctComplete}%` }}>
                <span className="progress-bar-shimmer" aria-hidden="true" />
              </span>
            ) : (
              <span className="progress-bar-indeterminate-fill" aria-hidden="true" />
            )}
          </div>

          {hasDeterminate ? (
            <p className="progress-bar-label">
              <span className="tabular">{processed}</span> of <span className="tabular">{total}</span>
              <span aria-hidden="true"> · </span>
              <span className="tabular">{pctComplete}%</span>
            </p>
          ) : (
            <p className="progress-bar-label progress-bar-label-pending">Discovering work, totals not known yet…</p>
          )}

          {booksCount !== undefined || quotesCount !== undefined ? (
            <dl className="sync-stats">
              {booksCount !== undefined ? (
                <div className="sync-stat">
                  <dt>Books</dt>
                  <dd className="tabular">{booksCount.toLocaleString()}</dd>
                </div>
              ) : null}
              {quotesCount !== undefined ? (
                <div className="sync-stat">
                  <dt>Quotes</dt>
                  <dd className="tabular">{quotesCount.toLocaleString()}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      ) : (
        <div className="home-metadata">
          {status === "needs_auth" ? (
            <button
              type="button"
              className="home-metadata-action"
              onClick={onNavigateToConnections}
              aria-label="Reconnect — opens the Connections page"
            >
              <strong>Status:</strong> {statusLabel}
              <span className="home-metadata-action-hint" aria-hidden="true">
                Reconnect →
              </span>
            </button>
          ) : (
            <p>
              <strong>Status:</strong> {statusLabel}
            </p>
          )}
          <p>
            <strong>Last run:</strong> {lastRunAt ?? "Never"}
          </p>
        </div>
      )}

      <div className="home-actions">
        <button className="button-primary" onClick={onSyncNow} disabled={isSyncing}>
          {isSyncing ? (
            <span className="button-busy">
              <span className="progress-spinner" aria-hidden="true" />
              Syncing
            </span>
          ) : (
            "Sync now"
          )}
        </button>
        {isSyncing ? (
          <button className="button-ghost" onClick={onCancelSync} disabled={isCancelingSync}>
            {isCancelingSync ? "Cancelling…" : "Cancel sync"}
          </button>
        ) : null}
      </div>

      {(() => {
        if (syncRunStartedAtIso === null && !isSyncing) {
          return null;
        }
        // Main returns only items touched during this run once a sync has started, so we
        // don't filter by timestamp here — `first_ingested_at` doesn't update on re-upsert.
        const freshWorks = recentWorks.slice(0, 5);
        const freshPassages = recentPassages.slice(0, 5);
        const feedClass = `activity-feed${isSyncing ? " activity-feed-live" : ""}`;
        return (
          <div className={feedClass}>
            <div className="activity-column">
              <header className="activity-column-head">
                <p className="content-eyebrow">New books{isSyncing ? "" : " · this run"}</p>
              </header>
              {freshWorks.length === 0 ? (
                <p className="activity-empty">
                  {isSyncing ? "Waiting for the first book of this run…" : "No new books from the last run."}
                </p>
              ) : (
                <ul className="activity-list">
                  {freshWorks.map((work, index) => (
                    <li
                      key={work.id}
                      className="activity-item activity-item-work"
                      style={{ animationDelay: `${Math.min(index, 4) * 35}ms` }}
                    >
                      <span className="activity-cover" aria-hidden="true">
                        {work.coverImageUrl ? (
                          <img src={work.coverImageUrl} alt="" loading="lazy" />
                        ) : (
                          <span className="activity-cover-letter">{(work.title[0] ?? "?").toUpperCase()}</span>
                        )}
                      </span>
                      <div className="activity-body">
                        <p className="activity-title">{work.title}</p>
                        {work.creator ? <p className="activity-meta">{work.creator}</p> : null}
                        <p className="activity-meta activity-meta-soft tabular">
                          {formatRelative(work.ingestedAt, tickAtMs)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="activity-column">
              <header className="activity-column-head">
                <p className="content-eyebrow">New highlights{isSyncing ? "" : " · this run"}</p>
              </header>
              {freshPassages.length === 0 ? (
                <p className="activity-empty">
                  {isSyncing ? "Waiting for the first highlight of this run…" : "No new highlights from the last run."}
                </p>
              ) : (
                <ul className="activity-list">
                  {freshPassages.map((passage, index) => (
                    <li
                      key={passage.id}
                      className="activity-item activity-item-passage"
                      style={{ animationDelay: `${Math.min(index, 4) * 35}ms` }}
                    >
                      <span className="activity-quote-mark" aria-hidden="true">
                        &ldquo;
                      </span>
                      <div className="activity-body">
                        <p className="activity-quote">{excerptOf(passage.body, 160)}</p>
                        <p className="activity-meta">
                          <span className="activity-attribution">{passage.workTitle}</span>
                          <span aria-hidden="true"> · </span>
                          <span className="activity-meta-soft tabular">
                            {formatRelative(passage.ingestedAt, tickAtMs)}
                          </span>
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })()}
    </section>
  );
}

function excerptOf(body: string, max: number): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function formatRelative(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    return "";
  }
  const diff = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${String(remaining).padStart(2, "0")}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${String(remMinutes).padStart(2, "0")}m`;
}
