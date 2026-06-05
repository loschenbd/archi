import { useEffect, useRef } from "react";
import type { SearchFilters } from "@archi/search";
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
    setFilters,
    clearFindSimilar,
    highlightCount,
    recentSearches,
    pushRecentSearch
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

  return (
    <section className="search-hero search-hero-resting">
      <p className="search-hero-tagline">{tagline}</p>

      <div className="search-hero-input-wrap">
        <span className="search-hero-icon" aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          type="search"
          className="search-hero-input"
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
          autoFocus
        />
        <span className="search-hero-kbd" aria-hidden="true">⌘K</span>
      </div>

      <div className="search-hero-chips">
        {SUGGESTED_CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            className="search-hero-chip"
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
    </section>
  );
}
