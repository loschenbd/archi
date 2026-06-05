import { useCallback, useEffect, useState } from "react";
import type { SearchFilters, SearchResponse } from "@archi/search";
import { SearchFilterChips } from "../../components/SearchFilterChips";
import { SearchResultCard } from "../../components/SearchResultCard";
import { useSearchPreferences } from "../../state/SearchPreferencesContext";

type Props = {
  query: string;
  filters: SearchFilters;
  onFiltersChange: (next: SearchFilters) => void;
  onOpenWork: (workId: string, passageId: string) => void;
  onFindSimilar: (passage: { id: string; body: string }) => void;
};

export function HomeSearchResults({
  query,
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
    async (q: string, f: SearchFilters): Promise<void> => {
      setLoading(true);
      try {
        const mergedFilters: SearchFilters = {
          ...f,
          isArchived: prefs.includeArchived ? true : f.isArchived,
          isHidden: prefs.includeHidden ? true : f.isHidden
        };
        const res = await window.archi.search.query({ text: q, filters: mergedFilters, limit: 50 });
        setResponse(res);
      } finally {
        setLoading(false);
      }
    },
    [prefs.includeArchived, prefs.includeHidden]
  );

  useEffect(() => {
    const handle = setTimeout(() => {
      void runQuery(query, filters);
    }, 150);
    return () => clearTimeout(handle);
  }, [query, filters, runQuery]);

  const summary = response
    ? `Showing ${response.results.length} of ${response.totalCandidates} candidates (${response.durationMs} ms)`
    : "";

  const handleCopy = (body: string): void => {
    void navigator.clipboard.writeText(body);
  };

  return (
    <div className="home-search-results-v2">
      <SearchFilterChips filters={filters} onChange={onFiltersChange} />
      <div className="home-search-results-v2-summary">{loading ? "Searching…" : summary}</div>
      <div className="home-search-results-v2-list">
        {response?.results.map((r) => (
          <SearchResultCard
            key={r.passageId}
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
        ))}
        {response && response.results.length === 0 && !loading ? (
          <p className="home-search-empty">No matches.</p>
        ) : null}
      </div>
    </div>
  );
}
