import type { SearchFilters } from "@archi/search";
import { BooksRail } from "./home/BooksRail";
import { LatestHighlights } from "./home/LatestHighlights";
import { RandomHighlight } from "./home/RandomHighlight";
import { SearchHero } from "./home/SearchHero";
import { StatsStrip } from "./home/StatsStrip";
import { SyncBanner, type SyncBannerConnection } from "./home/SyncBanner";
import { hasNonDefaultFilters } from "./home/utils";

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
  lastRunAtIso: string | null;
  passages: SearchPassage[];
  bookCount: number;
  highlightCount: number;
  lastRunDeltaWorks: number;
  lastRunDeltaPassages: number;
  onOpenWork: (workId: string, passageId?: string) => void;
  connections: SyncBannerConnection[];
  lastError: string | null;
  noHealthySources: boolean;
  effectiveSearchQuery: string;
  findSimilarPassageId: string | null;
  findSimilarPassage: { id: string; body: string } | null;
  homeSearchFilters: SearchFilters;
  onFiltersChange: (next: SearchFilters) => void;
  onFindSimilar: (passage: { id: string; body: string }) => void;
  recentSearches: string[];
  pushRecentSearch: (q: string) => void;
  onSearchQueryChange: (q: string) => void;
  onClearFindSimilar: () => void;
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
  lastRunAtIso,
  passages,
  bookCount,
  highlightCount,
  lastRunDeltaWorks,
  lastRunDeltaPassages,
  onOpenWork,
  connections,
  lastError,
  noHealthySources,
  effectiveSearchQuery,
  findSimilarPassageId,
  findSimilarPassage,
  homeSearchFilters,
  onFiltersChange,
  onFindSimilar,
  recentSearches,
  pushRecentSearch,
  onSearchQueryChange,
  onClearFindSimilar
}: Props): JSX.Element {
  const trimmedQuery = effectiveSearchQuery.trim();
  const searchActive =
    trimmedQuery.length > 0 ||
    findSimilarPassageId !== null ||
    hasNonDefaultFilters(homeSearchFilters);

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

      <SearchHero
        query={effectiveSearchQuery}
        setQuery={onSearchQueryChange}
        filters={homeSearchFilters}
        setFilters={onFiltersChange}
        findSimilarPassageId={findSimilarPassageId}
        findSimilarPassage={findSimilarPassage}
        clearFindSimilar={onClearFindSimilar}
        highlightCount={highlightCount}
        recentSearches={recentSearches}
        pushRecentSearch={pushRecentSearch}
        onOpenWork={onOpenWork}
        onFindSimilar={onFindSimilar}
      />

      {!searchActive ? (
        <>
          <StatsStrip
            bookCount={bookCount}
            highlightCount={highlightCount}
            lastRunAtIso={lastRunAtIso}
            lastRunDeltaWorks={lastRunDeltaWorks}
            lastRunDeltaPassages={lastRunDeltaPassages}
            isSyncing={isSyncing}
            hasUnhealthyBanner={lastError !== null || noHealthySources || connections.some((c) => c.status === "needs_action")}
            onSyncNow={onSyncNow}
          />

          <BooksRail
            works={recentWorks.slice(0, 12)}
            deltaCount={lastRunDeltaWorks}
            onOpenWork={(workId) => onOpenWork(workId)}
          />

          <div className="highlights-split">
            <RandomHighlight
              passages={passages}
              onOpenWork={(workId) => onOpenWork(workId)}
            />
            <LatestHighlights
              passages={recentPassages}
              deltaCount={lastRunDeltaPassages}
              onOpenWork={(workId) => onOpenWork(workId)}
            />
          </div>
        </>
      ) : null}
    </section>
  );
}
