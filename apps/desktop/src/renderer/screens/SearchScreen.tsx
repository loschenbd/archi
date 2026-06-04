import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchFilters, SearchResponse } from "@archi/search";
import { SearchResultCard } from "../components/SearchResultCard";
import { SearchFilterChips } from "../components/SearchFilterChips";
import { IndexingBanner } from "../components/IndexingBanner";

type Props = {
  initialQuery?: string;
  onOpenPassage: (passageId: string) => void;
  onOpenWork: (workId: string) => void;
  onFindSimilar: (passageBody: string) => void;
  showMatchSource?: boolean;
};

export function SearchScreen({
  initialQuery = "",
  onOpenPassage,
  onOpenWork,
  onFindSimilar,
  showMatchSource = true
}: Props) {
  const [text, setText] = useState(initialQuery);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [totalPassages, setTotalPassages] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load indexer status for the empty-state helper line.
  useEffect(() => {
    void (async () => {
      try {
        const status = await window.archi.search.indexerStatus();
        setTotalPassages(status.total);
      } catch {
        setTotalPassages(null);
      }
    })();
  }, []);

  const runQuery = useCallback(async (q: string, f: SearchFilters) => {
    setLoading(true);
    try {
      const res = await window.archi.search.query({ text: q, filters: f, limit: 50 });
      setResponse(res);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced live query.
  useEffect(() => {
    const handle = setTimeout(() => {
      void runQuery(text, filters);
    }, 150);
    return () => clearTimeout(handle);
  }, [text, filters, runQuery]);

  const summary = useMemo(() => {
    if (!response) return "";
    return `Showing ${response.results.length} of ${response.totalCandidates} candidates (${response.durationMs} ms)`;
  }, [response]);

  const hasQuery = text.trim().length > 0;
  const isEmpty = !hasQuery && !loading;
  const helperCorpusLabel =
    totalPassages !== null ? `${totalPassages.toLocaleString()} highlights` : "your highlights";

  return (
    <section className="search-screen">
      <input
        ref={inputRef}
        className="search-screen__input"
        type="search"
        placeholder="Search highlights…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Search highlights"
      />
      <SearchFilterChips filters={filters} onChange={setFilters} />
      <div className="search-screen__summary">{loading ? "Searching…" : summary}</div>
      <div className="search-screen__results">
        {isEmpty ? (
          <p className="search-screen__hint">
            Type to search {helperCorpusLabel} · <kbd>⌘K</kbd> from anywhere · click a book in
            Library to browse one.
          </p>
        ) : (
          <>
            {response?.results.map((r) => (
              <SearchResultCard
                key={r.passageId}
                result={r}
                showMatchSource={showMatchSource}
                expanded={false}
                onToggle={() => {}}
                onOpenWork={(workId) => onOpenWork(workId)}
                onOpenSearchScreen={onFindSimilar}
              />
            ))}
            {response && response.results.length === 0 && !loading && (
              <div className="search-screen__empty">
                No matches. Try fewer filters or different words.
              </div>
            )}
          </>
        )}
      </div>
      <IndexingBanner />
    </section>
  );
}
