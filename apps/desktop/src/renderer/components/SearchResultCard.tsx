import { useState } from "react";
import type { SearchResult } from "@archi/search";
import { HighlightedText } from "./HighlightedText";

type Props = {
  result: SearchResult;
  showMatchSource: boolean;
  expanded: boolean;
  onToggle: () => void;
  onOpenWork: (workId: string, passageId: string) => void;
  /**
   * Hybrid-search "Find similar" callback. When provided the card
   * renders a Find similar button that delegates entirely to the
   * caller (typically SearchHero), which feeds the passage body
   * back into the home search input as a sentinel chip.
   */
  onFindSimilar?: () => void;
  /**
   * Optional Copy override. When provided the card uses it instead of
   * the built-in clipboard write — useful for callers that want their
   * own toast / analytics around the copy action.
   */
  onCopy?: () => void;
};

const matchLabel: Record<SearchResult["matchedVia"], string> = {
  vector: "meaning",
  fts5: "keyword",
  both: "meaning + keyword"
};

export function SearchResultCard({
  result,
  showMatchSource,
  expanded,
  onToggle,
  onOpenWork,
  onFindSimilar,
  onCopy
}: Props): JSX.Element {
  const [copied, setCopied] = useState(false);

  const copyBody = async (): Promise<void> => {
    if (onCopy) {
      onCopy();
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      return;
    }
    try {
      await navigator.clipboard.writeText(result.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard write can reject in unusual sandbox states; silently swallow.
    }
  };

  const cardId = `search-result-${result.passageId}`;
  const bodyId = `${cardId}-body`;

  return (
    <article
      className={`ui-card ui-card--tight${expanded ? " search-result-card--expanded" : ""}`}
      id={cardId}
    >
      <button
        type="button"
        className="search-result-card__expand-toggle"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={onToggle}
        aria-label={expanded ? "Collapse result" : "Expand result"}
      />
      <header className="search-result-card__header">
        {result.isStarred && (
          <span className="search-result-card__starred" aria-label="Starred" title="Starred">
            ★
          </span>
        )}
        <span className="search-result-card__source">
          {result.work.creator && (
            <span className="search-result-card__source-creator">{result.work.creator}</span>
          )}
          {result.work.creator && " · "}
          {result.work.displayTitle}
          {result.position && (
            <>
              {" · "}
              <span className="search-result-card__source-position">{result.position}</span>
            </>
          )}
        </span>
        {showMatchSource && (
          <span
            className="search-result-card__match-source"
            data-via={result.matchedVia}
            title="How this result was found"
          >
            {matchLabel[result.matchedVia]}
          </span>
        )}
        <div
          className="search-result-card__actions"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {onFindSimilar ? (
            <button
              type="button"
              className="search-result-card__action"
              onClick={(e) => {
                e.stopPropagation();
                onFindSimilar();
              }}
              aria-label="Find similar passages"
              title="Find similar passages"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 1.5 L9.2 6.8 L14.5 8 L9.2 9.2 L8 14.5 L6.8 9.2 L1.5 8 L6.8 6.8 Z" />
              </svg>
            </button>
          ) : null}
          <button
            type="button"
            className="search-result-card__action"
            onClick={(e) => {
              e.stopPropagation();
              onOpenWork(result.work.id, result.passageId);
            }}
            aria-label="Open book in Library"
            title="Open book in Library"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 3 H13 V6" />
              <path d="M13 3 L7.5 8.5" />
              <path d="M11 9 V12 H4 V5 H7" />
            </svg>
          </button>
          <button
            type="button"
            className={`search-result-card__action${copied ? " search-result-card__action--success" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              void copyBody();
            }}
            aria-label={copied ? "Copied to clipboard" : "Copy quote to clipboard"}
            title={copied ? "Copied" : "Copy quote"}
          >
            {copied ? (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 8.5 L6.5 12 L13 4" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
                <path d="M3 10.5 V4 a1.5 1.5 0 0 1 1.5 -1.5 H10.5" />
              </svg>
            )}
          </button>
        </div>
      </header>
      <p
        id={bodyId}
        className={`search-result-card__body${expanded ? "" : " search-result-card__body--collapsed"}`}
      >
        <HighlightedText snippet={expanded ? result.body : result.snippet} />
      </p>
      {expanded && result.readerNote && (
        <p className="search-result-card__note">
          <strong>Note</strong>
          {result.readerNote}
        </p>
      )}
      {result.markedAt && (
        <footer className="search-result-card__footer">
          Marked {new Date(result.markedAt).toLocaleDateString()}
        </footer>
      )}
    </article>
  );
}
