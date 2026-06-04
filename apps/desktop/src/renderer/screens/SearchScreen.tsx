import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchFilters, SearchResponse } from "@archi/search";
import { SearchResultCard } from "../components/SearchResultCard";
import { SearchFilterChips } from "../components/SearchFilterChips";
import { IndexingBanner } from "../components/IndexingBanner";
import { useSearchPreferences } from "../state/SearchPreferencesContext";
import { useIndexerStatus } from "../state/IndexerStatusContext";

type Props = {
  initialQuery: string;
  pendingExpandPassageId: string | null;
  onOpenWork: (workId: string, passageId: string) => void;
  onOpenSearchScreen: (query: string) => void;
};

export function SearchScreen({
  initialQuery,
  pendingExpandPassageId,
  onOpenWork,
  onOpenSearchScreen
}: Props): JSX.Element {
  const prefs = useSearchPreferences();
  const { status: indexerStatus } = useIndexerStatus();
  const [text, setText] = useState(initialQuery);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});

  // Auto-grow the textarea so a long find-similar seed is fully visible.
  const resizeInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, []);
  useEffect(() => {
    resizeInput();
  }, [text, resizeInput]);

  // Focus input on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Sync controlled initialQuery prop.
  useEffect(() => {
    setText(initialQuery);
  }, [initialQuery]);

  // ⌘/ refocuses search input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (e.key === "Escape" && expandedId !== null) {
        setExpandedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedId]);

  const runQuery = useCallback(
    async (q: string, f: SearchFilters) => {
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

  // Debounced live query.
  useEffect(() => {
    const handle = setTimeout(() => {
      void runQuery(text, filters);
    }, 150);
    return () => clearTimeout(handle);
  }, [text, filters, runQuery]);

  // When pendingExpandPassageId arrives, expand that card and scroll to it.
  useEffect(() => {
    if (!pendingExpandPassageId) return;
    if (!response?.results.some((r) => r.passageId === pendingExpandPassageId)) return;
    setExpandedId(pendingExpandPassageId);
    const node = cardRefs.current[pendingExpandPassageId];
    if (node) {
      node.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [pendingExpandPassageId, response]);

  const summary = useMemo(() => {
    if (!response) return "";
    return `Showing ${response.results.length} of ${response.totalCandidates} candidates (${response.durationMs} ms)`;
  }, [response]);

  const hasQuery = text.trim().length > 0;
  const isEmpty = !hasQuery && !loading;
  const helperCorpusLabel =
    indexerStatus !== null ? `${indexerStatus.total.toLocaleString()} highlights` : "your highlights";

  const clearFilters = () => setFilters({});

  return (
    <section className="search-screen">
      <textarea
        ref={inputRef}
        className="search-screen__input"
        placeholder="Search highlights…"
        value={text}
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter alone shouldn't insert a newline — query auto-runs via debounce.
          // Shift+Enter still inserts a newline for users who genuinely want one.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            inputRef.current?.blur();
          }
        }}
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
              <div
                key={r.passageId}
                ref={(node) => {
                  cardRefs.current[r.passageId] = node;
                }}
              >
                <SearchResultCard
                  result={r}
                  showMatchSource={prefs.showMatchSource}
                  expanded={expandedId === r.passageId}
                  onToggle={() =>
                    setExpandedId((current) => (current === r.passageId ? null : r.passageId))
                  }
                  onOpenWork={onOpenWork}
                  onOpenSearchScreen={onOpenSearchScreen}
                />
              </div>
            ))}
            {response && response.results.length === 0 && !loading && (
              <div className="search-screen__empty">
                <p>No matches.</p>
                {Object.keys(filters).length > 0 && (
                  <button type="button" className="passage-card-action" onClick={clearFilters}>
                    Remove all filters
                  </button>
                )}
                {hasQuery && (
                  <button type="button" className="passage-card-action" onClick={() => setText("")}>
                    Clear query
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <IndexingBanner />
    </section>
  );
}
