import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import type { SearchFilters, SearchResponse } from "@archi/search";
import { SearchFilterChips } from "../../components/SearchFilterChips";
import { SearchResultCard } from "../../components/SearchResultCard";
import { useSearchPreferences } from "../../state/SearchPreferencesContext";

type Props = {
  query: string;
  /**
   * When set, the IPC call asks the search service to find vector-only
   * neighbors of this passage instead of using `query` as the text input.
   * The component's debounce re-fires whenever this id changes.
   */
  findSimilarPassageId: string | null;
  filters: SearchFilters;
  onFiltersChange: (next: SearchFilters) => void;
  onOpenWork: (workId: string, passageId: string) => void;
  onFindSimilar: (passage: { id: string; body: string }) => void;
};

function formatMatchSourceCounts(
  results: { matchedVia: "vector" | "fts5" | "both" }[]
): string {
  const keyword = results.filter((r) => r.matchedVia === "fts5").length;
  const vector = results.filter((r) => r.matchedVia === "vector").length;
  const both = results.filter((r) => r.matchedVia === "both").length;
  return `${keyword} keyword · ${vector} vector · ${both} combined`;
}

export function HomeSearchResults({
  query,
  findSimilarPassageId,
  filters,
  onFiltersChange,
  onOpenWork,
  onFindSimilar
}: Props): JSX.Element {
  const prefs = useSearchPreferences();
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const runQuery = useCallback(
    async (q: string, f: SearchFilters, similarToId: string | null): Promise<void> => {
      setLoading(true);
      try {
        const mergedFilters: SearchFilters = {
          ...f,
          isArchived: prefs.includeArchived ? true : f.isArchived,
          isHidden: prefs.includeHidden ? true : f.isHidden
        };
        const res = await window.archi.search.query({
          text: q,
          filters: mergedFilters,
          limit: 50,
          findSimilarPassageId: similarToId ?? undefined
        });
        setResponse(res);
      } finally {
        setLoading(false);
      }
    },
    [prefs.includeArchived, prefs.includeHidden]
  );

  useEffect(() => {
    const handle = setTimeout(() => {
      void runQuery(query, filters, findSimilarPassageId);
    }, 150);
    return () => clearTimeout(handle);
  }, [query, filters, findSimilarPassageId, runQuery]);

  const summary = response
    ? prefs.showMatchSource
      ? formatMatchSourceCounts(response.results)
      : `${response.results.length} ${response.results.length === 1 ? "result" : "results"}`
    : "";

  const handleCopy = (body: string): void => {
    void navigator.clipboard.writeText(body);
  };

  const results = response?.results ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => scrollRef.current,
    // Initial guess for a collapsed card; measureElement refines on render
    // and re-measures when expandedId toggles a row's height.
    estimateSize: () => 180,
    overscan: 4,
    getItemKey: (index: number) => results[index]?.passageId ?? index
  });

  // Reset scroll to top whenever the input query or find-similar sentinel
  // changes so the user always sees the new top result first.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query, findSimilarPassageId]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="home-search-results-v2">
      <SearchFilterChips filters={filters} onChange={onFiltersChange} />
      <div className="home-search-results-v2-summary">{loading ? "Searching…" : summary}</div>
      {response && results.length === 0 && !loading ? (
        <p className="home-search-empty">No matches.</p>
      ) : (
        <div ref={scrollRef} className="home-search-results-v2-list">
          <div
            className="home-search-results-v2-list-inner"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualItem: VirtualItem) => {
              const r = results[virtualItem.index];
              if (!r) {
                return null;
              }
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="home-search-results-v2-row"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <SearchResultCard
                    result={r}
                    showMatchSource={prefs.showMatchSource}
                    expanded={expandedId === r.passageId}
                    onToggle={() =>
                      setExpandedId((current) => (current === r.passageId ? null : r.passageId))
                    }
                    onOpenWork={(workId) => onOpenWork(workId, r.passageId)}
                    onCopy={() => handleCopy(r.body)}
                    onFindSimilar={() => onFindSimilar({ id: r.passageId, body: r.body })}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
