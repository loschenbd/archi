import { useState } from "react";
import type { SearchResult } from "@archi/search";
import { HighlightedText } from "./HighlightedText";
import { FindSimilarButton } from "./FindSimilarButton";

type Props = {
  result: SearchResult;
  showMatchSource: boolean;
  expanded: boolean;
  onToggle: () => void;
  onOpenWork: (workId: string, passageId: string) => void;
  onOpenSearchScreen: (query: string) => void;
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
  onOpenSearchScreen
}: Props): JSX.Element {
  const [copied, setCopied] = useState(false);

  const copyBody = async (): Promise<void> => {
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
          <FindSimilarButton
            passageBody={result.body}
            onOpenSearchScreen={onOpenSearchScreen}
          />
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
