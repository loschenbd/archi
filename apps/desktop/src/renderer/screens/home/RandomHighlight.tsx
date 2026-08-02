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

/**
 * Kindle splits a long highlight across rows, and each row is stored as its
 * own passage — so ~12% of a real library is a continuation fragment like
 * "people's rejection of His Father." Resurfacing one as the highlight of the
 * moment reads as broken. Readwise ships the same guard, on by default, for
 * its daily review.
 *
 * The test is "reads as a complete sentence", which on a real 3,135-passage
 * library keeps 77% — a picky filter is right for a surface that shows one
 * quote at a time. Falls back to the unfiltered set rather than ever showing
 * an empty card.
 */
const MIN_RESURFACE_LENGTH = 25;
/** Starts like a sentence: a capital or digit, optionally behind an open quote. */
const STARTS_CLEANLY = /^["'“‘([]?[A-Z0-9]/;
/** Ends like a sentence: terminal punctuation, optionally behind a close quote. */
const ENDS_CLEANLY = /["'”’)\]]?[.!?…]["'”’)\]]?$/;

function isResurfaceable(passage: { body: string }): boolean {
  const body = passage.body.trim();
  return (
    body.length >= MIN_RESURFACE_LENGTH &&
    STARTS_CLEANLY.test(body) &&
    ENDS_CLEANLY.test(body)
  );
}

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
  const resurfaceable = useMemo(() => {
    const filtered = passages.filter(isResurfaceable);
    return filtered.length > 0 ? filtered : passages;
  }, [passages]);
  const [selected, setSelected] = useState<Passage | null>(() =>
    pickRandom(resurfaceable)
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
    if (!selected && resurfaceable.length > 0) {
      setSelected(pickRandom(resurfaceable));
    }
  }, [resurfaceable, selected]);

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

  const canShuffle = resurfaceable.length > 1;
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
              setSelected(pickRandom(resurfaceable, selected.id));
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
