import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchFilters, SearchResponse } from "@archi/search";
import { SearchFilterChips } from "../../components/SearchFilterChips";
import { SearchResultCard } from "../../components/SearchResultCard";
import { useSearchPreferences } from "../../state/SearchPreferencesContext";
import { useIndexerStatus } from "../../state/IndexerStatusContext";

type SuggestedChip = {
  label: string;
  apply: (state: { setQuery: (q: string) => void; setFilters: (f: SearchFilters) => void }) => void;
};

function thirtyDaysAgoIso(): string {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

const SUGGESTED_CHIPS: SuggestedChip[] = [
  {
    label: "books on creativity",
    apply: ({ setQuery }) => setQuery("books on creativity")
  },
  {
    label: "quotes about discipline",
    apply: ({ setQuery }) => setQuery("quotes about discipline")
  },
  {
    label: "from last month",
    apply: ({ setQuery, setFilters }) => {
      setQuery("");
      setFilters({ markedAfter: thirtyDaysAgoIso() });
    }
  },
  {
    label: "starred only",
    apply: ({ setQuery, setFilters }) => {
      setQuery("");
      setFilters({ isStarred: true });
    }
  }
];

type Props = {
  query: string;
  setQuery: (q: string) => void;
  filters: SearchFilters;
  setFilters: (f: SearchFilters) => void;
  findSimilarPassageId: string | null;
  findSimilarPassage: { id: string; body: string } | null;
  clearFindSimilar: () => void;
  highlightCount: number;
  recentSearches: string[];
  pushRecentSearch: (q: string) => void;
  onOpenWork: (workId: string, passageId?: string) => void;
  onFindSimilar: (passage: { id: string; body: string }) => void;
};

export function SearchHero(props: Props): JSX.Element {
  const {
    query,
    setQuery,
    filters,
    setFilters,
    findSimilarPassageId,
    findSimilarPassage,
    clearFindSimilar,
    highlightCount,
    recentSearches,
    pushRecentSearch,
    onOpenWork,
    onFindSimilar
  } = props;

  const inputRef = useRef<HTMLInputElement>(null);
  const indexerStatus = useIndexerStatus();
  const indexerWrapper = indexerStatus.status;
  const isIndexing = indexerWrapper?.status === "running";
  const indexedCount = indexerWrapper?.indexed ?? 0;
  const totalToIndex = indexerWrapper?.total ?? 0;

  // Cmd+K / Ctrl+K refocuses the input. Scope is implicitly Home because SearchHero only mounts there.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tagline = isIndexing && totalToIndex > 0
    ? `Ask anything across ${indexedCount.toLocaleString()} of ${totalToIndex.toLocaleString()} indexed highlights`
    : `Ask anything across ${highlightCount.toLocaleString()} highlights`;

  const prefs = useSearchPreferences();
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const isActive = query.trim().length > 0 || findSimilarPassageId !== null;

  const runQuery = useCallback(
    async (q: string, f: SearchFilters, similarToId: string | null) => {
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
        if (res.results.length > 0 && q.trim().length > 0 && !similarToId) {
          pushRecentSearch(q);
        }
      } finally {
        setLoading(false);
      }
    },
    [prefs.includeArchived, prefs.includeHidden, pushRecentSearch]
  );

  useEffect(() => {
    if (!isActive) {
      setResponse(null);
      setExpandedId(null);
      return;
    }
    const handle = setTimeout(() => {
      void runQuery(query, filters, findSimilarPassageId);
    }, 150);
    return () => clearTimeout(handle);
  }, [query, filters, findSimilarPassageId, isActive, runQuery]);

  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    sectionRef.current?.closest(".content")?.scrollTo({ top: 0 });
  }, [query, findSimilarPassageId]);

  const handleCopy = (body: string): void => {
    void navigator.clipboard.writeText(body);
  };

  const summary = (() => {
    if (!response) return "";
    if (prefs.showMatchSource) {
      const keyword = response.results.filter((r) => r.matchedVia === "fts5").length;
      const vector = response.results.filter((r) => r.matchedVia === "vector").length;
      const both = response.results.filter((r) => r.matchedVia === "both").length;
      return `${keyword} keyword · ${vector} vector · ${both} combined`;
    }
    return `${response.results.length} ${response.results.length === 1 ? "result" : "results"}`;
  })();

  const truncatedSimilarSeed = findSimilarPassage
    ? findSimilarPassage.body.length > 40
      ? `${findSimilarPassage.body.slice(0, 40)}…`
      : findSimilarPassage.body
    : null;

  return (
    <section ref={sectionRef} className={`search-hero ${isActive ? "search-hero-active" : "search-hero-resting"}`}>
      {!isActive ? <p className="search-hero-tagline">{tagline}</p> : null}

      {findSimilarPassage ? (
        <div className="search-hero-sentinel">
          <span className="search-hero-icon" aria-hidden="true">⌕</span>
          <span className="search-hero-sentinel-text">
            Similar to "{truncatedSimilarSeed}"
          </span>
          <button
            type="button"
            className="search-hero-sentinel-clear"
            onClick={clearFindSimilar}
            aria-label="Clear find similar"
          >
            ×
          </button>
        </div>
      ) : (
        <div className="search-hero-input-wrap" style={{ border: 0, background: "transparent" }}>
          <span className="search-hero-icon" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            type="search"
            className="ui-input ui-input--lg"
            placeholder="What do you want to find?"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
            aria-label="Search your library"
          />
          {query ? (
            <button
              type="button"
              className="search-hero-clear"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              tabIndex={-1}
            >
              ×
            </button>
          ) : (
            <span className="search-hero-kbd" aria-hidden="true">⌘K</span>
          )}
        </div>
      )}

      {!isActive ? (
        <>
          <div className="search-hero-chips">
            {SUGGESTED_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                className="ui-chip"
                onClick={() => {
                  clearFindSimilar();
                  chip.apply({ setQuery, setFilters });
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {recentSearches.length > 0 ? (
            <p className="search-hero-recents">
              Recent:{" "}
              {recentSearches.map((entry, index) => (
                <span key={entry}>
                  {index > 0 ? <span aria-hidden="true"> · </span> : null}
                  <button
                    type="button"
                    className="search-hero-recents-link"
                    onClick={() => {
                      clearFindSimilar();
                      setQuery(entry);
                      pushRecentSearch(entry);
                    }}
                  >
                    {entry}
                  </button>
                </span>
              ))}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <div className="search-hero-filter-chips-wrap">
            <SearchFilterChips filters={filters} onChange={setFilters} />
          </div>

          <p className={`search-hero-count ${loading ? "search-hero-count-loading" : ""}`}>
            {loading ? "Searching…" : summary}
          </p>

          {(isIndexing || (totalToIndex > 0 && indexedCount < totalToIndex)) && response && response.results.length > 0 ? (
            <p className="search-hero-partial" role="status">
              Results may be partial — {indexedCount.toLocaleString()} / {totalToIndex.toLocaleString()} indexed
            </p>
          ) : null}

          {response && response.results.length === 0 && !loading ? (
            <div className="search-hero-empty">
              <p>No matches.</p>
              <button
                type="button"
                className="search-hero-empty-clear"
                onClick={() => {
                  if (findSimilarPassage) {
                    clearFindSimilar();
                  } else {
                    setQuery("");
                  }
                }}
              >
                Clear query
              </button>
            </div>
          ) : (
            <div className="search-hero-results">
              {response?.results.map((r) => (
                <div key={r.passageId} className="search-hero-results-row">
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
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
