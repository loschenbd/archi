import {
  Fragment,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";

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

type SearchWork = {
  id: string;
  title: string;
  creator?: string;
  coverImageUrl?: string;
};

type SearchPassage = {
  id: string;
  body: string;
  workId: string;
  workTitle: string;
};

type Props = {
  lastRunAt: string | null;
  onSyncNow: () => void;
  onCancelSync: () => void;
  onNavigateToConnections: () => void;
  needsAuth: boolean;
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
  works: SearchWork[];
  passages: SearchPassage[];
  onOpenWork: (workId: string) => void;
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

function highlightMatch(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={i}>{part}</mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}

function excerptAroundMatch(body: string, query: string, max = 180): string {
  const clean = body.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const idx = query ? clean.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (idx < 0) {
    return `${clean.slice(0, max - 1).trimEnd()}…`;
  }
  const half = Math.floor(max / 2);
  const start = Math.max(0, idx - half);
  const end = Math.min(clean.length, start + max);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < clean.length ? "…" : "";
  return `${prefix}${clean.slice(start, end).trim()}${suffix}`;
}

export function HomeScreen({
  lastRunAt,
  onSyncNow,
  onCancelSync,
  onNavigateToConnections,
  needsAuth,
  isSyncing,
  isCancelingSync,
  syncProgress,
  recentWorks,
  recentPassages,
  syncRunStartedAtIso,
  works,
  passages,
  onOpenWork
}: Props): JSX.Element {
  const [progressBaseAtMs, setProgressBaseAtMs] = useState<number>(Date.now());
  const [tickAtMs, setTickAtMs] = useState<number>(Date.now());
  const [searchQuery, setSearchQuery] = useState("");

  // useDeferredValue lets the input update at high priority while filtering /
  // rendering large result lists happens at lower priority — typing stays snappy
  // even when a broad query matches hundreds of passages.
  const liveTrimmedQuery = searchQuery.trim();
  const trimmedQuery = useDeferredValue(liveTrimmedQuery);
  const isSearchPending = liveTrimmedQuery !== trimmedQuery;

  const searchResults = useMemo(() => {
    if (!trimmedQuery) {
      return { works: [] as SearchWork[], passages: [] as SearchPassage[] };
    }
    const q = trimmedQuery.toLowerCase();
    const matchedWorks = works.filter((work) =>
      `${work.title} ${work.creator ?? ""}`.toLowerCase().includes(q)
    );
    const matchedPassages = passages.filter((passage) =>
      `${passage.workTitle} ${passage.body}`.toLowerCase().includes(q)
    );
    return { works: matchedWorks, passages: matchedPassages };
  }, [trimmedQuery, works, passages]);
  const hasSearchResults = searchResults.works.length > 0 || searchResults.passages.length > 0;

  const passagesScrollRef = useRef<HTMLDivElement>(null);
  const passagesVirtualizer = useVirtualizer({
    count: searchResults.passages.length,
    getScrollElement: () => passagesScrollRef.current,
    estimateSize: () => 110,
    overscan: 6,
    getItemKey: (index: number) => searchResults.passages[index]?.id ?? index
  });
  const passagesVirtualItems = passagesVirtualizer.getVirtualItems();

  // Reset scroll position when the query changes so users see top matches first.
  useEffect(() => {
    passagesScrollRef.current?.scrollTo({ top: 0 });
  }, [trimmedQuery]);

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

  const showActivityFeed = !trimmedQuery && (isSyncing || syncRunStartedAtIso !== null);
  const freshWorks = recentWorks.slice(0, 5);
  const freshPassages = recentPassages.slice(0, 5);

  return (
    <section className="home-screen">
      {isSyncing && syncProgress ? (
        <div className={`sync-live sync-live-header ${liveModeClass}`}>
          <div className="sync-live-head">
            <div className="sync-live-phase">
              <span className="live-dot" aria-hidden="true" />
              <div>
                {sourceLabel ? <p className="content-eyebrow">{sourceLabel}</p> : null}
                <h3>{phaseLabel}</h3>
              </div>
            </div>
            <div className="sync-live-head-actions">
              <p className="sync-live-elapsed" aria-label={`Elapsed ${elapsedSeconds} seconds`}>
                {elapsedDisplay}
              </p>
              <button
                type="button"
                className="sync-live-cancel-button"
                onClick={onCancelSync}
                disabled={isCancelingSync}
              >
                {isCancelingSync ? "Cancelling…" : "Cancel"}
              </button>
            </div>
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
      ) : null}

      {showActivityFeed ? (
        <div className={`activity-feed${isSyncing ? " activity-feed-live" : ""}`}>
          <details className="activity-column" open>
            <summary className="activity-column-head">
              <p className="content-eyebrow">New books{isSyncing ? "" : " · this run"}</p>
              <span className="activity-column-chevron" aria-hidden="true">▾</span>
            </summary>
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
          </details>

          <details className="activity-column" open>
            <summary className="activity-column-head">
              <p className="content-eyebrow">New highlights{isSyncing ? "" : " · this run"}</p>
              <span className="activity-column-chevron" aria-hidden="true">▾</span>
            </summary>
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
          </details>
        </div>
      ) : null}

      <div className="home-search home-search-hero">
        <div className={`home-search-input-wrap${isSearchPending ? " is-pending" : ""}`}>
          <input
            type="search"
            className="library-search-input home-search-input-large"
            placeholder="Search your library..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && searchQuery) {
                event.preventDefault();
                setSearchQuery("");
              }
            }}
            aria-label="Search your library"
            autoFocus
          />
          {searchQuery ? (
            <button
              type="button"
              className="home-search-clear"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              tabIndex={-1}
            >
              ×
            </button>
          ) : null}
        </div>
        {!isSyncing && !trimmedQuery ? (
          <div className="home-search-inline-action">
            {needsAuth ? (
              <button
                type="button"
                className="home-inline-link home-inline-link-accent"
                onClick={onNavigateToConnections}
              >
                Needs authentication · Reconnect →
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="home-inline-link"
                  onClick={onSyncNow}
                >
                  Sync now
                </button>
                {lastRunAt ? (
                  <span className="home-inline-meta">
                    <span aria-hidden="true"> · </span>
                    Last run {lastRunAt}
                  </span>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        {trimmedQuery && !hasSearchResults ? (
          <p className="home-search-empty">No results found.</p>
        ) : null}
        {trimmedQuery && hasSearchResults ? (
          <div className="home-search-results">
            <p className="home-search-count">
              {searchResults.works.length}{" "}
              {searchResults.works.length === 1 ? "book" : "books"}
              <span aria-hidden="true"> · </span>
              {searchResults.passages.length}{" "}
              {searchResults.passages.length === 1 ? "highlight" : "highlights"}
            </p>
            <div className="home-search-scroll">
              {searchResults.works.length > 0 ? (
                <div className="home-search-group">
                  <p className="content-eyebrow">Books</p>
                  <ul className="home-search-list">
                    {searchResults.works.map((work) => (
                      <li key={work.id}>
                        <button
                          type="button"
                          className="home-search-item home-search-item-work"
                          onClick={() => onOpenWork(work.id)}
                        >
                          <span className="activity-cover" aria-hidden="true">
                            {work.coverImageUrl ? (
                              <img src={work.coverImageUrl} alt="" loading="lazy" />
                            ) : (
                              <span className="activity-cover-letter">
                                {(work.title[0] ?? "?").toUpperCase()}
                              </span>
                            )}
                          </span>
                          <span className="home-search-item-body">
                            <span className="home-search-item-title">
                              {highlightMatch(work.title, trimmedQuery)}
                            </span>
                            {work.creator ? (
                              <span className="home-search-item-meta">
                                {highlightMatch(work.creator, trimmedQuery)}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {searchResults.passages.length > 0 ? (
                <div className="home-search-group">
                  <p className="content-eyebrow">Highlights</p>
                  <div ref={passagesScrollRef} className="home-search-passages-scroll">
                    <div
                      className="home-search-passages-inner"
                      style={{ height: `${passagesVirtualizer.getTotalSize()}px` }}
                    >
                      {passagesVirtualItems.map((virtualItem: VirtualItem) => {
                        const passage = searchResults.passages[virtualItem.index];
                        if (!passage) return null;
                        return (
                          <div
                            key={virtualItem.key}
                            data-index={virtualItem.index}
                            ref={passagesVirtualizer.measureElement}
                            className="home-search-passages-row"
                            style={{ transform: `translateY(${virtualItem.start}px)` }}
                          >
                            <button
                              type="button"
                              className="home-search-item home-search-item-passage"
                              onClick={() => onOpenWork(passage.workId)}
                            >
                              <span className="activity-quote-mark" aria-hidden="true">
                                &ldquo;
                              </span>
                              <span className="home-search-item-body">
                                <span className="home-search-item-quote">
                                  {highlightMatch(
                                    excerptAroundMatch(passage.body, trimmedQuery),
                                    trimmedQuery
                                  )}
                                </span>
                                <span className="home-search-item-meta">
                                  {highlightMatch(passage.workTitle, trimmedQuery)}
                                </span>
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

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
