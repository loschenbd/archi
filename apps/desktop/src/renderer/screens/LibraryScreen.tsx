import { useMemo, useState } from "react";

type LibraryWork = {
  id: string;
  title: string;
  creator?: string;
  coverImageUrl?: string;
};

type Props = {
  works: LibraryWork[];
  selectedWorkId?: string;
  onSelectWork: (workId: string) => void;
};

function getPlaceholderInitial(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) {
    return "?";
  }
  const first = trimmed.match(/[A-Za-z0-9]/);
  return first ? first[0].toUpperCase() : "?";
}

export function LibraryScreen({ works, selectedWorkId, onSelectWork }: Props): JSX.Element {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) {
      return works;
    }
    return works.filter((work) => `${work.title} ${work.creator ?? ""}`.toLowerCase().includes(q));
  }, [query, works]);

  return (
    <section className="library-screen">
      <header className="screen-intro">
        <p>Browse imported works and drill into exact highlight locations.</p>
      </header>
      <input
        className="library-search-input"
        placeholder="Search works..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p className="screen-count">
        {filtered.length} {filtered.length === 1 ? "work" : "works"}
      </p>
      {filtered.length === 0 ? (
        <p className="library-empty-state">No works ingested yet.</p>
      ) : (
        <ul className="library-card-grid">
          {filtered.map((work) => (
            <li key={work.id}>
              <button
                type="button"
                className={`library-work-card ${selectedWorkId === work.id ? "selected" : ""}`}
                onClick={() => onSelectWork(work.id)}
              >
                <div className="library-work-cover">
                  {work.coverImageUrl ? (
                    <img src={work.coverImageUrl} alt={`${work.title} cover`} loading="lazy" />
                  ) : (
                    <span aria-hidden="true">{getPlaceholderInitial(work.title)}</span>
                  )}
                </div>
                <div className="library-work-meta">
                  <h3>{work.title}</h3>
                  <p>{work.creator || "Unknown author"}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
