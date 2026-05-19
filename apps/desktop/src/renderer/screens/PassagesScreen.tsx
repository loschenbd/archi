import { useMemo, useState } from "react";

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

export function PassagesScreen({ passages, onOpenWork }: Props): JSX.Element {
  const [query, setQuery] = useState("");
  const [workFilter, setWorkFilter] = useState("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const works = useMemo(() => Array.from(new Set(passages.map((passage) => passage.workTitle))).sort(), [passages]);
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return passages.filter((passage) => {
      const workMatches = workFilter === "all" || passage.workTitle === workFilter;
      const textMatches = !q || `${passage.workTitle} ${passage.body}`.toLowerCase().includes(q);
      return workMatches && textMatches;
    });
  }, [passages, query, workFilter]);

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

  return (
    <section className="passages-screen">
      <header className="screen-intro">
        <p>Search across every ingested highlight and filter by title.</p>
      </header>
      <div className="passages-filters">
        <input
          className="library-search-input"
          placeholder="Search passages..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select className="select-input" value={workFilter} onChange={(event) => setWorkFilter(event.target.value)}>
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
        <p>No passages synced yet.</p>
      ) : (
        <ul className="passages-list">
          {filtered.map((passage) => (
            <li key={passage.id} className="passage-card">
              <span className="passage-card-mark" aria-hidden="true">
                &ldquo;
              </span>
              <blockquote className="passage-card-body">{passage.body}</blockquote>
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
                    className={`passage-card-action ${copiedId === passage.id ? "passage-card-action-success" : ""}`}
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
