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
      className={`search-result-card${expanded ? " search-result-card--expanded" : ""}`}
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
              <span aria-hidden="true">⚡</span>
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
            <span aria-hidden="true">↗</span>
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
            <span aria-hidden="true">{copied ? "✓" : "⎘"}</span>
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
