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
   * Legacy callback used by the (soon-to-be-deleted) SearchScreen.
   * Kept optional so that screens which still pass it compile; new
   * call sites should pass `onFindSimilar` instead. Removed alongside
   * the SearchScreen in Task 11.
   */
  onOpenSearchScreen?: (query: string) => void;
  /**
   * Modern hybrid-search "Find similar" callback. When provided the
   * card renders a Find similar button that delegates entirely to the
   * caller (typically HomeSearchResults), which feeds the passage body
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
  onOpenSearchScreen,
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
      {expanded && (
        <div
          className="passage-card-actions"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {onFindSimilar ? (
            <button
              type="button"
              className="passage-card-action"
              onClick={(e) => {
                e.stopPropagation();
                onFindSimilar();
              }}
              aria-label="Find similar passages"
              title="Find passages semantically similar to this one"
            >
              <span className="passage-card-action-icon" aria-hidden="true">⚡</span>
              Find similar
            </button>
          ) : onOpenSearchScreen ? (
            <button
              type="button"
              className="passage-card-action"
              onClick={(e) => {
                e.stopPropagation();
                // Cap query length to avoid awkward search-screen UX.
                onOpenSearchScreen(result.body.slice(0, 240));
              }}
              aria-label="Find similar passages"
              title="Find passages semantically similar to this one"
            >
              <span className="passage-card-action-icon" aria-hidden="true">⚡</span>
              Find similar
            </button>
          ) : null}
          <button
            type="button"
            className="passage-card-action"
            onClick={() => onOpenWork(result.work.id, result.passageId)}
            title="Open this book in Library"
          >
            <span className="passage-card-action-icon" aria-hidden="true">↗</span>
            Open book
          </button>
          <button
            type="button"
            className={`passage-card-action ${copied ? "passage-card-action-success" : ""}`}
            onClick={() => {
              void copyBody();
            }}
            title="Copy quote to clipboard"
          >
            <span className="passage-card-action-icon" aria-hidden="true">{copied ? "✓" : "⎘"}</span>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {result.markedAt && (
        <footer className="search-result-card__footer">
          Marked {new Date(result.markedAt).toLocaleDateString()}
        </footer>
      )}
    </article>
  );
}
