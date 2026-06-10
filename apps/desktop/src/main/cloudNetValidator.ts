import fs from "node:fs";
import { session, BrowserWindow, type Session } from "electron";
import type { CloudConnectorStatus, CloudNetValidator } from "@archi/source-cloud-notebook";

type StorageStateCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None" | "no_restriction" | "lax" | "strict" | "none" | "unspecified";
};

type StorageState = {
  cookies?: StorageStateCookie[];
};

function normalizeSameSite(
  raw: StorageStateCookie["sameSite"]
): "unspecified" | "no_restriction" | "lax" | "strict" {
  switch ((raw ?? "").toLowerCase()) {
    case "strict":
      return "strict";
    case "lax":
      return "lax";
    case "none":
    case "no_restriction":
      return "no_restriction";
    default:
      return "unspecified";
  }
}

function urlFor(cookie: StorageStateCookie): string {
  const host = cookie.domain.replace(/^\./, "");
  const scheme = cookie.secure ? "https" : "http";
  return `${scheme}://${host}${cookie.path || "/"}`;
}

export class ElectronCloudNetValidator implements CloudNetValidator {
  constructor(
    private readonly options: {
      notebookUrl: string;
      storageStatePath: string;
      partition?: string;
      onDebug?: (message: string) => void;
    }
  ) {}

  private log(message: string): void {
    this.options.onDebug?.(message);
    // Mirror to console so it shows up in the dev log alongside Playwright
    // output. Tagged so it's grep-friendly.
    // eslint-disable-next-line no-console
    console.log(`[cloud-net-validator] ${message}`);
  }

  /**
   * Validate the cloud-notebook session by loading the notebook URL in a
   * hidden Electron BrowserWindow. We rely on JS execution because Amazon's
   * /ap/signin flow auto-submits an openid form to silently re-authenticate
   * when valid cookies are present — a plain HTTP request can't complete
   * that handshake. BrowserWindow with show:false is a real Chromium with
   * no headless flag, so Amazon's anti-bot accepts it.
   *
   * Outcome is decided by the *final* URL after all redirects settle:
   *   /notebook (kp- or current path) → connected
   *   /ap/signin                       → needs_auth
   *   any other amazon page            → needs_auth (treated as interstitial)
   */
  async validate(): Promise<CloudConnectorStatus> {
    this.log(`validate() start — url=${this.options.notebookUrl}`);
    const storageState = this.readStorageState();
    const cookieCount = storageState.cookies?.length ?? 0;
    this.log(`storage state cookies=${cookieCount}`);
    const cloudSession = await this.prepareSession(storageState.cookies ?? []);
    const seededCookies = await cloudSession.cookies.get({});
    const amazonCookies = seededCookies.filter((c) => /amazon\./i.test(c.domain ?? ""));
    this.log(
      `session seeded — total=${seededCookies.length} amazon=${amazonCookies.length} ` +
        `hasAtMain=${amazonCookies.some((c) => c.name === "at-main")} ` +
        `hasUbidMain=${amazonCookies.some((c) => c.name === "ubid-main")}`
    );

    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        session: cloudSession,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        offscreen: false
      }
    });

    try {
      const result = await this.loadAndClassify(win);
      this.log(`final url=${win.webContents.getURL().slice(0, 180)} → ${result}`);
      return result;
    } catch (error) {
      this.log(`load failed: ${(error as Error).message}`);
      throw error;
    } finally {
      // Defer destroy so any in-flight nav events finish cleanly.
      setTimeout(() => {
        if (!win.isDestroyed()) win.destroy();
      }, 0);
    }
  }

  private async loadAndClassify(win: BrowserWindow): Promise<CloudConnectorStatus> {
    const overallTimeoutMs = 20_000;

    const navigation = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`navigation timeout after ${overallTimeoutMs}ms`));
      }, overallTimeoutMs);

      // Resolve on either did-finish-load (page settled) or did-fail-load
      // (terminal navigation error). We don't reject on fail-load — many
      // Amazon redirect chains emit fail-load on aborted intermediate
      // navigations, and the final URL is still the source of truth.
      const onSettled = (): void => {
        clearTimeout(timer);
        resolve();
      };
      win.webContents.once("did-finish-load", onSettled);
      win.webContents.once("did-fail-load", onSettled);
    });

    await win.loadURL(this.options.notebookUrl).catch(() => undefined);
    await navigation;

    const finalUrl = win.webContents.getURL();
    return this.classify(finalUrl);
  }

  private classify(finalUrl: string): CloudConnectorStatus {
    try {
      const parsed = new URL(finalUrl);
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();
      if (!/(^|\.)amazon\.[a-z]+(\.[a-z]+)?$/.test(host)) {
        return "needs_auth";
      }
      if (
        path.startsWith("/kp/notebook") ||
        path === "/notebook" ||
        path.startsWith("/notebook/")
      ) {
        return "connected";
      }
      // /ap/signin, /ap/cnep, /ap/mfa, /errors/validatecaptcha, or any
      // unfamiliar interstitial — session isn't currently letting us in.
      return "needs_auth";
    } catch {
      return "needs_auth";
    }
  }

  private readStorageState(): StorageState {
    if (!fs.existsSync(this.options.storageStatePath)) {
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(this.options.storageStatePath, "utf8")) as StorageState;
    } catch {
      return {};
    }
  }

  private async prepareSession(cookies: StorageStateCookie[]): Promise<Session> {
    const cloudSession = session.fromPartition(
      this.options.partition ?? "persist:archi-cloud-net-validator"
    );

    // Clear stale cookies for amazon.* hosts before re-seeding so we don't
    // carry over state from a prior session that may differ from the
    // current storage state file on disk.
    const existing = await cloudSession.cookies.get({});
    await Promise.all(
      existing
        .filter((c) => /amazon\./i.test(c.domain ?? ""))
        .map((c) => {
          const host = (c.domain ?? "").replace(/^\./, "");
          const scheme = c.secure ? "https" : "http";
          const url = `${scheme}://${host}${c.path ?? "/"}`;
          return cloudSession.cookies.remove(url, c.name).catch(() => undefined);
        })
    );

    await Promise.all(
      cookies.map(async (cookie) => {
        try {
          await cloudSession.cookies.set({
            url: urlFor(cookie),
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path || "/",
            secure: cookie.secure ?? false,
            httpOnly: cookie.httpOnly ?? false,
            sameSite: normalizeSameSite(cookie.sameSite),
            expirationDate: typeof cookie.expires === "number" && cookie.expires > 0 ? cookie.expires : undefined
          });
        } catch {
          // Some cookies (e.g., __Secure- prefix without HTTPS scheme match)
          // can fail to set; skip individually.
        }
      })
    );

    return cloudSession;
  }
}
