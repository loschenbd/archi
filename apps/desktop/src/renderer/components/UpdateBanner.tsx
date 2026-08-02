import { useEffect, useRef, useState } from "react";

type UpdaterStatusKind = "checking" | "available" | "none" | "progress" | "downloaded" | "error";

type UpdaterStatusEvent = {
  kind: UpdaterStatusKind;
  payload?: { version?: string; percent?: number; message?: string };
  manual?: boolean;
};

type BannerView =
  | { mode: "checking" }
  | { mode: "uptodate" }
  | { mode: "progress"; percent: number }
  | { mode: "downloaded"; version: string }
  | { mode: "error"; message: string }
  | { mode: "hidden" };

/** How long the transient "you're up to date" confirmation stays on screen. */
const UP_TO_DATE_MS = 4000;
/** Backstop so a check that never resolves doesn't leave a spinner forever. */
const CHECKING_TIMEOUT_MS = 20000;

export function UpdateBanner(): JSX.Element | null {
  const [view, setView] = useState<BannerView>({ mode: "hidden" });
  const dismissedKey = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = window.archi.updater.onStatus((event: UpdaterStatusEvent) => {
      switch (event.kind) {
        case "checking": {
          // Only a user-initiated check gets a spinner; the launch and
          // six-hourly checks stay invisible.
          if (event.manual) {
            setView({ mode: "checking" });
          }
          break;
        }
        case "available": {
          // autoDownload is on: discovery means the download is starting.
          setView({ mode: "progress", percent: 0 });
          break;
        }
        case "progress": {
          const percent = Math.max(0, Math.min(100, event.payload?.percent ?? 0));
          setView({ mode: "progress", percent });
          break;
        }
        case "downloaded": {
          const version = event.payload?.version ?? "?";
          if (dismissedKey.current === `downloaded:${version}`) {
            return;
          }
          setView({ mode: "downloaded", version });
          break;
        }
        case "error": {
          const message = event.payload?.message ?? "unknown error";
          // Surface errors from an in-flight download, and from a check the
          // user asked for. Background check failures (e.g. offline)
          // shouldn't nag — they're still written to the main-process log
          // via autoUpdater.logger.
          setView((prev) =>
            event.manual || prev.mode === "progress" ? { mode: "error", message } : prev
          );
          break;
        }
        case "none": {
          // Silence is the right answer for a background check; a manual one
          // needs to confirm that something happened.
          if (event.manual) {
            setView({ mode: "uptodate" });
          }
          break;
        }
        default:
          break;
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (view.mode !== "uptodate" && view.mode !== "checking") {
      return;
    }
    const timer = window.setTimeout(
      () => {
        setView((prev) => (prev.mode === view.mode ? { mode: "hidden" } : prev));
      },
      view.mode === "uptodate" ? UP_TO_DATE_MS : CHECKING_TIMEOUT_MS
    );
    return () => window.clearTimeout(timer);
  }, [view.mode]);

  if (view.mode === "hidden") {
    return null;
  }

  if (view.mode === "checking") {
    return (
      <div className="update-banner" role="status">
        <span className="update-banner-message">Checking for updates…</span>
      </div>
    );
  }

  if (view.mode === "uptodate") {
    return (
      <div className="update-banner" role="status">
        <span className="update-banner-message">You&rsquo;re on the latest version of Archi.</span>
      </div>
    );
  }

  const dismiss = (key: string): void => {
    dismissedKey.current = key;
    setView({ mode: "hidden" });
  };

  if (view.mode === "error") {
    return (
      <div className="update-banner" role="alert">
        <span className="update-banner-message">
          Update failed: {view.message} — you can download the latest version from the site.
        </span>
        <div className="update-banner-actions">
          <button type="button" className="update-banner-secondary" onClick={() => dismiss("error")}>
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (view.mode === "progress") {
    return (
      <div className="update-banner" role="status">
        <span className="update-banner-message">Downloading… {Math.round(view.percent)}%</span>
        <div className="update-banner-progress">
          <div className="update-banner-progress-fill" style={{ width: `${view.percent}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="update-banner" role="status">
      <span className="update-banner-message">Archi v{view.version} ready to install.</span>
      <div className="update-banner-actions">
        <button
          type="button"
          className="update-banner-primary"
          onClick={() => {
            void window.archi.updater.quitAndInstall();
          }}
        >
          Restart now
        </button>
        <button type="button" className="update-banner-secondary" onClick={() => dismiss(`downloaded:${view.version}`)}>
          Later
        </button>
      </div>
    </div>
  );
}
