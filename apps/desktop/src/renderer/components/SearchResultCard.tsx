import type { SearchResult } from "@archi/search";

type Props = {
  result: SearchResult;
  showMatchSource: boolean;
  onOpen: (passageId: string) => void;
};

const matchLabel: Record<SearchResult["matchedVia"], string> = {
  vector: "meaning",
  fts5: "keyword",
  both: "meaning + keyword"
};

export function SearchResultCard({ result, showMatchSource, onOpen }: Props) {
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
      {result.markedAt && (
        <footer className="search-result-card__footer">
          Marked {new Date(result.markedAt).toLocaleDateString()}
        </footer>
      )}
    </article>
  );
}
