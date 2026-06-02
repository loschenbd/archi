import { useEffect, useState } from "react";
import type { IndexerStatus } from "@archi/search";

type Props = {
  pollMs?: number;
};

export function IndexingBanner({ pollMs = 2000 }: Props) {
  const [status, setStatus] = useState<IndexerStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

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

  if (!status || dismissed) return null;
  if (status.status === "idle" && status.indexed >= status.total) return null;
  if (status.status === "unavailable") {
    return (
      <div className="indexing-banner indexing-banner--error" role="status">
        Semantic search is unavailable. Keyword search still works.
      </div>
    );
  }

  return (
    <div className="indexing-banner" role="status">
      <span>Indexing {status.indexed} of {status.total} highlights…</span>
      <button type="button" aria-label="Dismiss" onClick={() => setDismissed(true)}>✕</button>
    </div>
  );
}
