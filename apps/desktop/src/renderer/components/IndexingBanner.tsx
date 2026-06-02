import { useEffect, useState } from "react";
import type { IndexerStatus } from "@archi/search";

type Props = {
  pollMs?: number;
};

export function IndexingBanner({ pollMs = 2000 }: Props) {
  const [status, setStatus] = useState<IndexerStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const next = await window.archi.search.indexerStatus();
        if (!alive) return;
        setStatus(next);
      } catch {
        /* ignore */
      } finally {
        if (alive) timer = setTimeout(poll, pollMs);
      }
    };
    poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [pollMs]);

  const start = async () => {
    setStarting(true);
    try {
      await window.archi.search.startIndexing();
    } finally {
      // Tick is fire-and-forget — status will move to "running" on the next poll.
      setStarting(false);
    }
  };

  if (!status || dismissed) return null;

  if (status.status === "unavailable") {
    return (
      <div className="indexing-banner indexing-banner--error" role="status">
        Semantic search is unavailable. Keyword search still works.
      </div>
    );
  }

  if (status.status === "idle" && status.indexed >= status.total) {
    // Fully indexed; nothing to show.
    return null;
  }

  if (status.status === "idle" && status.indexed < status.total) {
    // Pending work but indexer not running — show the start CTA.
    const pending = status.total - status.indexed;
    return (
      <div className="indexing-banner" role="status">
        <span>{pending.toLocaleString()} highlights pending semantic indexing</span>
        <button type="button" className="indexing-banner__cta" onClick={start} disabled={starting}>
          {starting ? "Starting…" : "Start indexing"}
        </button>
        <button type="button" aria-label="Dismiss" onClick={() => setDismissed(true)}>✕</button>
      </div>
    );
  }

  // Actively running.
  return (
    <div className="indexing-banner" role="status">
      <span>
        Indexing {status.indexed.toLocaleString()} of {status.total.toLocaleString()} highlights…
      </span>
      <button type="button" aria-label="Dismiss" onClick={() => setDismissed(true)}>✕</button>
    </div>
  );
}
