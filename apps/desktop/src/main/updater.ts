export type AutoUpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (...args: unknown[]) => void): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
};

export type WebContentsLike = {
  send(channel: string, payload: unknown): void;
};

export type UpdaterStatusKind = "checking" | "available" | "none" | "progress" | "downloaded" | "error";

export type UpdaterStatusEvent = {
  kind: UpdaterStatusKind;
  payload?: { version?: string; percent?: number; message?: string };
  /** Present only when this status resolves a check the user asked for. */
  manual?: boolean;
};

export class UpdaterController {
  /**
   * Set when the user picks "Check for Updates…" and cleared by the first
   * status that resolves the check. The renderer only speaks up for manual
   * checks; background ones stay silent unless there's something to install.
   */
  private manualCheckPending = false;

  constructor(
    private readonly autoUpdater: AutoUpdaterLike,
    private readonly getWebContents: () => WebContentsLike | null
  ) {
    // Updates download themselves as soon as they're discovered and install
    // on quit — no user click required. The renderer banner still offers
    // "Restart now" once the download lands.
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("update-available", (info) => {
      const version = (info as { version?: string } | undefined)?.version;
      this.send("available", { version }, this.consumeManual());
    });
    autoUpdater.on("update-not-available", () => this.send("none", undefined, this.consumeManual()));
    autoUpdater.on("download-progress", (info) => {
      const percent = (info as { percent?: number } | undefined)?.percent;
      this.send("progress", { percent });
    });
    autoUpdater.on("update-downloaded", (info) => {
      const version = (info as { version?: string } | undefined)?.version;
      this.send("downloaded", { version });
    });
    autoUpdater.on("error", (err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.send("error", { message }, this.consumeManual());
    });
  }

  checkOnLaunch(isPackaged: boolean): void {
    if (isPackaged) {
      void this.autoUpdater.checkForUpdates().catch(() => {
        // errors are surfaced via the error event listener
      });
    }
  }

  checkManual(isPackaged: boolean): void {
    if (!isPackaged) {
      // A dev build has no update feed, so the check would fail silently and
      // the menu item would look broken. Say so instead.
      this.send("error", { message: "Update checks are only available in the installed app." }, true);
      return;
    }
    this.manualCheckPending = true;
    this.send("checking", undefined, true);
    void this.autoUpdater.checkForUpdates().catch(() => {
      // errors are surfaced via the error event listener
    });
  }

  download(): Promise<unknown> {
    return this.autoUpdater.downloadUpdate();
  }

  quitAndInstall(): void {
    this.autoUpdater.quitAndInstall();
  }

  private consumeManual(): boolean {
    const manual = this.manualCheckPending;
    this.manualCheckPending = false;
    return manual;
  }

  private send(kind: UpdaterStatusKind, payload?: UpdaterStatusEvent["payload"], manual?: boolean): void {
    const wc = this.getWebContents();
    if (!wc) {
      return;
    }
    const event: UpdaterStatusEvent = { kind, payload };
    if (manual) {
      event.manual = true;
    }
    wc.send("archi:updater-status", event);
  }
}
