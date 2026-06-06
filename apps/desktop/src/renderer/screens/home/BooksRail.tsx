import { useEffect, useRef, useState } from "react";

type Work = {
  id: string;
  title: string;
  creator?: string;
  coverImageUrl?: string;
  ingestedAt: string;
};

type Props = {
  works: Work[];
  deltaCount: number;
  onOpenWork: (workId: string) => void;
};

const VISIBLE = 12;
const ENTER_FLAG_MS = 1600;

export function BooksRail({ works, deltaCount, onOpenWork }: Props): JSX.Element | null {
  // Track ids we've already shown so we can flag genuinely new arrivals
  // (vs the initial mount, which would otherwise animate every tile).
  const previousIdsRef = useRef<Set<string> | null>(null);
  const [newlyArrived, setNewlyArrived] = useState<Set<string>>(new Set());

  useEffect(() => {
    const visible = works.slice(0, VISIBLE);
    const visibleIds = new Set(visible.map((w) => w.id));

    if (previousIdsRef.current === null) {
      // First mount: don't animate; just seed the baseline.
      previousIdsRef.current = visibleIds;
      return;
    }

    const arrivals = new Set<string>();
    for (const id of visibleIds) {
      if (!previousIdsRef.current.has(id)) {
        arrivals.add(id);
      }
    }
    previousIdsRef.current = visibleIds;

    if (arrivals.size === 0) {
      return;
    }

    setNewlyArrived((current) => {
      const next = new Set(current);
      for (const id of arrivals) next.add(id);
      return next;
    });

    const timer = window.setTimeout(() => {
      setNewlyArrived((current) => {
        const next = new Set(current);
        for (const id of arrivals) next.delete(id);
        return next;
      });
    }, ENTER_FLAG_MS);

    return () => window.clearTimeout(timer);
  }, [works]);

  if (works.length === 0) {
    return null;
  }

  const visible = works.slice(0, VISIBLE);

  return (
    <section className="books-rail">
      <header className="books-rail-head">
        <p className="content-eyebrow">Recently added</p>
        {deltaCount > 0 ? (
          <span className="books-rail-new-chip">+{deltaCount} new</span>
        ) : null}
      </header>
      <ul className="books-rail-track">
        {visible.map((work) => {
          const isNew = newlyArrived.has(work.id);
          return (
            <li
              key={work.id}
              className={`books-rail-tile${isNew ? " books-rail-tile--entering" : ""}`}
              // View Transitions API auto-animates reorder when parent
              // state changes are wrapped in document.startViewTransition.
              style={{ viewTransitionName: `book-${work.id}` } as React.CSSProperties}
            >
              <button
                type="button"
                className="books-rail-tile-button"
                onClick={() => onOpenWork(work.id)}
              >
                <span className="books-rail-tile-cover" aria-hidden="true">
                  {work.coverImageUrl ? (
                    <img src={work.coverImageUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="books-rail-tile-cover-letter">
                      {(work.title[0] ?? "?").toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="books-rail-tile-title">{work.title}</span>
                {work.creator ? (
                  <span className="books-rail-tile-creator">{work.creator}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
