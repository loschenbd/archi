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
  if (path.startsWith("/kp/notebook")) {
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
