import { useEffect, useMemo, useState } from "react";
import { excerptOf } from "./utils";

type Passage = {
  id: string;
  body: string;
  workId: string;
  workTitle: string;
};

type WorkRef = {
  id: string;
  creator?: string;
};

type Props = {
  passages: Passage[];
  works?: WorkRef[];
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

export function RandomHighlight({ passages, works, onOpenWork }: Props): JSX.Element {
  const [selected, setSelected] = useState<Passage | null>(() =>
    pickRandom(passages)
  );

  const creatorByWorkId = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of works ?? []) {
      if (w.creator) map.set(w.id, w.creator);
    }
    return map;
  }, [works]);

  // If the passages list changes (sync brought new ones) and we don't have a
  // selection yet, pick one. Don't re-roll automatically otherwise.
  useEffect(() => {
    if (!selected && passages.length > 0) {
      setSelected(pickRandom(passages));
    }
  }, [passages, selected]);

  if (passages.length === 0) {
    return (
      <section className="ui-card ui-card--ruled ui-card--loose">
        <p className="ui-card__body">No highlights yet.</p>
      </section>
    );
  }

  if (!selected) {
    return <section className="ui-card ui-card--ruled ui-card--loose" />;
  }

  const canShuffle = passages.length > 1;
  const creator = creatorByWorkId.get(selected.workId);

  return (
    <section className="ui-card ui-card--ruled ui-card--loose">
      <p
        className="ui-card__body ui-drop-cap"
        style={{ fontFamily: "Newsreader, Georgia, serif", fontSize: 18, lineHeight: 1.55 }}
      >
        {excerptOf(selected.body, 360)}
      </p>
      <p
        className="ui-card__body"
        style={{ marginTop: 8, fontSize: 12, color: "var(--ink-500)" }}
      >
        <button
          type="button"
          onClick={() => onOpenWork(selected.workId)}
          style={{
            background: "none",
            border: 0,
            padding: 0,
            font: "inherit",
            color: "inherit",
            cursor: "pointer",
            textAlign: "left"
          }}
        >
          <span style={{ fontWeight: 600 }}>{selected.workTitle}</span>
          {creator ? <span> — {creator}</span> : null}
        </button>
      </p>
      {canShuffle ? (
        <footer className="ui-card__footer">
          <button
            type="button"
            className="ui-btn ui-btn--ghost"
            onClick={(event) => {
              event.stopPropagation();
              setSelected(pickRandom(passages, selected.id));
            }}
            aria-label="Shuffle to a different highlight"
          >
            Shuffle
          </button>
        </footer>
      ) : null}
    </section>
  );
}
