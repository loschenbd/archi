import { useCallback, useEffect, useMemo, useState } from "react";

const PREF_SESSION_SIZE = "review.sessionSize";
const PREF_QUALITY_FILTER = "review.qualityFilter";

/** Readwise's themed sessions run 1–15, default 5. */
const MIN_SESSION = 1;
const MAX_SESSION = 15;
const DEFAULT_SESSION = 5;

type Props = {
  onOpenWork: (workId: string, passageId: string) => void;
};

type Phase = "idle" | "loading" | "reviewing" | "done";

// The response types live in env.d.ts, which is a module and therefore not
// global. Derive them from the bridge, as App.tsx does for sync progress.
type SessionResponse = Awaited<ReturnType<typeof window.archi.review.session>>;

export function ReviewScreen({ onOpenWork }: Props): JSX.Element {
  const [sessionSize, setSessionSize] = useState(DEFAULT_SESSION);
  const [qualityFilter, setQualityFilter] = useState(true);
  const [theme, setTheme] = useState("");
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [stats, setStats] = useState<{ total: number; due: number; reviewed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [themeSuggestions, setThemeSuggestions] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      const [size, quality] = await Promise.all([
        window.archi.preferences.get<number>(PREF_SESSION_SIZE, DEFAULT_SESSION),
        window.archi.preferences.get<boolean>(PREF_QUALITY_FILTER, true)
      ]);
      setSessionSize(size);
      setQualityFilter(quality);
      setStats(await window.archi.review.stats());
    })();
  }, []);

  // Seed the theme field from the reader's own shelf rather than a blank box.
  // Readwise offers corpus-derived suggestions here; authors are the cheapest
  // honest source we already have locally.
  useEffect(() => {
    void (async () => {
      const works = await window.archi.listWorks();
      const creators = works
        .map((w) => w.creator)
        .filter((c): c is string => Boolean(c && c.trim().length > 0));
      const counts = new Map<string, number>();
      for (const c of creators) counts.set(c, (counts.get(c) ?? 0) + 1);
      const top = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([creator]) => creator);
      setThemeSuggestions(top);
    })();
  }, []);

  const start = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const trimmed = theme.trim();
      const result = await window.archi.review.session({
        limit: sessionSize,
        qualityFilter,
        ...(trimmed ? { theme: trimmed } : {})
      });
      setSession(result);
      setIndex(0);
      setPhase(result.items.length > 0 ? "reviewing" : "done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build a review session.");
      setPhase("idle");
    }
  }, [sessionSize, qualityFilter, theme]);

  const advance = useCallback(
    async (action: "reviewed" | "revisit") => {
      const current = session?.items[index];
      if (!current) return;
      await window.archi.review.record(current.passageId, action);
      const next = index + 1;
      if (session && next < session.items.length) {
        setIndex(next);
      } else {
        setPhase("done");
        setStats(await window.archi.review.stats());
      }
    },
    [session, index]
  );

  // Keyboard-first: the whole session should be runnable without the mouse.
  useEffect(() => {
    if (phase !== "reviewing") return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key === " " || event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        void advance("reviewed");
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        void advance("revisit");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, advance]);

  const persistSize = (value: number): void => {
    setSessionSize(value);
    void window.archi.preferences.set(PREF_SESSION_SIZE, value);
  };

  const persistQuality = (value: boolean): void => {
    setQualityFilter(value);
    void window.archi.preferences.set(PREF_QUALITY_FILTER, value);
  };

  const current = session?.items[index];
  const progressLabel = useMemo(
    () => (session ? `${Math.min(index + 1, session.items.length)} of ${session.items.length}` : ""),
    [session, index]
  );

  if (phase === "reviewing" && current) {
    return (
      <section className="review-screen">
        <header className="review-progress-row">
          <span className="content-eyebrow">{progressLabel}</span>
          <div className="review-progress-track" aria-hidden="true">
            <div
              className="review-progress-fill"
              style={{ width: `${((index + 1) / (session?.items.length ?? 1)) * 100}%` }}
            />
          </div>
        </header>

        <article className="ui-card ui-card--ruled ui-card--loose review-card">
          <p className="review-card-body">{current.body}</p>
          <p className="review-card-source">
            <button type="button" onClick={() => onOpenWork(current.workId, current.passageId)}>
              <span className="review-card-title">{current.workTitle}</span>
              {current.creator ? <span> — {current.creator}</span> : null}
            </button>
            {current.reviewCount > 0 ? (
              <span className="review-card-meta">
                {" "}
                · seen {current.reviewCount === 1 ? "once" : `${current.reviewCount} times`}
              </span>
            ) : (
              <span className="review-card-meta"> · first time back</span>
            )}
          </p>
        </article>

        <footer className="review-actions">
          <button type="button" className="ui-btn ui-btn--primary" onClick={() => void advance("reviewed")}>
            Got it <kbd>Space</kbd>
          </button>
          <button type="button" className="ui-btn ui-btn--secondary" onClick={() => void advance("revisit")}>
            Show again soon <kbd>R</kbd>
          </button>
        </footer>
      </section>
    );
  }

  if (phase === "done") {
    const nothingWasDue = (session?.items.length ?? 0) === 0;
    return (
      <section className="review-screen review-screen--centered">
        <div className="ui-card ui-card--ruled ui-card--loose review-summary">
          <h2 className="ui-card__title">
            {nothingWasDue ? "Nothing due right now." : "Session complete."}
          </h2>
          <p className="ui-card__body">
            {nothingWasDue
              ? session?.themeMatched === 0
                ? "No highlights matched that theme. Try a broader idea."
                : "Everything in your library is still fresh. Highlights come back as your recall of them decays — check again in a few days."
              : `You reviewed ${session?.items.length} ${session?.items.length === 1 ? "highlight" : "highlights"}. Each one will resurface later, further out than last time.`}
          </p>
          {stats ? (
            <p className="review-stats">
              {stats.due} due · {stats.reviewed} reviewed · {stats.total} in rotation
            </p>
          ) : null}
          <button type="button" className="ui-btn ui-btn--primary" onClick={() => setPhase("idle")}>
            Back to review setup
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="review-screen review-screen--centered">
      <div className="ui-card ui-card--ruled ui-card--loose review-setup">
        <p className="content-eyebrow">Review</p>
        <h2 className="ui-card__title">Come back to what you&rsquo;ve read.</h2>
        <p className="ui-card__body">
          Highlights resurface as your recall of them decays rather than on a fixed calendar, so
          nothing is ever overdue — the ones you remember least come back first.
        </p>

        {stats ? (
          <p className="review-stats">
            {stats.due} due now · {stats.reviewed} reviewed · {stats.total} in rotation
          </p>
        ) : null}

        <label className="onboarding-wizard-field-label" htmlFor="review-theme">
          Theme <span className="review-optional">optional</span>
        </label>
        <input
          id="review-theme"
          type="text"
          className="ui-input"
          placeholder="e.g. attention and focus, or highlights about starting things"
          value={theme}
          onChange={(event) => setTheme(event.target.value)}
        />
        {themeSuggestions.length > 0 && theme.trim().length === 0 ? (
          <div className="review-theme-suggestions">
            {themeSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="ui-chip"
                onClick={() => setTheme(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        <label className="onboarding-wizard-field-label" htmlFor="review-size">
          Session size — {sessionSize} {sessionSize === 1 ? "highlight" : "highlights"}
        </label>
        <input
          id="review-size"
          type="range"
          min={MIN_SESSION}
          max={MAX_SESSION}
          value={sessionSize}
          onChange={(event) => persistSize(Number(event.target.value))}
          className="review-size-slider"
        />

        <label className="review-toggle">
          <input
            type="checkbox"
            checked={qualityFilter}
            onChange={(event) => persistQuality(event.target.checked)}
          />
          <span>
            Skip sentence fragments
            <span className="review-toggle-hint">
              Kindle splits long highlights across rows; this leaves the halves out of reviews.
            </span>
          </span>
        </label>

        {error ? <p className="error banner-error">{error}</p> : null}

        <button
          type="button"
          className="ui-btn ui-btn--primary"
          onClick={() => void start()}
          disabled={phase === "loading"}
        >
          {phase === "loading" ? "Building session…" : "Start review"}
        </button>
      </div>
    </section>
  );
}
