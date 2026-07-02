import { useEffect, useRef, useState } from "react";

type UpdaterStatusKind = "available" | "none" | "progress" | "downloaded" | "error";

type UpdaterStatusEvent = {
  kind: UpdaterStatusKind;
  payload?: { version?: string; percent?: number; message?: string };
};

type BannerView =
  | { mode: "available"; version: string }
  | { mode: "progress"; percent: number }
  | { mode: "downloaded"; version: string }
  | { mode: "error"; message: string }
  | { mode: "hidden" };

export function UpdateBanner(): JSX.Element | null {
  const [view, setView] = useState<BannerView>({ mode: "hidden" });
  const dismissedKey = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = window.archi.updater.onStatus((event: UpdaterStatusEvent) => {
      switch (event.kind) {
        case "available": {
          const version = event.payload?.version ?? "?";
          if (dismissedKey.current === `available:${version}`) {
            return;
          }
          setView({ mode: "available", version });
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
          // Only surface errors from a user-initiated download; background
          // check failures (e.g. offline) shouldn't nag. They're still
          // written to the main-process log via autoUpdater.logger.
          setView((prev) => (prev.mode === "progress" ? { mode: "error", message } : prev));
          break;
        }
        case "none":
        default:
          break;
      }
    });
    return unsubscribe;
  }, []);

  if (view.mode === "hidden") {
    return null;
  }

  const dismiss = (key: string): void => {
    dismissedKey.current = key;
    setView({ mode: "hidden" });
  };

  if (view.mode === "available") {
    return (
      <div className="update-banner" role="status">
        <span className="update-banner-message">Archi v{view.version} is available.</span>
        <div className="update-banner-actions">
          <button
            type="button"
            className="update-banner-primary"
            onClick={() => {
              void window.archi.updater.download();
              setView({ mode: "progress", percent: 0 });
            }}
          >
            Download
          </button>
          <button type="button" className="update-banner-secondary" onClick={() => dismiss(`available:${view.version}`)}>
            Dismiss
          </button>
        </div>
      </div>
    );
  }

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
