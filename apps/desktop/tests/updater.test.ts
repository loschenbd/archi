import { describe, expect, it, vi } from "vitest";
import { UpdaterController, type AutoUpdaterLike, type WebContentsLike } from "../src/main/updater.js";

function makeFakeAutoUpdater() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const fake: AutoUpdaterLike = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    on(event, listener) {
      listeners.set(event, listener as (...args: unknown[]) => void);
    },
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn()
  };
  return { fake, fire: (event: string, ...args: unknown[]) => listeners.get(event)?.(...args) };
}

function makeFakeWebContents() {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const wc: WebContentsLike = {
    send(channel, payload) {
      sent.push({ channel, payload });
    }
  };
  return { wc, sent };
}

describe("UpdaterController", () => {
  it("sets autoDownload=true and autoInstallOnAppQuit=true on construction", () => {
    const { fake } = makeFakeAutoUpdater();
    fake.autoDownload = false;
    const { wc } = makeFakeWebContents();
    new UpdaterController(fake, () => wc);
    expect(fake.autoDownload).toBe(true);
    expect(fake.autoInstallOnAppQuit).toBe(true);
  });

  it("broadcasts 'available' with version when update-available fires", () => {
    const { fake, fire } = makeFakeAutoUpdater();
    const { wc, sent } = makeFakeWebContents();
    new UpdaterController(fake, () => wc);
    fire("update-available", { version: "0.2.0" });
    expect(sent).toEqual([{ channel: "archi:updater-status", payload: { kind: "available", payload: { version: "0.2.0" } } }]);
  });

  it("broadcasts 'progress' with percent when download-progress fires", () => {
    const { fake, fire } = makeFakeAutoUpdater();
    const { wc, sent } = makeFakeWebContents();
    new UpdaterController(fake, () => wc);
    fire("download-progress", { percent: 42.7 });
    expect(sent[0]).toEqual({ channel: "archi:updater-status", payload: { kind: "progress", payload: { percent: 42.7 } } });
  });

  it("broadcasts 'downloaded' with version when update-downloaded fires", () => {
    const { fake, fire } = makeFakeAutoUpdater();
    const { wc, sent } = makeFakeWebContents();
    new UpdaterController(fake, () => wc);
    fire("update-downloaded", { version: "0.2.0" });
    expect(sent[0]).toEqual({ channel: "archi:updater-status", payload: { kind: "downloaded", payload: { version: "0.2.0" } } });
  });

  it("broadcasts 'none' when update-not-available fires", () => {
    const { fake, fire } = makeFakeAutoUpdater();
    const { wc, sent } = makeFakeWebContents();
    new UpdaterController(fake, () => wc);
    fire("update-not-available");
    expect(sent[0]).toEqual({ channel: "archi:updater-status", payload: { kind: "none", payload: undefined } });
  });

  it("broadcasts 'error' with message when error fires", () => {
    const { fake, fire } = makeFakeAutoUpdater();
    const { wc, sent } = makeFakeWebContents();
    new UpdaterController(fake, () => wc);
    fire("error", new Error("network down"));
    expect(sent[0]).toEqual({ channel: "archi:updater-status", payload: { kind: "error", payload: { message: "network down" } } });
  });

  it("calls checkForUpdates when checkOnLaunch is invoked in packaged mode", () => {
    const { fake } = makeFakeAutoUpdater();
    const { wc } = makeFakeWebContents();
    const c = new UpdaterController(fake, () => wc);
    c.checkOnLaunch(true);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("does not call checkForUpdates when not packaged", () => {
    const { fake } = makeFakeAutoUpdater();
    const { wc } = makeFakeWebContents();
    const c = new UpdaterController(fake, () => wc);
    c.checkOnLaunch(false);
    c.checkManual(false);
    expect(fake.checkForUpdates).not.toHaveBeenCalled();
  });

  it("tells the renderer why a manual check does nothing in a dev build", () => {
    const { fake } = makeFakeAutoUpdater();
    const { wc, sent } = makeFakeWebContents();
    const c = new UpdaterController(fake, () => wc);
    c.checkManual(false);
    expect(sent[0]).toEqual({
      channel: "archi:updater-status",
      payload: {
        kind: "error",
        payload: { message: "Update checks are only available in the installed app." },
        manual: true
      }
    });
  });

  it("emits a manual 'checking' status when the user starts a check", () => {
    const { fake } = makeFakeAutoUpdater();
    const { wc, sent } = makeFakeWebContents();
    const c = new UpdaterController(fake, () => wc);
    c.checkManual(true);
    expect(sent[0]).toEqual({
      channel: "archi:updater-status",
      payload: { kind: "checking", payload: undefined, manual: true }
    });
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("marks the resolving status as manual after a user-initiated check", () => {
    const { fake, fire } = makeFakeAutoUpdater();
    const { wc, sent } = makeFakeWebContents();
    const c = new UpdaterController(fake, () => wc);
    c.checkManual(true);
    fire("update-not-available");
    expect(sent[1]).toEqual({
      channel: "archi:updater-status",
      payload: { kind: "none", payload: undefined, manual: true }
    });
  });

  it("marks a check failure as manual after a user-initiated check", () => {
    const { fake, fire } = makeFakeAutoUpdater();
    const { wc, sent } = makeFakeWebContents();
    const c = new UpdaterController(fake, () => wc);
    c.checkManual(true);
    fire("error", new Error("offline"));
    expect(sent[1]).toEqual({
      channel: "archi:updater-status",
      payload: { kind: "error", payload: { message: "offline" }, manual: true }
    });
  });

  it("clears the manual flag so a later background result stays silent", () => {
    const { fake, fire } = makeFakeAutoUpdater();
    const { wc, sent } = makeFakeWebContents();
    const c = new UpdaterController(fake, () => wc);
    c.checkManual(true);
    fire("update-not-available");
    c.checkOnLaunch(true);
    fire("update-not-available");
    expect(sent[2]).toEqual({
      channel: "archi:updater-status",
      payload: { kind: "none", payload: undefined }
    });
    expect(sent[2].payload).not.toHaveProperty("manual");
  });

  it("does not mark a background check's result as manual", () => {
    const { fake, fire } = makeFakeAutoUpdater();
    const { wc, sent } = makeFakeWebContents();
    const c = new UpdaterController(fake, () => wc);
    c.checkOnLaunch(true);
    fire("update-not-available");
    expect(sent[0]).toEqual({
      channel: "archi:updater-status",
      payload: { kind: "none", payload: undefined }
    });
    expect(sent[0].payload).not.toHaveProperty("manual");
  });

  it("forwards download() to autoUpdater.downloadUpdate", () => {
    const { fake } = makeFakeAutoUpdater();
    const { wc } = makeFakeWebContents();
    const c = new UpdaterController(fake, () => wc);
    void c.download();
    expect(fake.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("forwards quitAndInstall to autoUpdater.quitAndInstall", () => {
    const { fake } = makeFakeAutoUpdater();
    const { wc } = makeFakeWebContents();
    const c = new UpdaterController(fake, () => wc);
    c.quitAndInstall();
    expect(fake.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("does not throw if getWebContents returns null at event time", () => {
    const { fake, fire } = makeFakeAutoUpdater();
    new UpdaterController(fake, () => null);
    expect(() => fire("update-not-available")).not.toThrow();
  });
});
