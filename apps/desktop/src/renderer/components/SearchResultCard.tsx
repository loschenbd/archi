import { useState } from "react";
import type { SearchResult } from "@archi/search";

type Props = {
  result: SearchResult;
  showMatchSource: boolean;
  onOpen: (passageId: string) => void;
  onOpenWork: (workId: string) => void;
  onFindSimilar: (passageBody: string) => void;
};

const matchLabel: Record<SearchResult["matchedVia"], string> = {
  vector: "meaning",
  fts5: "keyword",
  both: "meaning + keyword"
};

export function SearchResultCard({
  result,
  showMatchSource,
  onOpen,
  onOpenWork,
  onFindSimilar
}: Props) {
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

  return (
    <article
      className="search-result-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(result.passageId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(result.passageId);
        }
      }}
    >
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
      <p className="search-result-card__body">{result.snippet}</p>
      {result.readerNote && (
        <p className="search-result-card__note">
          <strong>Note</strong>
          {result.readerNote}
        </p>
      )}
      <div
        className="passage-card-actions"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="passage-card-action"
          onClick={() => onFindSimilar(result.body)}
          title="Find passages similar to this one"
        >
          <span className="passage-card-action-icon" aria-hidden="true">≈</span>
          Find similar
        </button>
        <button
          type="button"
          className="passage-card-action"
          onClick={() => onOpenWork(result.work.id)}
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
      {result.markedAt && (
        <footer className="search-result-card__footer">
          Marked {new Date(result.markedAt).toLocaleDateString()}
        </footer>
      )}
    </article>
  );
}
