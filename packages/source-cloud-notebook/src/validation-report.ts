import fs from "node:fs";

export type ValidationPhase = "startup" | "reconnect" | "fetch" | "status_refresh";

export type ValidationOutcome = "connected" | "needs_auth" | "transient";

export type UrlClassification =
  | "notebook"
  | "signin"
  | "mfa"
  | "captcha"
  | "interstitial_continue_shopping"
  | "interstitial_other"
  | "unknown";

export type DecisionReasonCode =
  | "ok"
  | "signin_url_redirect"
  | "login_form_visible"
  | "notebook_dom_missing"
  | "goto_failed"
  | "cookies_empty_on_load"
  | "interstitial_unrecognized"
  | "unknown_error";

export type CloudValidationReport = {
  timestamp: string;
  phase: ValidationPhase;
  headless: boolean;
  finalUrl: string;
  urlClassification: UrlClassification;
  loginFormVisible: boolean;
  notebookDomPresent: boolean;
  cookieJarSize: number;
  hasAtMainCookie: boolean;
  hasUbidMainCookie: boolean;
  storageStateFileExists: boolean;
  storageStateFileSizeBytes: number;
  profileDirExists: boolean;
  profileDirEntryCount: number;
  outcome: ValidationOutcome;
  decisionReasonCode: DecisionReasonCode;
  errorMessage?: string;
  errorStack?: string;
};

export function classifyUrl(rawUrl: string): UrlClassification {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "unknown";
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (!/(^|\.)amazon\.[a-z]+(\.[a-z]+)?$/.test(host)) {
    return "unknown";
  }
  // Amazon serves the actual Kindle notebook at /notebook (current) and historically at
  // /kp/notebook — both reach the same UI on read.amazon.com. Recognize both so a page
  // with the notebook DOM doesn't get misclassified as `interstitial_other`.
  if (path === "/notebook" || path.startsWith("/notebook/") || path.startsWith("/kp/notebook")) {
    return "notebook";
  }
  if (path.includes("/ap/signin") || path.includes("/sign-in")) {
    return "signin";
  }
  if (path.includes("/ap/mfa") || path.includes("/ap/challenge")) {
    return "mfa";
  }
  if (path.includes("/errors/validatecaptcha") || path.includes("/captcha")) {
    return "captcha";
  }
  if (path.includes("/ap/cnep") || parsed.search.toLowerCase().includes("continue=")) {
    return "interstitial_continue_shopping";
  }
  return "interstitial_other";
}

const MAX_LOG_BYTES = 1024 * 1024;

export function appendValidationReport(logPath: string, report: CloudValidationReport): void {
  try {
    let size = 0;
    try {
      size = fs.statSync(logPath).size;
    } catch {
      size = 0;
    }
    if (size > MAX_LOG_BYTES) {
      const rotated = `${logPath}.1`;
      try {
        fs.rmSync(rotated, { force: true });
      } catch {
        // ignore
      }
      fs.renameSync(logPath, rotated);
    }
    fs.appendFileSync(logPath, `${JSON.stringify(report)}\n`, "utf8");
  } catch (error) {
    // Telemetry must never throw. Log to console and move on.
    // eslint-disable-next-line no-console
    console.warn("[cloud-validation] append failed:", (error as Error).message);
  }
}

export type PageCookie = { name: string; domain: string; path: string };

export type PageLike = {
  url(): string;
  goto(url: string, opts?: { waitUntil?: "domcontentloaded" | "load" | "networkidle"; timeout?: number }): Promise<unknown>;
  waitForLoadState(state: "domcontentloaded" | "load" | "networkidle"): Promise<void>;
  isLoginFormVisible(): Promise<boolean>;
  isNotebookDomPresent(): Promise<boolean>;
  getCookies(): Promise<PageCookie[]>;
};

export type ArtifactStats = {
  storageStateFileExists: boolean;
  storageStateFileSizeBytes: number;
  profileDirExists: boolean;
  profileDirEntryCount: number;
};

export type ValidateOptions = {
  notebookUrl: string;
  phase: ValidationPhase;
  headless: boolean;
  artifactStats: ArtifactStats;
};

