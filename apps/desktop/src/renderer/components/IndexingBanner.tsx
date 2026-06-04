import { useState } from "react";
import { useIndexerStatus } from "../state/IndexerStatusContext";

export function IndexingBanner(): JSX.Element | null {
  const { status, start, starting } = useIndexerStatus();
  const [dismissed, setDismissed] = useState(false);

  if (!status || dismissed) return null;

  if (status.status === "unavailable") {
    return (
      <div className="indexing-banner indexing-banner--error" role="status">
        Semantic search is unavailable. Keyword search still works.
      </div>
    );
  }

  if (status.status === "idle" && status.indexed >= status.total) {
    return null;
  }

  if (status.status === "idle" && status.indexed < status.total) {
    const pending = status.total - status.indexed;
    return (
      <div className="indexing-banner" role="status">
        <span>{pending.toLocaleString()} highlights pending semantic indexing</span>
        <button type="button" className="indexing-banner__cta" onClick={() => void start()} disabled={starting}>
          {starting ? "Starting…" : "Start indexing"}
        </button>
        <button type="button" aria-label="Dismiss" onClick={() => setDismissed(true)}>✕</button>
      </div>
    );
  }

  return (
    <div className="indexing-banner" role="status">
      <span>
        Indexing {status.indexed.toLocaleString()} of {status.total.toLocaleString()} highlights…
      </span>
      <button type="button" aria-label="Dismiss" onClick={() => setDismissed(true)}>✕</button>
    </div>
  );
}
