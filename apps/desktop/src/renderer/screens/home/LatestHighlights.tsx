import { useEffect, useState } from "react";
import { excerptOf, formatRelative } from "./utils";

type Passage = {
  id: string;
  body: string;
  workTitle: string;
  ingestedAt: string;
  workId?: string;
};

type Props = {
  passages: Passage[];
  deltaCount: number;
  onOpenWork: (workId: string) => void;
};

export function LatestHighlights({ passages, deltaCount, onOpenWork }: Props): JSX.Element | null {
  const [tickAtMs, setTickAtMs] = useState<number>(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setTickAtMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const items = passages.slice(0, 5);

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="latest-highlights">
      <header className="latest-highlights-head">
        <p className="content-eyebrow">Latest highlights</p>
        {deltaCount > 0 ? (
          <span className="latest-highlights-new-chip">+{deltaCount} new</span>
        ) : null}
      </header>
      <ul className="latest-highlights-list">
        {items.map((passage) => (
          <li key={passage.id} className="latest-highlights-item">
            <button
              type="button"
              className="latest-highlights-button"
              onClick={() => passage.workId && onOpenWork(passage.workId)}
              disabled={!passage.workId}
            >
              <span className="latest-highlights-quote">{excerptOf(passage.body, 160)}</span>
              <span className="latest-highlights-meta">
                <span className="latest-highlights-work">{passage.workTitle}</span>
                <span aria-hidden="true"> · </span>
                <span className="latest-highlights-time tabular">
                  {formatRelative(passage.ingestedAt, tickAtMs)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
