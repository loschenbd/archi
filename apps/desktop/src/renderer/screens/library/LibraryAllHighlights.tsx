import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";

type Passage = {
  id: string;
  body: string;
  workId: string;
  workTitle: string;
};

type Props = {
  passages: Passage[];
  onOpenWork: (workId: string) => void;
};

function highlightMatches(text: string, query: string): ReactNode {
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

export function LibraryAllHighlights({ passages, onOpenWork }: Props): JSX.Element {
  const [query, setQuery] = useState("");
  const [workFilter, setWorkFilter] = useState("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const works = useMemo(
    () => Array.from(new Set(passages.map((passage) => passage.workTitle))).sort(),
    [passages]
  );
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return passages.filter((passage) => {
      const workMatches = workFilter === "all" || passage.workTitle === workFilter;
      const textMatches = !q || `${passage.workTitle} ${passage.body}`.toLowerCase().includes(q);
      return workMatches && textMatches;
    });
  }, [passages, query, workFilter]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 180,
    overscan: 6,
    getItemKey: (index: number) => filtered[index]?.id ?? index
  });

  // Reset scroll when the user changes filters. `passages` is intentionally
  // omitted: a background sync appending more rows shouldn't yank the user's
  // scroll back to the top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query, workFilter]);

  const copyPassage = async (passage: Passage): Promise<void> => {
    try {
      await navigator.clipboard.writeText(passage.body);
      setCopiedId(passage.id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === passage.id ? null : current));
      }, 1400);
    } catch {
      // Clipboard write can reject in unusual sandbox states; silently swallow rather than crash.
    }
  };

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <section className="passages-screen">
      <header className="screen-intro">
        <p>Search across every ingested highlight and filter by title.</p>
      </header>
      <div className="passages-filters">
        <input
          type="text"
          className="ui-input"
          placeholder="Search passages..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="ui-select"
          value={workFilter}
          onChange={(event) => setWorkFilter(event.target.value)}
        >
          <option value="all">All works</option>
          {works.map((work) => (
            <option key={work} value={work}>
              {work}
            </option>
          ))}
        </select>
      </div>
      <p className="screen-count">
        {filtered.length} {filtered.length === 1 ? "passage" : "passages"}
      </p>
      {filtered.length === 0 ? (
        <p>
          {passages.length === 0
            ? "No passages synced yet."
            : "No passages match your search."}
        </p>
      ) : (
        <div ref={scrollRef} className="passages-list-scroll">
          <div
            className="passages-list-inner"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualItem: VirtualItem) => {
              const passage = filtered[virtualItem.index];
              if (!passage) {
                return null;
              }
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="passages-list-row"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <article className="passage-card">
                    <span className="passage-card-mark" aria-hidden="true">
                      &ldquo;
                    </span>
                    <blockquote className="passage-card-body">
                      {highlightMatches(passage.body, query)}
                    </blockquote>
                    <footer className="passage-card-footer">
                      <p className="passage-card-attribution">
                        <span className="passage-card-dash" aria-hidden="true">
                          —
                        </span>
                        <span className="passage-card-title">{passage.workTitle}</span>
                      </p>
                      <div className="passage-card-actions">
                        <button
                          type="button"
                          className="passage-card-action"
                          onClick={() => onOpenWork(passage.workId)}
                          title="Open this book in Library"
                        >
                          <span className="passage-card-action-icon" aria-hidden="true">
                            ↗
                          </span>
                          Open book
                        </button>
                        <button
                          type="button"
                          className={`passage-card-action ${
                            copiedId === passage.id ? "passage-card-action-success" : ""
                          }`}
                          onClick={() => {
                            void copyPassage(passage);
                          }}
                          title="Copy quote to clipboard"
                        >
                          <span className="passage-card-action-icon" aria-hidden="true">
                            {copiedId === passage.id ? "✓" : "⎘"}
                          </span>
                          {copiedId === passage.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </footer>
                  </article>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
