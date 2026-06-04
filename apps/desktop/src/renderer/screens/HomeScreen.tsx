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
import { SyncBanner, type SyncBannerConnection } from "./home/SyncBanner";

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
  onNavigateToSettings: (tab: "connections" | "logs") => void;
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
  connections: SyncBannerConnection[];
  lastError: string | null;
  noHealthySources: boolean;
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
  onNavigateToSettings,
  needsAuth,
  isSyncing,
  isCancelingSync,
  syncProgress,
  recentWorks,
  recentPassages,
  syncRunStartedAtIso,
  works,
  passages,
  onOpenWork,
  connections,
  lastError,
  noHealthySources
}: Props): JSX.Element {
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

  const showActivityFeed = !trimmedQuery && (isSyncing || syncRunStartedAtIso !== null);
  const freshWorks = recentWorks.slice(0, 5);
  const freshPassages = recentPassages.slice(0, 5);

  return (
    <section className="home-screen">
      <SyncBanner
        isSyncing={isSyncing}
        isCancelingSync={isCancelingSync}
        syncProgress={syncProgress}
        connections={connections}
        lastError={lastError}
        noHealthySources={noHealthySources}
        onCancelSync={onCancelSync}
        onRetrySync={onSyncNow}
        onNavigateToSettings={onNavigateToSettings}
      />

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
                onClick={() => onNavigateToSettings("connections")}
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

