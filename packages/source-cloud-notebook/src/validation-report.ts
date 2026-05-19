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
