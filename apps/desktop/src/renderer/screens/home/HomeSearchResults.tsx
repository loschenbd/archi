import { useEffect, useRef } from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { highlightMatch, excerptAroundMatch } from "./utils";

type Work = {
  id: string;
  title: string;
  creator?: string;
  coverImageUrl?: string;
};

type Passage = {
  id: string;
  body: string;
  workId: string;
  workTitle: string;
};

type Props = {
  query: string;
  works: Work[];
  passages: Passage[];
  onOpenWork: (workId: string) => void;
};

export function HomeSearchResults({ query, works, passages, onOpenWork }: Props): JSX.Element {
  const passagesScrollRef = useRef<HTMLDivElement>(null);
  const passagesVirtualizer = useVirtualizer({
    count: passages.length,
    getScrollElement: () => passagesScrollRef.current,
    estimateSize: () => 110,
    overscan: 6,
    getItemKey: (index: number) => passages[index]?.id ?? index
  });
  const passagesVirtualItems = passagesVirtualizer.getVirtualItems();

  useEffect(() => {
    passagesScrollRef.current?.scrollTo({ top: 0 });
  }, [query]);

  const hasResults = works.length > 0 || passages.length > 0;

  if (!hasResults) {
    return <p className="home-search-empty">No results found.</p>;
  }

  return (
    <div className="home-search-results">
      <p className="home-search-count">
        {works.length} {works.length === 1 ? "book" : "books"}
        <span aria-hidden="true"> · </span>
        {passages.length} {passages.length === 1 ? "highlight" : "highlights"}
      </p>
      <div className="home-search-scroll">
        {works.length > 0 ? (
          <div className="home-search-group">
            <p className="content-eyebrow">Books</p>
            <ul className="home-search-list">
              {works.map((work) => (
                <li key={work.id}>
                  <button
                    type="button"
                    className="home-search-item home-search-item-work"
                    onClick={() => onOpenWork(work.id)}
                  >
                    <span className="activity-cover" aria-hidden="true">
                      {work.coverImageUrl ? (
                        <img src={work.coverImageUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="activity-cover-letter">
                          {(work.title[0] ?? "?").toUpperCase()}
                        </span>
                      )}
                    </span>
                    <span className="home-search-item-body">
                      <span className="home-search-item-title">
                        {highlightMatch(work.title, query)}
                      </span>
                      {work.creator ? (
                        <span className="home-search-item-meta">
                          {highlightMatch(work.creator, query)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {passages.length > 0 ? (
          <div className="home-search-group">
            <p className="content-eyebrow">Highlights</p>
            <div ref={passagesScrollRef} className="home-search-passages-scroll">
              <div
                className="home-search-passages-inner"
                style={{ height: `${passagesVirtualizer.getTotalSize()}px` }}
              >
                {passagesVirtualItems.map((virtualItem: VirtualItem) => {
                  const passage = passages[virtualItem.index];
                  if (!passage) return null;
                  return (
                    <div
                      key={virtualItem.key}
                      data-index={virtualItem.index}
                      ref={passagesVirtualizer.measureElement}
                      className="home-search-passages-row"
                      style={{ transform: `translateY(${virtualItem.start}px)` }}
                    >
                      <button
                        type="button"
                        className="home-search-item home-search-item-passage"
                        onClick={() => onOpenWork(passage.workId)}
                      >
                        <span className="activity-quote-mark" aria-hidden="true">
                          &ldquo;
                        </span>
                        <span className="home-search-item-body">
                          <span className="home-search-item-quote">
                            {highlightMatch(
                              excerptAroundMatch(passage.body, query),
                              query
                            )}
                          </span>
                          <span className="home-search-item-meta">
                            {highlightMatch(passage.workTitle, query)}
                          </span>
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
