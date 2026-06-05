import { useEffect, useRef, useState } from "react";
import { formatRelative } from "./utils";

type Props = {
  bookCount: number;
  highlightCount: number;
  lastRunAtIso: string | null;
  lastRunDeltaWorks: number;
  lastRunDeltaPassages: number;
  isSyncing: boolean;
  hasUnhealthyBanner: boolean;
  onSyncNow: () => void;
};

const NEW_CHIP_DURATION_MS = 10_000;

export function StatsStrip(props: Props): JSX.Element {
  const {
    bookCount,
    highlightCount,
    lastRunAtIso,
    lastRunDeltaWorks,
    lastRunDeltaPassages,
    isSyncing,
    hasUnhealthyBanner,
    onSyncNow
  } = props;

  const [tickAtMs, setTickAtMs] = useState<number>(Date.now());
  const [showNewChip, setShowNewChip] = useState<boolean>(false);
  const lastSeenRunAtRef = useRef<string | null>(lastRunAtIso);

  useEffect(() => {
    const interval = setInterval(() => setTickAtMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (lastRunAtIso && lastRunAtIso !== lastSeenRunAtRef.current) {
      lastSeenRunAtRef.current = lastRunAtIso;
      if (lastRunDeltaWorks > 0 || lastRunDeltaPassages > 0) {
        setShowNewChip(true);
        const timer = setTimeout(() => setShowNewChip(false), NEW_CHIP_DURATION_MS);
        return () => clearTimeout(timer);
      }
    }
    return undefined;
  }, [lastRunAtIso, lastRunDeltaWorks, lastRunDeltaPassages]);

  const relativeLastRun = lastRunAtIso ? formatRelative(lastRunAtIso, tickAtMs) : null;

  return (
    <div className="stats-strip">
      <div className="stats-strip-counts">
        <span className="stats-strip-number tabular">{bookCount.toLocaleString()}</span>
        <span className="stats-strip-label">books</span>
        <span className="stats-strip-dot" aria-hidden="true">·</span>
        <span className="stats-strip-number tabular">{highlightCount.toLocaleString()}</span>
        <span className="stats-strip-label">highlights</span>
      </div>

      <div className="stats-strip-meta">
        {isSyncing ? (
          <span className="stats-strip-meta-text">Syncing now…</span>
        ) : hasUnhealthyBanner ? null : showNewChip ? (
          <span className="stats-strip-new-chip">
            +{lastRunDeltaWorks} new books · +{lastRunDeltaPassages} new highlights
          </span>
        ) : (
          <>
            {relativeLastRun ? (
              <span className="stats-strip-meta-text">synced {relativeLastRun}</span>
            ) : (
              <span className="stats-strip-meta-text">never synced</span>
            )}
            <span aria-hidden="true">·</span>
            <button
              type="button"
              className="stats-strip-sync-button"
              onClick={onSyncNow}
              disabled={isSyncing}
            >
              Sync now
            </button>
          </>
        )}
      </div>
    </div>
  );
}
