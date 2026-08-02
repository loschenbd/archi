import { useEffect, useState } from "react";

type Props = {
  isCompleting: boolean;
  hasError: boolean;
};

type Progress = {
  message: string;
  processed?: number;
  total?: number;
};

// `SyncProgressEvent` lives in env.d.ts, which is a module, so it isn't
// global. Derive it from the bridge the same way App.tsx does.
type SyncProgress = Parameters<Parameters<typeof window.archi.onSyncProgress>[0]>[0];

/**
 * The first import is the longest wait in the product — minutes for a large
 * library — and this screen used to show one static line, so a slow import was
 * indistinguishable from a hung one. The main app already broadcasts sync
 * progress for its banner; subscribe to the same stream.
 */
export function FirstSyncStep({ isCompleting, hasError }: Props): JSX.Element {
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    const listener = (event: SyncProgress): void => {
      setProgress({
        message: event.message,
        processed: event.counts?.processed,
        total: event.counts?.total
      });
    };
    window.archi.onSyncProgress(listener);
    return () => window.archi.offSyncProgress(listener);
  }, []);

  const percent =
    progress?.total !== undefined && progress.total > 0 && progress.processed !== undefined
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : null;

  return (
    <div className="onboarding-wizard-step">
      <p className="content-eyebrow">Step 5 of 5 · Importing</p>
      <h1 className="ui-card__title">Importing your library…</h1>
      <div className="ui-card__body">
        <p>
          {hasError
            ? "Something went wrong saving your setup. Try again to continue."
            : isCompleting
              ? "Pulling in your highlights and indexing them for search. You can keep using Archi while this runs."
              : "Almost there."}
        </p>
        {!hasError && progress ? (
          <>
            <p className="onboarding-wizard-help" aria-live="polite">
              {progress.message}
              {progress.processed !== undefined && progress.total !== undefined
                ? ` · ${progress.processed} of ${progress.total}`
                : null}
            </p>
            {percent !== null ? (
              <div
                className="onboarding-wizard-import-bar"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="onboarding-wizard-import-bar-fill"
                  style={{ width: `${percent}%` }}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