export async function validate(page: PageLike, options: ValidateOptions): Promise<CloudValidationReport> {
  const timestamp = new Date().toISOString();
  const baseReport: CloudValidationReport = {
    timestamp,
    phase: options.phase,
    headless: options.headless,
    finalUrl: "",
    urlClassification: "unknown",
    loginFormVisible: false,
    notebookDomPresent: false,
    cookieJarSize: 0,
    hasAtMainCookie: false,
    hasUbidMainCookie: false,
    ...options.artifactStats,
    outcome: "needs_auth",
    decisionReasonCode: "unknown_error"
  };

  try {
    await page.goto(options.notebookUrl, { waitUntil: "domcontentloaded" });
  } catch (error) {
    return {
      ...baseReport,
      finalUrl: page.url(),
      urlClassification: classifyUrl(page.url()),
      outcome: "needs_auth",
      decisionReasonCode: "goto_failed",
      errorMessage: (error as Error).message,
      errorStack: (error as Error).stack
    };
  }

  // Best-effort: wait for network idle, but don't fail validation on it.
  await page.waitForLoadState("networkidle").catch(() => undefined);

  const finalUrl = page.url();
  const urlClassification = classifyUrl(finalUrl);
  const loginFormVisible = await page.isLoginFormVisible().catch(() => false);
  const notebookDomPresent = await page.isNotebookDomPresent().catch(() => false);
  const cookies = await page.getCookies().catch(() => [] as PageCookie[]);
  const hasAtMainCookie = cookies.some((c) => c.name === "at-main");
  const hasUbidMainCookie = cookies.some((c) => c.name === "ubid-main");

  const report: CloudValidationReport = {
    ...baseReport,
    finalUrl,
    urlClassification,
    loginFormVisible,
    notebookDomPresent,
    cookieJarSize: cookies.length,
    hasAtMainCookie,
    hasUbidMainCookie
  };

  // Decision tree. Order matters: hard reasons first, then transient, then connected.
  if (urlClassification === "signin") {
    return { ...report, outcome: "needs_auth", decisionReasonCode: "signin_url_redirect" };
  }
  if (loginFormVisible) {
    return { ...report, outcome: "needs_auth", decisionReasonCode: "login_form_visible" };
  }
  if (cookies.length === 0) {
    return { ...report, outcome: "needs_auth", decisionReasonCode: "cookies_empty_on_load" };
  }
  if (urlClassification === "notebook" && notebookDomPresent) {
    return { ...report, outcome: "connected", decisionReasonCode: "ok" };
  }
  if (urlClassification === "notebook" && !notebookDomPresent) {
    return { ...report, outcome: "transient", decisionReasonCode: "notebook_dom_missing" };
  }
  // MFA, captcha, continue-shopping, interstitial_other, or unknown amazon page
  // Treated as transient — connector may retry or surface to the user via diagnostics.
  return { ...report, outcome: "transient", decisionReasonCode: "interstitial_unrecognized" };
}

export type DumpAuthArtifactsInput = {
  storageStatePath: string;
  profilePath?: string;
};

export function dumpAuthArtifactsState(input: DumpAuthArtifactsInput): ArtifactStats {
  let storageStateFileExists = false;
  let storageStateFileSizeBytes = 0;
  try {
    const stat = fs.statSync(input.storageStatePath);
    storageStateFileExists = stat.isFile();
    storageStateFileSizeBytes = storageStateFileExists ? stat.size : 0;
  } catch {
    storageStateFileExists = false;
    storageStateFileSizeBytes = 0;
  }

  let profileDirExists = false;
  let profileDirEntryCount = 0;
  if (input.profilePath) {
    try {
      const stat = fs.statSync(input.profilePath);
      profileDirExists = stat.isDirectory();
      if (profileDirExists) {
        profileDirEntryCount = fs.readdirSync(input.profilePath).length;
      }
    } catch {
      profileDirExists = false;
      profileDirEntryCount = 0;
    }
  }

  return { storageStateFileExists, storageStateFileSizeBytes, profileDirExists, profileDirEntryCount };
}

export type StorageStateCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

type CookieKey = { name: string; domain: string; path: string };

export function parseStorageStateCookies(storageStatePath: string): StorageStateCookie[] {
  let raw: string;
  try {
    raw = fs.readFileSync(storageStatePath, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }
  const cookiesField = (parsed as { cookies?: unknown }).cookies;
  if (!Array.isArray(cookiesField)) {
    return [];
  }
  const result: StorageStateCookie[] = [];
  for (const entry of cookiesField) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { name?: unknown }).name === "string" &&
      typeof (entry as { domain?: unknown }).domain === "string" &&
      typeof (entry as { path?: unknown }).path === "string"
    ) {
      result.push(entry as StorageStateCookie);
    }
  }
  return result;
}

export function filterNewCookies<T extends CookieKey>(incoming: T[], existing: CookieKey[]): T[] {
  const key = (c: CookieKey): string => `${c.name}|${c.domain}|${c.path}`;
  const existingKeys = new Set(existing.map(key));
  return incoming.filter((cookie) => !existingKeys.has(key(cookie)));
}
