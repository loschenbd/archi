import { useEffect, useMemo, useState } from "react";
import { LibraryAllHighlights } from "./library/LibraryAllHighlights";

const LIBRARY_TAB_STORAGE_KEY = "archi.libraryTab";

function readInitialLibraryTab(): LibraryTab {
  if (typeof window === "undefined") {
    return "by-book";
  }
  try {
    const value = window.localStorage.getItem(LIBRARY_TAB_STORAGE_KEY);
    return value === "all-highlights" ? "all-highlights" : "by-book";
  } catch {
    return "by-book";
  }
}

type LibraryWork = {
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

type LibraryTab = "by-book" | "all-highlights";

type Props = {
  works: LibraryWork[];
  selectedWorkId?: string;
  onSelectWork: (workId: string) => void;
  passages: Passage[];
  onOpenWork: (workId: string) => void;
};

const IGNORED_LEADING_ARTICLES = ["the", "a", "an"] as const;
const LETTER_FILTER_BUCKETS: string[] = [
  "#",
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))
];

function getStartBucket(title: string): string {
  let normalized = title.trim().toLowerCase().replace(/^[^a-z0-9]+/i, "");
  for (const article of IGNORED_LEADING_ARTICLES) {
    const prefix = `${article} `;
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length).replace(/^[^a-z0-9]+/i, "");
      break;
    }
  }
  const first = normalized[0];
  if (!first) {
    return "?";
  }
  if (first >= "0" && first <= "9") {
    return "#";
  }
  if (first >= "a" && first <= "z") {
    return first.toUpperCase();
  }
  return "?";
}

function getPlaceholderInitial(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) {
    return "?";
  }
  const first = trimmed.match(/[A-Za-z0-9]/);
  return first ? first[0].toUpperCase() : "?";
}

export function LibraryScreen({
  works,
  selectedWorkId,
  onSelectWork,
  passages,
  onOpenWork
}: Props): JSX.Element {
  const [activeTab, setActiveTab] = useState<LibraryTab>(readInitialLibraryTab);
  const [query, setQuery] = useState("");
  const [letterFilter, setLetterFilter] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(LIBRARY_TAB_STORAGE_KEY, activeTab);
    } catch {
      // ignore — localStorage may be unavailable in some sandbox modes
    }
  }, [activeTab]);

  const availableBuckets = useMemo(() => {
    const buckets = new Set<string>();
    for (const work of works) {
      buckets.add(getStartBucket(work.title));
    }
    return buckets;
  }, [works]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return works.filter((work) => {
      if (q && !`${work.title} ${work.creator ?? ""}`.toLowerCase().includes(q)) {
        return false;
      }
      if (letterFilter && getStartBucket(work.title) !== letterFilter) {
        return false;
      }
      return true;
    });
  }, [query, works, letterFilter]);

  return (
    <section className="library-screen">
      <div className="library-tabs" role="tablist" aria-label="Library views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "by-book"}
          className={`library-tab-button${activeTab === "by-book" ? " library-tab-button-active" : ""}`}
          onClick={() => setActiveTab("by-book")}
        >
          By book
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "all-highlights"}
          className={`library-tab-button${activeTab === "all-highlights" ? " library-tab-button-active" : ""}`}
          onClick={() => setActiveTab("all-highlights")}
        >
          All highlights
        </button>
      </div>

      <div className="library-tab-panel" role="tabpanel">
        {activeTab === "by-book" ? (
          <>
            <header className="screen-intro">
              <p>Browse imported works and drill into exact highlight locations.</p>
            </header>
            <input
              className="library-search-input"
              placeholder="Search works..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="library-letter-filter" role="group" aria-label="Filter by starting letter">
              <button
                type="button"
                className={`library-letter-filter-pill${letterFilter === null ? " active" : ""}`}
                onClick={() => setLetterFilter(null)}
                aria-pressed={letterFilter === null}
              >
                All
              </button>
              {LETTER_FILTER_BUCKETS.map((letter) => {
                const isAvailable = availableBuckets.has(letter);
                const isActive = letterFilter === letter;
                return (
                  <button
                    key={letter}
                    type="button"
                    className={`library-letter-filter-pill${isActive ? " active" : ""}${!isAvailable ? " empty" : ""}`}
                    disabled={!isAvailable}
                    aria-pressed={isActive}
                    onClick={() => setLetterFilter(isActive ? null : letter)}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
            <p className="screen-count">
              {filtered.length} {filtered.length === 1 ? "work" : "works"}
            </p>
            {filtered.length === 0 ? (
              <p className="library-empty-state">
                {works.length === 0
                  ? "No works ingested yet."
                  : "No works match your search."}
              </p>
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
          </>
        ) : (
          <LibraryAllHighlights passages={passages} onOpenWork={onOpenWork} />
        )}
      </div>
    </section>
  );
}
