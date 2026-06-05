import fs from "node:fs";
import { session, net, type Session } from "electron";
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
    }
  ) {}

  /**
   * Make a single authenticated HTTP request to the notebook URL with the
   * persisted Amazon cookies and infer connection state from the response.
   *
   * - 200 OK on the notebook origin/path → "connected"
   * - 3xx redirect whose Location lands on /ap/signin or any other
   *   amazon.com auth path → "needs_auth"
   * - everything else → throw, so the caller leaves status untouched
   *
   * This intentionally uses Electron's net module + session.cookies rather
   * than a Playwright browser: Amazon's anti-bot fingerprints headless
   * Chromium and serves a signin redirect even with valid cookies. A plain
   * HTTP request from a normal Chromium net stack avoids that signal.
   */
  async validate(): Promise<CloudConnectorStatus> {
    const storageState = this.readStorageState();
    const cloudSession = await this.prepareSession(storageState.cookies ?? []);

    return new Promise<CloudConnectorStatus>((resolve, reject) => {
      const request = net.request({
        url: this.options.notebookUrl,
        method: "GET",
        redirect: "manual",
        session: cloudSession,
        useSessionCookies: true
      });

      // Drop a few headers to look like a normal navigation.
      request.setHeader(
        "Accept",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
      );
      request.setHeader("Accept-Language", "en-US,en;q=0.9");
      request.setHeader("Cache-Control", "no-cache");
      request.setHeader("Upgrade-Insecure-Requests", "1");

      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        fn();
      };

      request.on("response", (response) => {
        // Drain the body so the socket can be released; we only care about
        // status + Location header.
        response.on("data", () => undefined);
        response.on("end", () => undefined);

        const status = response.statusCode;
        if (status >= 200 && status < 300) {
          finish(() => resolve("connected"));
          return;
        }
        if (status >= 300 && status < 400) {
          const rawLocation = response.headers["location"];
          const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
          if (typeof location === "string" && /\/(ap\/signin|sign-in)/i.test(location)) {
            finish(() => resolve("needs_auth"));
          } else {
            // Unexpected redirect (MFA, captcha, interstitial). Anything
            // other than a clean 200 means the session isn't currently
            // letting us into the notebook.
            finish(() => resolve("needs_auth"));
          }
          return;
        }
        finish(() => reject(new Error(`unexpected status ${status}`)));
      });

      request.on("error", (error) => {
        finish(() => reject(error));
      });

      request.end();
    });
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
