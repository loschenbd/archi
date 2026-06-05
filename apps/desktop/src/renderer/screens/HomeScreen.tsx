import { useDeferredValue, useMemo } from "react";
import { BooksRail } from "./home/BooksRail";
import { HomeSearchResults } from "./home/HomeSearchResults";
import { LatestHighlights } from "./home/LatestHighlights";
import { RandomHighlight } from "./home/RandomHighlight";
import { StatsStrip } from "./home/StatsStrip";
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
  workId?: string;
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
  onSyncNow: () => void;
  onCancelSync: () => void;
  onNavigateToSettings: (tab: "connections" | "logs") => void;
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
  bookCount: number;
  highlightCount: number;
  lastRunDeltaWorks: number;
  lastRunDeltaPassages: number;
  onOpenWork: (workId: string) => void;
  connections: SyncBannerConnection[];
  lastError: string | null;
  noHealthySources: boolean;
  homeSearchQuery: string;
};

export function HomeScreen({
  onSyncNow,
  onCancelSync,
  onNavigateToSettings,
  isSyncing,
  isCancelingSync,
  syncProgress,
  recentWorks,
  recentPassages,
  syncRunStartedAtIso,
  works,
  passages,
  bookCount,
  highlightCount,
  lastRunDeltaWorks,
  lastRunDeltaPassages,
  onOpenWork,
  connections,
  lastError,
  noHealthySources,
  homeSearchQuery
}: Props): JSX.Element {
  // useDeferredValue lets the input update at high priority while filtering /
  // rendering large result lists happens at lower priority — typing stays snappy
  // even when a broad query matches hundreds of passages.
  const liveTrimmedQuery = homeSearchQuery.trim();
  const trimmedQuery = useDeferredValue(liveTrimmedQuery);

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

      {trimmedQuery ? (
        <HomeSearchResults
          query={trimmedQuery}
          works={searchResults.works}
          passages={searchResults.passages}
          onOpenWork={onOpenWork}
        />
      ) : (
        <>
          <StatsStrip
            bookCount={bookCount}
            highlightCount={highlightCount}
            lastRunAtIso={syncRunStartedAtIso}
            lastRunDeltaWorks={lastRunDeltaWorks}
            lastRunDeltaPassages={lastRunDeltaPassages}
            isSyncing={isSyncing}
            hasUnhealthyBanner={lastError !== null || noHealthySources || connections.some((c) => c.status === "needs_action")}
            onSyncNow={onSyncNow}
          />

          <BooksRail
            works={recentWorks.slice(0, 12)}
            deltaCount={lastRunDeltaWorks}
            onOpenWork={onOpenWork}
          />

          <div className="highlights-split">
            <RandomHighlight
              passages={passages}
              onOpenWork={onOpenWork}
            />
            <LatestHighlights
              passages={recentPassages}
              deltaCount={lastRunDeltaPassages}
              onOpenWork={onOpenWork}
            />
          </div>
        </>
      )}
    </section>
  );
}
