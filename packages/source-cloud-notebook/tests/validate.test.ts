import { describe, expect, it, vi } from "vitest";
import { validate, type PageLike } from "../src/validation-report.js";

type CookieRecord = { name: string; domain: string; path: string };

function makePage(overrides: {
  finalUrl: string;
  loginFormVisible?: boolean;
  notebookDomPresent?: boolean;
  cookies?: CookieRecord[];
  gotoThrows?: boolean;
}): PageLike {
  return {
    url: vi.fn(() => overrides.finalUrl),
    goto: vi.fn(async () => {
      if (overrides.gotoThrows) {
        throw new Error("net::ERR_TIMED_OUT");
      }
    }),
    waitForLoadState: vi.fn(async () => undefined),
    isLoginFormVisible: vi.fn(async () => overrides.loginFormVisible ?? false),
    isNotebookDomPresent: vi.fn(async () => overrides.notebookDomPresent ?? false),
    getCookies: vi.fn(async () => overrides.cookies ?? [])
  };
}

const fileShape = {
  storageStateFileExists: true,
  storageStateFileSizeBytes: 4096,
  profileDirExists: true,
  profileDirEntryCount: 30
};

describe("validate", () => {
  it("returns connected + ok when notebook DOM present and no login form", async () => {
    const page = makePage({
      finalUrl: "https://read.amazon.com/kp/notebook",
      notebookDomPresent: true,
      cookies: [
        { name: "at-main", domain: ".amazon.com", path: "/" },
        { name: "ubid-main", domain: ".amazon.com", path: "/" }
      ]
    });
    const report = await validate(page, {
      notebookUrl: "https://read.amazon.com/kp/notebook",
      phase: "fetch",
      headless: true,
      artifactStats: fileShape
    });
    expect(report.outcome).toBe("connected");
    expect(report.decisionReasonCode).toBe("ok");
    expect(report.urlClassification).toBe("notebook");
    expect(report.cookieJarSize).toBe(2);
    expect(report.hasAtMainCookie).toBe(true);
    expect(report.hasUbidMainCookie).toBe(true);
  });

  it("returns needs_auth + signin_url_redirect when final url is sign-in", async () => {
    const page = makePage({ finalUrl: "https://www.amazon.com/ap/signin?openid.return_to=…" });
    const report = await validate(page, {
      notebookUrl: "https://read.amazon.com/kp/notebook",
      phase: "status_refresh",
      headless: true,
      artifactStats: fileShape
    });
    expect(report.outcome).toBe("needs_auth");
    expect(report.decisionReasonCode).toBe("signin_url_redirect");
  });

  it("returns needs_auth + login_form_visible when form is visible on a notebook url", async () => {
    const page = makePage({
      finalUrl: "https://read.amazon.com/kp/notebook",
      loginFormVisible: true
    });
    const report = await validate(page, {
      notebookUrl: "https://read.amazon.com/kp/notebook",
      phase: "fetch",
      headless: true,
      artifactStats: fileShape
    });
    expect(report.outcome).toBe("needs_auth");
    expect(report.decisionReasonCode).toBe("login_form_visible");
  });

  it("returns needs_auth + cookies_empty_on_load when cookie jar is empty", async () => {
    const page = makePage({
      finalUrl: "https://read.amazon.com/kp/notebook",
      cookies: []
    });
    const report = await validate(page, {
      notebookUrl: "https://read.amazon.com/kp/notebook",
      phase: "startup",
      headless: true,
      artifactStats: fileShape
    });
    expect(report.outcome).toBe("needs_auth");
    expect(report.decisionReasonCode).toBe("cookies_empty_on_load");
  });

  it("returns transient + notebook_dom_missing when notebook url loads but DOM absent and no login form", async () => {
    const page = makePage({
      finalUrl: "https://read.amazon.com/kp/notebook",
      cookies: [{ name: "at-main", domain: ".amazon.com", path: "/" }],
      notebookDomPresent: false
    });
    const report = await validate(page, {
      notebookUrl: "https://read.amazon.com/kp/notebook",
      phase: "fetch",
      headless: true,
      artifactStats: fileShape
    });
    expect(report.outcome).toBe("transient");
    expect(report.decisionReasonCode).toBe("notebook_dom_missing");
  });

  it("returns transient + interstitial_unrecognized for an unknown amazon page", async () => {
    const page = makePage({
      finalUrl: "https://www.amazon.com/gp/yourstore/home",
      cookies: [{ name: "at-main", domain: ".amazon.com", path: "/" }]
    });
    const report = await validate(page, {
      notebookUrl: "https://read.amazon.com/kp/notebook",
      phase: "fetch",
      headless: true,
      artifactStats: fileShape
    });
    expect(report.outcome).toBe("transient");
    expect(report.decisionReasonCode).toBe("interstitial_unrecognized");
  });

  it("returns needs_auth + goto_failed when goto throws", async () => {
    const page = makePage({
      finalUrl: "https://read.amazon.com/kp/notebook",
      gotoThrows: true
    });
    const report = await validate(page, {
      notebookUrl: "https://read.amazon.com/kp/notebook",
      phase: "fetch",
      headless: true,
      artifactStats: fileShape
    });
    expect(report.outcome).toBe("needs_auth");
    expect(report.decisionReasonCode).toBe("goto_failed");
    expect(report.errorMessage).toContain("ERR_TIMED_OUT");
  });

  it("stamps timestamp, phase, headless, and artifact stats verbatim", async () => {
    const page = makePage({
      finalUrl: "https://read.amazon.com/kp/notebook",
      notebookDomPresent: true,
      cookies: [{ name: "at-main", domain: ".amazon.com", path: "/" }]
    });
    const before = Date.now();
    const report = await validate(page, {
      notebookUrl: "https://read.amazon.com/kp/notebook",
      phase: "reconnect",
      headless: false,
      artifactStats: {
        storageStateFileExists: false,
        storageStateFileSizeBytes: 0,
        profileDirExists: true,
        profileDirEntryCount: 7
      }
    });
    expect(report.phase).toBe("reconnect");
    expect(report.headless).toBe(false);
    expect(report.storageStateFileExists).toBe(false);
    expect(report.profileDirEntryCount).toBe(7);
    const stamped = Date.parse(report.timestamp);
    expect(stamped).toBeGreaterThanOrEqual(before);
  });
});
