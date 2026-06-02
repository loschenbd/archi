import type { SearchResult } from "@archi/search";

type Props = {
  result: SearchResult;
  showMatchSource: boolean;
  onOpen: (passageId: string) => void;
};

export function SearchResultCard({ result, showMatchSource, onOpen }: Props) {
  return (
    <article className="search-result-card" onClick={() => onOpen(result.passageId)}>
      <header className="search-result-card__header">
        {result.isStarred && <span aria-label="starred" title="Starred">★</span>}
        <span className="search-result-card__source">
          {result.work.creator ? `${result.work.creator} · ` : ""}
          {result.work.displayTitle}
          {result.position ? ` · ${result.position}` : ""}
        </span>
        {showMatchSource && (
          <span className="search-result-card__match-source" title="How this result was found">
            {result.matchedVia === "vector" ? "⚡ meaning" : result.matchedVia === "fts5" ? "🔤 keyword" : "⚡+🔤 both"}
          </span>
        )}
      </header>
      <p className="search-result-card__body">{result.snippet}</p>
      {result.readerNote && (
        <p className="search-result-card__note">
          <strong>Note:</strong> {result.readerNote}
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
