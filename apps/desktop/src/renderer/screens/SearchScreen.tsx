import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchFilters, SearchResponse } from "@archi/search";
import { SearchResultCard } from "../components/SearchResultCard";
import { SearchFilterChips } from "../components/SearchFilterChips";
import { IndexingBanner } from "../components/IndexingBanner";

type Props = {
  initialQuery?: string;
  onOpenPassage: (passageId: string) => void;
  showMatchSource?: boolean;
};

export function SearchScreen({ initialQuery = "", onOpenPassage, showMatchSource = true }: Props) {
  const [text, setText] = useState(initialQuery);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [availableCreators, setAvailableCreators] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount.
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Load available creators once for the filter dropdown.
  useEffect(() => {
    void (async () => {
      const browseRes = await window.archi.search.query({ text: "", filters: {}, limit: 200 });
      const unique = Array.from(new Set(
        browseRes.results.map((r) => r.work.creator).filter((c): c is string => Boolean(c))
      )).sort();
      setAvailableCreators(unique);
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
    const handle = setTimeout(() => { void runQuery(text, filters); }, 150);
    return () => clearTimeout(handle);
  }, [text, filters, runQuery]);

  const summary = useMemo(() => {
    if (!response) return "";
    return `Showing ${response.results.length} of ${response.totalCandidates} candidates (${response.durationMs} ms)`;
  }, [response]);

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
      <SearchFilterChips filters={filters} onChange={setFilters} availableCreators={availableCreators} />
      <div className="search-screen__summary">{loading ? "Searching…" : summary}</div>
      <div className="search-screen__results">
        {response?.results.map((r) => (
          <SearchResultCard
            key={r.passageId}
            result={r}
            showMatchSource={showMatchSource}
            onOpen={onOpenPassage}
          />
        ))}
        {response && response.results.length === 0 && !loading && (
          <div className="search-screen__empty">
            No matches. Try fewer filters or different words.
          </div>
        )}
      </div>
      <IndexingBanner />
    </section>
  );
}
