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

export type UpdaterStatusKind = "available" | "none" | "progress" | "downloaded" | "error";

export type UpdaterStatusEvent = {
  kind: UpdaterStatusKind;
  payload?: { version?: string; percent?: number; message?: string };
};

export class UpdaterController {
  constructor(
    private readonly autoUpdater: AutoUpdaterLike,
    private readonly getWebContents: () => WebContentsLike | null
  ) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("update-available", (info) => {
      const version = (info as { version?: string } | undefined)?.version;
      this.send("available", { version });
    });
    autoUpdater.on("update-not-available", () => this.send("none"));
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
      this.send("error", { message });
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
    if (isPackaged) {
      void this.autoUpdater.checkForUpdates().catch(() => {
        // errors are surfaced via the error event listener
      });
    }
  }

  download(): Promise<unknown> {
    return this.autoUpdater.downloadUpdate();
  }

  quitAndInstall(): void {
    this.autoUpdater.quitAndInstall();
  }

  private send(kind: UpdaterStatusKind, payload?: UpdaterStatusEvent["payload"]): void {
    const wc = this.getWebContents();
    if (wc) {
      wc.send("archi:updater-status", { kind, payload });
    }
  }
}
