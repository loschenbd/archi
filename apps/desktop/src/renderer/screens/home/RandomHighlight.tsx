import { useEffect, useState } from "react";
import { excerptOf } from "./utils";

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

function pickRandom<T>(items: T[], excludeId?: string): T | null {
  if (items.length === 0) return null;
  const first = items[0];
  if (items.length === 1 || first === undefined) return first ?? null;
  let candidate: T = first;
  let attempts = 0;
  do {
    const next = items[Math.floor(Math.random() * items.length)];
    if (next !== undefined) {
      candidate = next;
    }
    attempts += 1;
  } while (
    excludeId !== undefined &&
    (candidate as unknown as { id: string }).id === excludeId &&
    attempts < 4
  );
  return candidate;
}

export function RandomHighlight({ passages, onOpenWork }: Props): JSX.Element {
  const [selected, setSelected] = useState<Passage | null>(() =>
    pickRandom(passages)
  );

  // If the passages list changes (sync brought new ones) and we don't have a
  // selection yet, pick one. Don't re-roll automatically otherwise.
  useEffect(() => {
    if (!selected && passages.length > 0) {
      setSelected(pickRandom(passages));
    }
  }, [passages, selected]);

  if (passages.length === 0) {
    return (
      <section className="random-highlight-card random-highlight-card-empty">
        <p className="content-eyebrow">A random highlight</p>
        <p className="random-highlight-empty">No highlights yet.</p>
      </section>
    );
  }

  if (!selected) {
    return (
      <section className="random-highlight-card">
        <p className="content-eyebrow">A random highlight</p>
      </section>
    );
  }

  const canShuffle = passages.length > 1;

  return (
    <section className="random-highlight-card">
      <header className="random-highlight-head">
        <p className="content-eyebrow">A random highlight</p>
        {canShuffle ? (
          <button
            type="button"
            className="random-highlight-shuffle"
            onClick={(event) => {
              event.stopPropagation();
              setSelected(pickRandom(passages, selected.id));
            }}
            aria-label="Shuffle to a different highlight"
          >
            Shuffle ↻
          </button>
        ) : null}
      </header>
      <button
        type="button"
        className="random-highlight-body-button"
        onClick={() => onOpenWork(selected.workId)}
      >
        <span className="random-highlight-quote-mark" aria-hidden="true">&ldquo;</span>
        <p className="random-highlight-quote">{excerptOf(selected.body, 360)}</p>
        <p className="random-highlight-attribution">{selected.workTitle}</p>
      </button>
    </section>
  );
}
