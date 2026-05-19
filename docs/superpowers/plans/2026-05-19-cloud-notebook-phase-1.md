# Cloud Notebook Phase 1 — Diagnostic Instrumentation + Eager Fix A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured diagnostics to the cloud notebook connector so we can see *why* validation flips to `needs_auth`, and eagerly fix the write-only `storageState` bug so the JSON file becomes a usable cookie source.

**Architecture:** All work lives in two existing files (`packages/source-cloud-notebook/src/index.ts`, `apps/desktop/src/main/connections.ts`) plus one new module (`packages/source-cloud-notebook/src/validation-report.ts`), the desktop main entry, preload, the Connections screen, and one paragraph in `docs/architecture.md`. The connector emits structured `CloudValidationReport` objects; the desktop adapter persists them to a JSONL log + ring buffer and surfaces the latest report on the cloud-notebook `ConnectionState`.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` extensions on TS imports), Playwright `^1.53`, Electron `^31`, React `^18`, Vitest. Package namespace `@archi/*`. Test runner is `vitest run --passWithNoTests`. Repository is not yet under git; "commit" steps in this plan describe the logical commit unit — apply them once a git repo exists, or skip the literal command.

**Scope:** Phase 1 only. Phase 2 fixes (B offscreen-headed Chromium, C transient-tolerance decision policy, D cold-start retry) are intentionally **NOT** in this plan; they will be selected and planned based on the Phase 1 log evidence. This plan does ship the `chromiumMode` option scaffolding (defaulted to `"legacy_headless"` to preserve today's behavior) so Phase 2 can flip the default with a one-line change.

**Spec:** `docs/superpowers/specs/2026-05-19-cloud-notebook-connection-design.md`

---

## File structure

**New files (1):**
- `packages/source-cloud-notebook/src/validation-report.ts` — types (`CloudValidationReport`, `DecisionReasonCode`, `ValidationPhase`, `ValidationOutcome`, `UrlClassification`), pure helpers (`classifyUrl`, `validate`, `dumpAuthArtifactsState`, `parseStorageStateCookies`, `filterNewCookies`), JSONL writer (`appendValidationReport`).

**New test files (4):**
- `packages/source-cloud-notebook/tests/classify-url.test.ts`
- `packages/source-cloud-notebook/tests/append-validation-report.test.ts`
- `packages/source-cloud-notebook/tests/validate.test.ts`
- `packages/source-cloud-notebook/tests/cookie-merge.test.ts`
- `packages/source-cloud-notebook/tests/dump-auth-artifacts.test.ts`
- `apps/desktop/tests/cloud-validation-adapter.test.ts` (adapter decision-policy)

**Modified files (6):**
- `packages/source-cloud-notebook/src/index.ts` — exports `CloudValidationReport` and friends from `validation-report.ts`; `PlaywrightCloudNotebookConnector` gains `chromiumMode` and `onValidation` options, a `runChromiumOptions` helper, `validateNotebookAccess` (wraps `validate`), and an `openContext` that merges storage-state cookies into the persistent context.
- `apps/desktop/src/main/connections.ts` — `CloudNotebookConnectionAdapter` constructor takes a logger handle; surfaces latest report in metadata; ring buffer + log path.
- `apps/desktop/src/main/index.ts` — constructs the adapter with `onValidation` wiring + JSONL log path under `app.getPath("userData")`; registers two new IPC channels.
- `apps/desktop/src/preload/index.ts` — exposes `getRecentValidations` and `openValidationLog` on the existing `window.archi` API.
- `apps/desktop/src/renderer/screens/ConnectionsScreen.tsx` — adds a collapsed "Diagnostics" disclosure to the Kindle Highlights (cloud notebook) card.
- `docs/architecture.md` — one paragraph under "Connection model" describing the validation-report telemetry channel.

**Files that stay focused (boundary check):**
- `validation-report.ts` owns *facts*: types, pure helpers, file I/O. No Electron, no policy.
- `index.ts` (connector) owns *Playwright integration*: opens contexts, drives pages, emits reports.
- `connections.ts` (adapter) owns *policy*: ring buffer, when to surface what to the UI.
- `index.ts` (main) owns *Electron wiring*: file paths, IPC handlers, shell calls.

---

## Task 1: Define `CloudValidationReport` types and `classifyUrl` pure function

**Files:**
- Create: `packages/source-cloud-notebook/src/validation-report.ts`
- Test: `packages/source-cloud-notebook/tests/classify-url.test.ts`

`classifyUrl` is the simplest piece of the validation pipeline and the easiest to test in isolation. Get the types and this helper down first.

- [ ] **Step 1: Write the failing test**

Create `packages/source-cloud-notebook/tests/classify-url.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { classifyUrl } from "../src/validation-report.js";

describe("classifyUrl", () => {
  it("returns notebook for the notebook path", () => {
    expect(classifyUrl("https://read.amazon.com/kp/notebook")).toBe("notebook");
    expect(classifyUrl("https://read.amazon.com/kp/notebook?asin=B01FPGY5T0")).toBe("notebook");
  });

  it("detects sign-in pages", () => {
    expect(classifyUrl("https://www.amazon.com/ap/signin?openid.return_to=…")).toBe("signin");
    expect(classifyUrl("https://www.amazon.com/gp/sign-in.html")).toBe("signin");
  });

  it("detects MFA and captcha challenges", () => {
    expect(classifyUrl("https://www.amazon.com/ap/mfa")).toBe("mfa");
    expect(classifyUrl("https://www.amazon.com/errors/validateCaptcha")).toBe("captcha");
  });

  it("detects continue-shopping interstitial", () => {
    expect(classifyUrl("https://www.amazon.com/ap/cnep?continue=…")).toBe("interstitial_continue_shopping");
  });

  it("classifies any other amazon page as interstitial_other", () => {
    expect(classifyUrl("https://www.amazon.com/gp/yourstore/home")).toBe("interstitial_other");
  });

  it("returns unknown for non-amazon hosts and invalid urls", () => {
    expect(classifyUrl("https://example.com/anywhere")).toBe("unknown");
    expect(classifyUrl("not a url at all")).toBe("unknown");
    expect(classifyUrl("")).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm --filter @archi/source-cloud-notebook test
```

Expected: failure with "Cannot find module '../src/validation-report.js'" or "classifyUrl is not exported".

- [ ] **Step 3: Implement the module**

Create `packages/source-cloud-notebook/src/validation-report.ts`:

```typescript
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
  const host = parsed.host.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (!/(^|\.)amazon\.[a-z.]+$/.test(host) && !/(^|\.)amazon\.com$/.test(host)) {
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
```

- [ ] **Step 4: Run the test, confirm it passes**

```
pnpm --filter @archi/source-cloud-notebook test
```

Expected: all 6 `classifyUrl` tests pass.

- [ ] **Step 5: Logical commit**

```
git add packages/source-cloud-notebook/src/validation-report.ts \
        packages/source-cloud-notebook/tests/classify-url.test.ts
git commit -m "cloud-notebook: add validation-report types and classifyUrl helper"
```

(Skip if repo is not yet under git; just note the boundary.)

---

## Task 2: `appendValidationReport` with size-based rotation

**Files:**
- Modify: `packages/source-cloud-notebook/src/validation-report.ts`
- Test: `packages/source-cloud-notebook/tests/append-validation-report.test.ts`

Pure file I/O — given a path and a report, append a JSON line; if the file is over 1 MB, rotate it to `.log.1` and start a new file.

- [ ] **Step 1: Write the failing test**

Create `packages/source-cloud-notebook/tests/append-validation-report.test.ts`:

```typescript
import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendValidationReport,
  type CloudValidationReport
} from "../src/validation-report.js";

function makeReport(overrides: Partial<CloudValidationReport> = {}): CloudValidationReport {
  return {
    timestamp: "2026-05-19T12:00:00.000Z",
    phase: "startup",
    headless: true,
    finalUrl: "https://read.amazon.com/kp/notebook",
    urlClassification: "notebook",
    loginFormVisible: false,
    notebookDomPresent: true,
    cookieJarSize: 12,
    hasAtMainCookie: true,
    hasUbidMainCookie: true,
    storageStateFileExists: true,
    storageStateFileSizeBytes: 5120,
    profileDirExists: true,
    profileDirEntryCount: 42,
    outcome: "connected",
    decisionReasonCode: "ok",
    ...overrides
  };
}

describe("appendValidationReport", () => {
  it("appends one JSONL line per call", () => {
    const dir = mkdtempSync(join(tmpdir(), "cloud-val-"));
    const logPath = join(dir, "cloud-validation.log");

    appendValidationReport(logPath, makeReport());
    appendValidationReport(logPath, makeReport({ outcome: "needs_auth", decisionReasonCode: "login_form_visible" }));

    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).outcome).toBe("connected");
    expect(JSON.parse(lines[1]).outcome).toBe("needs_auth");
  });

  it("rotates to .log.1 when current file exceeds 1 MB", () => {
    const dir = mkdtempSync(join(tmpdir(), "cloud-val-"));
    const logPath = join(dir, "cloud-validation.log");
    writeFileSync(logPath, "x".repeat(1024 * 1024 + 1), "utf8");

    appendValidationReport(logPath, makeReport({ decisionReasonCode: "ok" }));

    expect(existsSync(`${logPath}.1`)).toBe(true);
    const newSize = statSync(logPath).size;
    expect(newSize).toBeLessThan(2048);
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).decisionReasonCode).toBe("ok");
  });

  it("overwrites an existing .log.1 on rotation (single generation)", () => {
    const dir = mkdtempSync(join(tmpdir(), "cloud-val-"));
    const logPath = join(dir, "cloud-validation.log");
    writeFileSync(`${logPath}.1`, "old-generation\n", "utf8");
    writeFileSync(logPath, "y".repeat(1024 * 1024 + 1), "utf8");

    appendValidationReport(logPath, makeReport());

    expect(readFileSync(`${logPath}.1`, "utf8")).not.toContain("old-generation");
  });

  it("does not throw on write failures", () => {
    expect(() => appendValidationReport("/this/path/does/not/exist/log", makeReport())).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm --filter @archi/source-cloud-notebook test -- append-validation-report
```

Expected: failure — `appendValidationReport` is not exported yet.

- [ ] **Step 3: Implement `appendValidationReport`**

Append to `packages/source-cloud-notebook/src/validation-report.ts`:

```typescript
import fs from "node:fs";

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
```

- [ ] **Step 4: Run the test, confirm it passes**

```
pnpm --filter @archi/source-cloud-notebook test -- append-validation-report
```

Expected: all 4 tests pass.

- [ ] **Step 5: Logical commit**

```
git add packages/source-cloud-notebook/src/validation-report.ts \
        packages/source-cloud-notebook/tests/append-validation-report.test.ts
git commit -m "cloud-notebook: JSONL validation log with 1MB rotation"
```

---

## Task 3: `validate` pure function (mocked Page)

**Files:**
- Modify: `packages/source-cloud-notebook/src/validation-report.ts`
- Test: `packages/source-cloud-notebook/tests/validate.test.ts`

`validate` is the heart of the diagnostic system: given a `Page` and options, produce a `CloudValidationReport`. We define a structural type for the `Page` surface we use so we can mock it.

- [ ] **Step 1: Write the failing test**

Create `packages/source-cloud-notebook/tests/validate.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm --filter @archi/source-cloud-notebook test -- validate
```

Expected: failure — `validate` and `PageLike` not exported.

- [ ] **Step 3: Implement `validate` and `PageLike`**

Append to `packages/source-cloud-notebook/src/validation-report.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test, confirm it passes**

```
pnpm --filter @archi/source-cloud-notebook test -- validate
```

Expected: all 8 `validate` tests pass.

- [ ] **Step 5: Logical commit**

```
git add packages/source-cloud-notebook/src/validation-report.ts \
        packages/source-cloud-notebook/tests/validate.test.ts
git commit -m "cloud-notebook: validate() produces CloudValidationReport with reason codes"
```

---

## Task 4: `dumpAuthArtifactsState` helper

**Files:**
- Modify: `packages/source-cloud-notebook/src/validation-report.ts`
- Test: `packages/source-cloud-notebook/tests/dump-auth-artifacts.test.ts`

A small helper that snapshots the storage-state file and profile directory state. Used at connector startup to capture artifact health even before any validation runs.

- [ ] **Step 1: Write the failing test**

Create `packages/source-cloud-notebook/tests/dump-auth-artifacts.test.ts`:

```typescript
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dumpAuthArtifactsState } from "../src/validation-report.js";

describe("dumpAuthArtifactsState", () => {
  it("reports both artifacts present with sizes/counts", () => {
    const dir = mkdtempSync(join(tmpdir(), "artifacts-"));
    const storageStatePath = join(dir, "storage-state.json");
    const profilePath = join(dir, "profile");
    mkdirSync(profilePath);
    writeFileSync(storageStatePath, '{"cookies":[]}', "utf8");
    writeFileSync(join(profilePath, "Cookies"), "x".repeat(100), "utf8");
    writeFileSync(join(profilePath, "Preferences"), "{}", "utf8");

    const stats = dumpAuthArtifactsState({ storageStatePath, profilePath });
    expect(stats.storageStateFileExists).toBe(true);
    expect(stats.storageStateFileSizeBytes).toBe(14);
    expect(stats.profileDirExists).toBe(true);
    expect(stats.profileDirEntryCount).toBe(2);

    rmSync(dir, { recursive: true, force: true });
  });

  it("returns zeroed stats when both artifacts are missing", () => {
    const stats = dumpAuthArtifactsState({
      storageStatePath: "/nonexistent/storage-state.json",
      profilePath: "/nonexistent/profile"
    });
    expect(stats).toEqual({
      storageStateFileExists: false,
      storageStateFileSizeBytes: 0,
      profileDirExists: false,
      profileDirEntryCount: 0
    });
  });

  it("returns zeroed profile stats when profilePath is undefined", () => {
    const dir = mkdtempSync(join(tmpdir(), "artifacts-"));
    const storageStatePath = join(dir, "storage-state.json");
    writeFileSync(storageStatePath, '{"cookies":[]}', "utf8");

    const stats = dumpAuthArtifactsState({ storageStatePath });
    expect(stats.storageStateFileExists).toBe(true);
    expect(stats.profileDirExists).toBe(false);
    expect(stats.profileDirEntryCount).toBe(0);

    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm --filter @archi/source-cloud-notebook test -- dump-auth-artifacts
```

Expected: failure — `dumpAuthArtifactsState` not exported.

- [ ] **Step 3: Implement `dumpAuthArtifactsState`**

Append to `packages/source-cloud-notebook/src/validation-report.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test, confirm it passes**

```
pnpm --filter @archi/source-cloud-notebook test -- dump-auth-artifacts
```

Expected: all 3 tests pass.

- [ ] **Step 5: Logical commit**

```
git add packages/source-cloud-notebook/src/validation-report.ts \
        packages/source-cloud-notebook/tests/dump-auth-artifacts.test.ts
git commit -m "cloud-notebook: dumpAuthArtifactsState snapshots storage-state and profile dir"
```

---

## Task 5: Cookie merge helpers (eager Fix A)

**Files:**
- Modify: `packages/source-cloud-notebook/src/validation-report.ts`
- Test: `packages/source-cloud-notebook/tests/cookie-merge.test.ts`

Two pure helpers: parse Playwright `storageState.json` into a cookie list, and compute the subset of those cookies that are **not** already in a given context cookie jar. These power the eager Fix A in `openContext`.

- [ ] **Step 1: Write the failing test**

Create `packages/source-cloud-notebook/tests/cookie-merge.test.ts`:

```typescript
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStorageStateCookies, filterNewCookies } from "../src/validation-report.js";

describe("parseStorageStateCookies", () => {
  it("returns the cookies array from a valid storage-state file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ssc-"));
    const path = join(dir, "storage-state.json");
    writeFileSync(
      path,
      JSON.stringify({
        cookies: [
          { name: "at-main", value: "abc", domain: ".amazon.com", path: "/" },
          { name: "ubid-main", value: "xyz", domain: ".amazon.com", path: "/" }
        ],
        origins: []
      }),
      "utf8"
    );
    const cookies = parseStorageStateCookies(path);
    expect(cookies).toHaveLength(2);
    expect(cookies[0].name).toBe("at-main");
  });

  it("returns empty array when the file doesn't exist", () => {
    expect(parseStorageStateCookies("/no/such/file")).toEqual([]);
  });

  it("returns empty array when JSON is malformed (fails closed)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ssc-"));
    const path = join(dir, "broken.json");
    writeFileSync(path, "{not json", "utf8");
    expect(parseStorageStateCookies(path)).toEqual([]);
  });

  it("returns empty array when cookies field is missing or wrong shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "ssc-"));
    const path = join(dir, "no-cookies.json");
    writeFileSync(path, '{"origins":[]}', "utf8");
    expect(parseStorageStateCookies(path)).toEqual([]);
  });
});

describe("filterNewCookies", () => {
  it("returns all cookies when existing jar is empty", () => {
    const incoming = [
      { name: "at-main", value: "a", domain: ".amazon.com", path: "/" },
      { name: "ubid-main", value: "b", domain: ".amazon.com", path: "/" }
    ];
    expect(filterNewCookies(incoming, [])).toEqual(incoming);
  });

  it("filters out cookies that match on name+domain+path", () => {
    const existing = [{ name: "at-main", domain: ".amazon.com", path: "/" }];
    const incoming = [
      { name: "at-main", value: "new", domain: ".amazon.com", path: "/" },
      { name: "ubid-main", value: "new", domain: ".amazon.com", path: "/" }
    ];
    const result = filterNewCookies(incoming, existing);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("ubid-main");
  });

  it("treats different domains as different cookies", () => {
    const existing = [{ name: "at-main", domain: ".amazon.com", path: "/" }];
    const incoming = [{ name: "at-main", value: "new", domain: ".amazon.de", path: "/" }];
    const result = filterNewCookies(incoming, existing);
    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe(".amazon.de");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm --filter @archi/source-cloud-notebook test -- cookie-merge
```

Expected: failure — `parseStorageStateCookies` and `filterNewCookies` not exported.

- [ ] **Step 3: Implement the helpers**

Append to `packages/source-cloud-notebook/src/validation-report.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test, confirm it passes**

```
pnpm --filter @archi/source-cloud-notebook test
```

Expected: all tests across all five files pass.

- [ ] **Step 5: Logical commit**

```
git add packages/source-cloud-notebook/src/validation-report.ts \
        packages/source-cloud-notebook/tests/cookie-merge.test.ts
git commit -m "cloud-notebook: parseStorageStateCookies + filterNewCookies (Fix A helpers)"
```

---

## Task 6: Refactor connector — `chromiumMode`, cookie merge in `openContext`, `validateNotebookAccess`

**Files:**
- Modify: `packages/source-cloud-notebook/src/index.ts`

This task makes three coordinated changes to the connector. No new tests in this task — `validate()` is already tested in Task 3, and integration coverage for the full path comes from the existing manual smoke test. Type checking is the safety net here.

- [ ] **Step 1: Add `chromiumMode` and `onValidation` options + `runChromiumOptions`**

In `packages/source-cloud-notebook/src/index.ts`, extend the `PlaywrightCloudOptions` type and add a helper. Find the existing type around line 143:

```typescript
export type PlaywrightCloudOptions = {
  notebookUrl: string;
  storageStatePath: string;
  profilePath?: string;
  onNeedsAuth?: () => Promise<void>;
  onFetchProgress?: (event: CloudFetchStats) => void;
  onBookFetched?: (event: CloudBookDiscovery) => void;
  onDebug?: (message: string) => void;
};
```

Replace it with:

```typescript
import {
  type CloudValidationReport,
  type ValidationPhase,
  type ArtifactStats,
  validate,
  classifyUrl,
  dumpAuthArtifactsState,
  parseStorageStateCookies,
  filterNewCookies
} from "./validation-report.js";

export type ChromiumMode = "legacy_headless" | "new_headless" | "offscreen_headed" | "headed_visible";

export type PlaywrightCloudOptions = {
  notebookUrl: string;
  storageStatePath: string;
  profilePath?: string;
  chromiumMode?: ChromiumMode;
  onNeedsAuth?: () => Promise<void>;
  onFetchProgress?: (event: CloudFetchStats) => void;
  onBookFetched?: (event: CloudBookDiscovery) => void;
  onDebug?: (message: string) => void;
  onValidation?: (report: CloudValidationReport) => void;
};

type LaunchSpec = {
  headless: boolean;
  args: string[];
};

function runChromiumOptions(mode: ChromiumMode): LaunchSpec {
  switch (mode) {
    case "headed_visible":
      return { headless: false, args: [] };
    case "offscreen_headed":
      return { headless: false, args: ["--window-position=-2400,-2400", "--window-size=1280,900"] };
    case "new_headless":
      return { headless: true, args: ["--headless=new"] };
    case "legacy_headless":
    default:
      return { headless: true, args: [] };
  }
}
```

Re-export the new types so consumers can import them from the package root:

At the end of `packages/source-cloud-notebook/src/index.ts`, add:

```typescript
export type {
  CloudValidationReport,
  ValidationPhase,
  ValidationOutcome,
  UrlClassification,
  DecisionReasonCode,
  ArtifactStats
} from "./validation-report.js";
export { classifyUrl, validate, dumpAuthArtifactsState, appendValidationReport } from "./validation-report.js";
```

- [ ] **Step 2: Replace `openContext` with a version that respects `chromiumMode` and merges cookies**

Find the existing `private async openContext(options?: { interactive?: boolean })` (around line 339). Replace it with:

```typescript
private async openContext(options?: { interactive?: boolean }): Promise<{ browser?: Browser; context: BrowserContext }> {
  this.ensurePersistencePaths();

  const mode: ChromiumMode = options?.interactive
    ? "headed_visible"
    : this.options.chromiumMode ?? "legacy_headless";
  const launchSpec = runChromiumOptions(mode);

  if (this.options.profilePath) {
    const context = await chromium.launchPersistentContext(this.options.profilePath, {
      headless: launchSpec.headless,
      args: launchSpec.args
    });
    await this.mergeStorageStateCookies(context);
    return { context };
  }

  const browser = await chromium.launch({ headless: launchSpec.headless, args: launchSpec.args });
  const context = fs.existsSync(this.options.storageStatePath)
    ? await browser.newContext({ storageState: this.options.storageStatePath })
    : await browser.newContext();
  return { browser, context };
}

private async mergeStorageStateCookies(context: BrowserContext): Promise<void> {
  if (!fs.existsSync(this.options.storageStatePath)) {
    return;
  }
  const incoming = parseStorageStateCookies(this.options.storageStatePath);
  if (incoming.length === 0) {
    return;
  }
  const existing = await context.cookies();
  const newCookies = filterNewCookies(incoming, existing);
  if (newCookies.length === 0) {
    return;
  }
  try {
    await context.addCookies(newCookies);
    this.options.onDebug?.(`merged ${newCookies.length} cookies from storage-state into persistent profile`);
  } catch (error) {
    this.options.onDebug?.(`cookie merge failed: ${(error as Error).message}`);
  }
}
```

- [ ] **Step 3: Replace inline `canAccessNotebook` with a `validate`-backed implementation; keep `isAuthenticatedPage` as a non-navigating pre-check**

Find `private async canAccessNotebook(page: Page)` (around line 380). Replace it with the new methods below. **Keep `isAuthenticatedPage` intact** — it is a lightweight, non-navigating check used during the interactive reconnect wait-loop (where calling `validateNotebookAccess` every second would navigate away from the login page the user is filling in).

```typescript
private async validateNotebookAccess(page: Page, phase: ValidationPhase): Promise<CloudValidationReport> {
  const mode: ChromiumMode = this.options.chromiumMode ?? "legacy_headless";
  const headless = mode === "legacy_headless" || mode === "new_headless";
  const artifactStats = dumpAuthArtifactsState({
    storageStatePath: this.options.storageStatePath,
    profilePath: this.options.profilePath
  });

  const pageLike = {
    url: () => page.url(),
    goto: (url: string, opts?: { waitUntil?: "domcontentloaded" | "load" | "networkidle"; timeout?: number }) =>
      page.goto(url, opts),
    waitForLoadState: (state: "domcontentloaded" | "load" | "networkidle") => page.waitForLoadState(state).then(() => undefined),
    isLoginFormVisible: async (): Promise<boolean> => {
      for (const selector of ["#ap_email", "#ap_password", "input[type='password']", "input[name='email']"]) {
        const visible = await page.locator(selector).first().isVisible({ timeout: 200 }).catch(() => false);
        if (visible) return true;
      }
      return false;
    },
    isNotebookDomPresent: () =>
      page
        .evaluate(() =>
          Boolean(
            document.querySelector("#kp-notebook-library") ||
              document.querySelector("#kp-notebook-annotations") ||
              document.querySelector(".kp-notebook-library-each-book") ||
              document.querySelector(".kp-notebook-highlight")
          )
        )
        .catch(() => false),
    getCookies: () => page.context().cookies()
  };

  let report = await validate(pageLike, {
    notebookUrl: this.options.notebookUrl,
    phase,
    headless,
    artifactStats
  });

  // Apply the existing continue-shopping interstitial bypass as part of validation —
  // if we can bypass and re-check, do so once before reporting.
  if (report.urlClassification === "interstitial_continue_shopping") {
    await this.bypassContinueShoppingInterstitial(page).catch(() => undefined);
    report = await validate(pageLike, {
      notebookUrl: this.options.notebookUrl,
      phase,
      headless,
      artifactStats
    });
  }

  this.options.onValidation?.(report);
  return report;
}

private async canAccessNotebook(page: Page, phase: ValidationPhase = "fetch"): Promise<boolean> {
  const report = await this.validateNotebookAccess(page, phase);
  return report.outcome === "connected";
}
```

- [ ] **Step 4: Pass the right `phase` from each call site**

Search the file for `canAccessNotebook(page)` and `isAuthenticatedPage(page)` calls. Update them as follows.

In `reconnect()` (search "await this.canAccessNotebook(page)") update both `canAccessNotebook` calls to pass `"reconnect"` as the phase. The inner `if (await this.isAuthenticatedPage(page))` check stays — it's still our non-navigating gate. Only after `isAuthenticatedPage` returns true do we call `canAccessNotebook` (which navigates). Concretely:

Replace inside `reconnect()`:

```typescript
const page = await context.newPage();
if (await this.canAccessNotebook(page)) {
  this.status = "reconnected";
  this.statusValidatedAtMs = Date.now();
  await this.persistContextState(context);
  return;
}

// Let the user complete login interactively in the opened browser window.
const deadline = Date.now() + 5 * 60 * 1000;
while (Date.now() < deadline) {
  await page.waitForTimeout(1000);
  if (await this.isAuthenticatedPage(page)) {
    const canAccessNotebook = await this.canAccessNotebook(page).catch(() => false);
    if (canAccessNotebook || this.isNotebookUrl(page.url())) {
      this.status = "reconnected";
      this.statusValidatedAtMs = Date.now();
      await this.persistContextState(context);
      return;
    }
  }
}
```

With:

```typescript
const page = await context.newPage();
if (await this.canAccessNotebook(page, "reconnect")) {
  this.status = "reconnected";
  this.statusValidatedAtMs = Date.now();
  await this.persistContextState(context);
  return;
}

// Let the user complete login interactively in the opened browser window.
const deadline = Date.now() + 5 * 60 * 1000;
while (Date.now() < deadline) {
  await page.waitForTimeout(1000);
  if (await this.isAuthenticatedPage(page)) {
    const canAccessNotebook = await this.canAccessNotebook(page, "reconnect").catch(() => false);
    if (canAccessNotebook || this.isNotebookUrl(page.url())) {
      this.status = "reconnected";
      this.statusValidatedAtMs = Date.now();
      await this.persistContextState(context);
      return;
    }
  }
}
```

The only changes: the two `canAccessNotebook` calls now pass `"reconnect"` as the phase. The `isAuthenticatedPage` pre-check is intentionally preserved so we don't navigate every second while the user is filling in the sign-in form.

In `fetchSince`, the call `if (!(await this.canAccessNotebook(page)))` should become `if (!(await this.canAccessNotebook(page, "fetch")))`.

In `refreshStatusFromPersistedSession`, the call `(await this.canAccessNotebook(page))` should become `(await this.canAccessNotebook(page, "status_refresh"))`.

- [ ] **Step 5: Emit a startup report from the constructor**

Find the constructor `constructor(private readonly options: PlaywrightCloudOptions) {}` (around line 158) and replace with:

```typescript
constructor(private readonly options: PlaywrightCloudOptions) {
  if (options.onValidation) {
    const artifactStats = dumpAuthArtifactsState({
      storageStatePath: options.storageStatePath,
      profilePath: options.profilePath
    });
    options.onValidation({
      timestamp: new Date().toISOString(),
      phase: "startup",
      headless: false,
      finalUrl: "",
      urlClassification: "unknown",
      loginFormVisible: false,
      notebookDomPresent: false,
      cookieJarSize: 0,
      hasAtMainCookie: false,
      hasUbidMainCookie: false,
      ...artifactStats,
      outcome: "transient",
      decisionReasonCode: "ok"
    });
  }
}
```

This guarantees we capture the artifact snapshot on every launch even if no validation runs immediately.

- [ ] **Step 6: Keep `isAuthenticatedPage`**

`isAuthenticatedPage` should still exist after this task — the reconnect wait-loop uses it as a non-navigating pre-check. Do not delete it. Verify it has exactly one caller (`reconnect()` line inside the deadline loop).

- [ ] **Step 7: Run type-check and existing tests, confirm they pass**

```
pnpm --filter @archi/source-cloud-notebook typecheck
pnpm --filter @archi/source-cloud-notebook test
```

Expected: both green. Existing tests (position-from-id, title-resolution, classify-url, validate, append-validation-report, dump-auth-artifacts, cookie-merge) all pass.

- [ ] **Step 8: Logical commit**

```
git add packages/source-cloud-notebook/src/index.ts
git commit -m "cloud-notebook: refactor connector to emit CloudValidationReport, eagerly merge storageState cookies"
```

---

## Task 7: Adapter consumes `onValidation` — ring buffer + JSONL log + metadata surface

**Files:**
- Modify: `apps/desktop/src/main/connections.ts`
- Test: `apps/desktop/tests/cloud-validation-adapter.test.ts`

The adapter now takes a logger handle and a `recordValidation` method. The connector calls it via the `onValidation` callback wired up in main (Task 8). Decision policy: surface the latest report in `ConnectionState.metadata`. The transient-preservation logic stays out of this task — it is Phase 2 (Fix C) per the spec.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/cloud-validation-adapter.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { CloudValidationLog } from "../src/main/connections.js";

describe("CloudValidationLog", () => {
  it("keeps the most recent N reports (ring buffer of 20)", () => {
    const writes: unknown[] = [];
    const log = new CloudValidationLog({ persist: (r) => writes.push(r) });

    for (let i = 0; i < 25; i += 1) {
      log.record({
        timestamp: `2026-05-19T12:00:${String(i).padStart(2, "0")}.000Z`,
        phase: "fetch",
        headless: true,
        finalUrl: "https://read.amazon.com/kp/notebook",
        urlClassification: "notebook",
        loginFormVisible: false,
        notebookDomPresent: true,
        cookieJarSize: 5,
        hasAtMainCookie: true,
        hasUbidMainCookie: true,
        storageStateFileExists: true,
        storageStateFileSizeBytes: 1024,
        profileDirExists: true,
        profileDirEntryCount: 10,
        outcome: "connected",
        decisionReasonCode: "ok"
      });
    }

    expect(log.recent(50)).toHaveLength(20);
    expect(log.recent(5)).toHaveLength(5);
    expect(log.latest()?.timestamp).toBe("2026-05-19T12:00:24.000Z");
  });

  it("persists every report via the persist callback", () => {
    const writes: unknown[] = [];
    const log = new CloudValidationLog({ persist: (r) => writes.push(r) });
    log.record({
      timestamp: "2026-05-19T12:00:00.000Z",
      phase: "startup",
      headless: false,
      finalUrl: "",
      urlClassification: "unknown",
      loginFormVisible: false,
      notebookDomPresent: false,
      cookieJarSize: 0,
      hasAtMainCookie: false,
      hasUbidMainCookie: false,
      storageStateFileExists: false,
      storageStateFileSizeBytes: 0,
      profileDirExists: false,
      profileDirEntryCount: 0,
      outcome: "transient",
      decisionReasonCode: "ok"
    });
    expect(writes).toHaveLength(1);
  });

  it("returns recent reports in newest-first order", () => {
    const log = new CloudValidationLog({ persist: () => undefined });
    log.record({
      timestamp: "2026-05-19T12:00:00.000Z",
      phase: "startup",
      headless: true,
      finalUrl: "",
      urlClassification: "unknown",
      loginFormVisible: false,
      notebookDomPresent: false,
      cookieJarSize: 0,
      hasAtMainCookie: false,
      hasUbidMainCookie: false,
      storageStateFileExists: false,
      storageStateFileSizeBytes: 0,
      profileDirExists: false,
      profileDirEntryCount: 0,
      outcome: "transient",
      decisionReasonCode: "ok"
    });
    log.record({
      timestamp: "2026-05-19T12:00:01.000Z",
      phase: "fetch",
      headless: true,
      finalUrl: "https://read.amazon.com/kp/notebook",
      urlClassification: "notebook",
      loginFormVisible: false,
      notebookDomPresent: true,
      cookieJarSize: 5,
      hasAtMainCookie: true,
      hasUbidMainCookie: true,
      storageStateFileExists: true,
      storageStateFileSizeBytes: 1024,
      profileDirExists: true,
      profileDirEntryCount: 10,
      outcome: "connected",
      decisionReasonCode: "ok"
    });
    const recent = log.recent(5);
    expect(recent[0].timestamp).toBe("2026-05-19T12:00:01.000Z");
    expect(recent[1].timestamp).toBe("2026-05-19T12:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm --filter @archi/desktop test -- cloud-validation-adapter
```

Expected: failure — `CloudValidationLog` not exported.

- [ ] **Step 3: Implement `CloudValidationLog` and wire it into the adapter**

In `apps/desktop/src/main/connections.ts`, near the top after the imports, add:

```typescript
import type { CloudValidationReport } from "@archi/source-cloud-notebook";

export type CloudValidationLogOptions = {
  persist: (report: CloudValidationReport) => void;
  ringBufferSize?: number;
};

export class CloudValidationLog {
  private readonly buffer: CloudValidationReport[] = [];
  private readonly capacity: number;
  private readonly persist: (report: CloudValidationReport) => void;

  constructor(options: CloudValidationLogOptions) {
    this.persist = options.persist;
    this.capacity = options.ringBufferSize ?? 20;
  }

  record(report: CloudValidationReport): void {
    this.buffer.push(report);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
    try {
      this.persist(report);
    } catch {
      // persist failures must not propagate
    }
  }

  recent(limit: number): CloudValidationReport[] {
    const safe = Math.max(0, Math.min(limit, this.buffer.length));
    return this.buffer.slice(-safe).reverse();
  }

  latest(): CloudValidationReport | undefined {
    return this.buffer[this.buffer.length - 1];
  }
}
```

- [ ] **Step 4: Surface the latest report in `ConnectionState.metadata`**

In the same file, find `CloudNotebookConnectionAdapter`. Change its constructor and `getStatus` to accept and read the log:

Replace the constructor signature:

```typescript
constructor(
  private readonly settings: AppSettingsAccess,
  private readonly connector: PlaywrightCloudNotebookConnector,
  private readonly validationLog?: CloudValidationLog
) {}
```

In every `createConnectionState({ ..., metadata: { enabled: ... } })` call inside `CloudNotebookConnectionAdapter`, merge in the latest report fields. Add a private helper:

```typescript
private latestValidationMetadata(): Record<string, string | boolean | number | null> {
  const latest = this.validationLog?.latest();
  if (!latest) {
    return {};
  }
  return {
    latestValidationTimestamp: latest.timestamp,
    latestValidationPhase: latest.phase,
    latestValidationOutcome: latest.outcome,
    latestValidationReason: latest.decisionReasonCode,
    latestValidationUrlClass: latest.urlClassification,
    latestValidationHeadless: latest.headless,
    latestValidationCookieJarSize: latest.cookieJarSize
  };
}
```

Then in each of the three `createConnectionState({ ... metadata: { enabled: ... } })` blocks inside the adapter, replace the `metadata` value with:

```typescript
metadata: {
  enabled: this.settings.getCloudSettings().enabled,
  ...this.latestValidationMetadata()
}
```

(For the `inFlightReconnect` early-return state, also include `authInProgress: true`.)

- [ ] **Step 5: Run the test, confirm it passes**

```
pnpm --filter @archi/desktop test -- cloud-validation-adapter
pnpm --filter @archi/desktop typecheck
```

Expected: both green.

- [ ] **Step 6: Logical commit**

```
git add apps/desktop/src/main/connections.ts \
        apps/desktop/tests/cloud-validation-adapter.test.ts
git commit -m "desktop: CloudValidationLog ring buffer; adapter surfaces latest report in metadata"
```

---

## Task 8: Wire `onValidation` in main + register IPC handlers

**Files:**
- Modify: `apps/desktop/src/main/index.ts`

Where the connector and adapter are constructed, create the log path under `userData`, instantiate `CloudValidationLog` with `appendValidationReport` as the persist callback, pass an `onValidation` callback to the connector, register two IPC channels.

- [ ] **Step 1: Locate the existing `PlaywrightCloudNotebookConnector` instantiation**

Run:

```
grep -n "new PlaywrightCloudNotebookConnector\|new CloudNotebookConnectionAdapter" apps/desktop/src/main/index.ts
```

You should see two lines. Read 30 lines of context around them so you understand the existing pattern.

- [ ] **Step 2: Add the log + adapter wiring**

At the top of `apps/desktop/src/main/index.ts`, ensure these imports are present (extend the existing `@archi/source-cloud-notebook` import as needed):

```typescript
import { PlaywrightCloudNotebookConnector, decodeKindleHighlightLocation, appendValidationReport, type CloudPassage, type CloudValidationReport } from "@archi/source-cloud-notebook";
import { CloudNotebookConnectionAdapter, CloudValidationLog } from "./connections.js";
import { app, shell, ipcMain } from "electron";
import path from "node:path";
```

(`app`, `shell`, `ipcMain`, and `path` are likely already imported — verify and only add what's missing.)

Just before the `PlaywrightCloudNotebookConnector` construction, add:

```typescript
const cloudValidationLogPath = path.join(app.getPath("userData"), "cloud-validation.log");
const cloudValidationLog = new CloudValidationLog({
  persist: (report: CloudValidationReport) => appendValidationReport(cloudValidationLogPath, report)
});
```

Change the `new PlaywrightCloudNotebookConnector({ … })` call to include the `onValidation` callback:

```typescript
const cloudConnector = new PlaywrightCloudNotebookConnector({
  // … existing fields unchanged …
  onValidation: (report) => cloudValidationLog.record(report)
});
```

Change the `new CloudNotebookConnectionAdapter(…)` call to pass the log:

```typescript
const cloudAdapter = new CloudNotebookConnectionAdapter(settings, cloudConnector, cloudValidationLog);
```

(Use the exact local names from the existing code if they differ — `settings`, `cloudConnector`, etc.)

- [ ] **Step 3: Register the two new IPC channels**

In the same file, near the existing `ipcMain.handle("archi:list-connection-debug-events", …)` registration (around line 1356), add:

```typescript
ipcMain.handle("archi:get-recent-validations", (_event, limit: number = 5) => cloudValidationLog.recent(limit));
ipcMain.handle("archi:open-validation-log", () => {
  shell.showItemInFolder(cloudValidationLogPath);
});
```

- [ ] **Step 4: Type-check and run all tests**

```
pnpm --filter @archi/desktop typecheck
pnpm --filter @archi/desktop test
```

Expected: both green.

- [ ] **Step 5: Logical commit**

```
git add apps/desktop/src/main/index.ts
git commit -m "desktop: wire CloudValidationLog and IPC handlers (get-recent-validations, open-validation-log)"
```

---

## Task 9: Expose new channels in the preload

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`

Add `getRecentValidations` and `openValidationLog` to the `window.archi` API.

- [ ] **Step 1: Add a type for the renderer-facing report**

In `apps/desktop/src/preload/index.ts`, near the existing `ConnectionState` type, add:

```typescript
type CloudValidationReportView = {
  timestamp: string;
  phase: "startup" | "reconnect" | "fetch" | "status_refresh";
  headless: boolean;
  finalUrl: string;
  urlClassification:
    | "notebook"
    | "signin"
    | "mfa"
    | "captcha"
    | "interstitial_continue_shopping"
    | "interstitial_other"
    | "unknown";
  loginFormVisible: boolean;
  notebookDomPresent: boolean;
  cookieJarSize: number;
  hasAtMainCookie: boolean;
  hasUbidMainCookie: boolean;
  storageStateFileExists: boolean;
  storageStateFileSizeBytes: number;
  profileDirExists: boolean;
  profileDirEntryCount: number;
  outcome: "connected" | "needs_auth" | "transient";
  decisionReasonCode:
    | "ok"
    | "signin_url_redirect"
    | "login_form_visible"
    | "notebook_dom_missing"
    | "goto_failed"
    | "cookies_empty_on_load"
    | "interstitial_unrecognized"
    | "unknown_error";
  errorMessage?: string;
  errorStack?: string;
};
```

(Preload is its own tsconfig with no `@archi/*` imports — duplicate the view type rather than importing it.)

- [ ] **Step 2: Extend the `api` object**

Inside `const api = { …, …, }`, just before the closing brace, add:

```typescript
,
getRecentValidations: (limit: number = 5): Promise<CloudValidationReportView[]> =>
  ipcRenderer.invoke("archi:get-recent-validations", limit),
openValidationLog: (): Promise<void> => ipcRenderer.invoke("archi:open-validation-log")
```

- [ ] **Step 3: Type-check the preload**

```
pnpm --filter @archi/desktop typecheck
```

Expected: green.

- [ ] **Step 4: Logical commit**

```
git add apps/desktop/src/preload/index.ts
git commit -m "preload: expose getRecentValidations and openValidationLog on window.archi"
```

---

## Task 10: Add Diagnostics disclosure to the Kindle Highlights card

**Files:**
- Modify: `apps/desktop/src/renderer/screens/ConnectionsScreen.tsx`

A collapsed `<details>` element under the cloud card showing latest report fields, a small 5-row table, and a "Reveal log" button.

- [ ] **Step 1: Add the view type and types for the api surface in this file**

Near the top of `ConnectionsScreen.tsx`, after the existing `ConnectionState` type, add:

```typescript
type CloudValidationReportView = {
  timestamp: string;
  phase: string;
  headless: boolean;
  finalUrl: string;
  urlClassification: string;
  outcome: string;
  decisionReasonCode: string;
  cookieJarSize: number;
};

declare global {
  interface Window {
    archi: {
      getRecentValidations(limit?: number): Promise<CloudValidationReportView[]>;
      openValidationLog(): Promise<void>;
    };
  }
}
```

(If a `Window` `archi` declaration already exists elsewhere, extend that one instead of redeclaring it.)

- [ ] **Step 2: Add diagnostics state and effect**

Inside the `ConnectionsScreen` function, before the `return`, add:

```typescript
const [recentValidations, setRecentValidations] = useState<CloudValidationReportView[]>([]);

useEffect(() => {
  let cancelled = false;
  const load = async (): Promise<void> => {
    const reports = await window.archi.getRecentValidations(5).catch(() => [] as CloudValidationReportView[]);
    if (!cancelled) {
      setRecentValidations(reports);
    }
  };
  void load();
  const interval = setInterval(() => void load(), 5000);
  return () => {
    cancelled = true;
    clearInterval(interval);
  };
}, []);
```

Ensure `useState` and `useEffect` are imported at the top:

```typescript
import { useEffect, useState } from "react";
```

- [ ] **Step 3: Add the `<details>` block to the Kindle Highlights card**

Inside the `<article className="connection-card">` for the cloud card, just before the closing `</article>`, add:

```tsx
<details className="connection-diagnostics">
  <summary>Diagnostics</summary>
  {recentValidations.length === 0 ? (
    <p>No validation reports yet. Click Test or wait for the next sync.</p>
  ) : (
    <>
      <dl className="diagnostics-latest">
        <dt>Latest check</dt>
        <dd>{new Date(recentValidations[0].timestamp).toLocaleString()}</dd>
        <dt>Phase</dt>
        <dd>{recentValidations[0].phase}</dd>
        <dt>Outcome</dt>
        <dd>{recentValidations[0].outcome}</dd>
        <dt>Reason</dt>
        <dd>{recentValidations[0].decisionReasonCode}</dd>
        <dt>URL class</dt>
        <dd>{recentValidations[0].urlClassification}</dd>
        <dt>Headless</dt>
        <dd>{recentValidations[0].headless ? "yes" : "no"}</dd>
        <dt>Cookie jar size</dt>
        <dd>{recentValidations[0].cookieJarSize}</dd>
        <dt>Final URL</dt>
        <dd className="diagnostics-url">{recentValidations[0].finalUrl || "—"}</dd>
      </dl>
      <table className="diagnostics-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Phase</th>
            <th>Outcome</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {recentValidations.map((r, idx) => (
            <tr key={`${r.timestamp}-${idx}`}>
              <td>{new Date(r.timestamp).toLocaleTimeString()}</td>
              <td>{r.phase}</td>
              <td>{r.outcome}</td>
              <td>{r.decisionReasonCode}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )}
  <button type="button" onClick={() => void window.archi.openValidationLog()}>
    Reveal log in Finder
  </button>
</details>
```

- [ ] **Step 4: Type-check**

```
pnpm --filter @archi/desktop typecheck
```

Expected: green.

- [ ] **Step 5: Manual smoke test**

```
pnpm --filter @archi/desktop dev
```

Open the app, go to Connections, expand "Diagnostics" on the Kindle Highlights card. You should see at least the startup report immediately. Hit Reconnect → after sign-in completes, more reports appear. Click "Reveal log in Finder" — `cloud-validation.log` opens in Finder.

- [ ] **Step 6: Logical commit**

```
git add apps/desktop/src/renderer/screens/ConnectionsScreen.tsx
git commit -m "renderer: cloud notebook diagnostics disclosure on Connections screen"
```

---

## Task 11: Documentation

**Files:**
- Modify: `docs/architecture.md`

One paragraph under "Connection model" describing the validation-report telemetry channel.

- [ ] **Step 1: Append the paragraph**

In `docs/architecture.md`, find the "Connection model" section. After the last bullet ("Cloud notebook authentication is Playwright-based …"), add:

```markdown
- Cloud notebook validation emits a structured `CloudValidationReport` on every check (startup, reconnect, fetch, status refresh). Reports are appended to `userData/cloud-validation.log` (JSONL, 1 MB rotation, one generation) and held in a 20-deep ring buffer in the main process. The latest report is surfaced on `ConnectionState.metadata` and exposed to the renderer via `window.archi.getRecentValidations()`. Hard `decisionReasonCode`s (`signin_url_redirect`, `login_form_visible`, `cookies_empty_on_load`, `goto_failed`) cause `connected → needs_auth`; transient classifications (unrecognized interstitials, missing notebook DOM on a notebook URL) keep the cached status until a hard signal or user action.
```

- [ ] **Step 2: Logical commit**

```
git add docs/architecture.md
git commit -m "docs: document cloud notebook validation-report telemetry"
```

---

## Phase 1 verification checklist

After all tasks complete, confirm the following before considering Phase 1 done:

- [ ] `pnpm typecheck` is green across the workspace.
- [ ] `pnpm test` is green across the workspace.
- [ ] Manual: launch app, open Connections → Diagnostics disclosure shows a startup report immediately (with artifact stats populated).
- [ ] Manual: click Reconnect → complete Amazon sign-in → cold relaunch the app → Diagnostics shows a fresh `status_refresh` or `fetch` report. Whatever the outcome (`connected` or `needs_auth`), the `decisionReasonCode` is set, not `unknown_error`.
- [ ] Manual: reveal `userData/cloud-validation.log` in Finder; confirm one JSON line per check.
- [ ] Manual: deliberately delete the storage-state file and profile dir → next validation reports `cookies_empty_on_load` with `outcome: "needs_auth"`.
- [ ] Capture at least 3 cold-launch cycles of reports for the Phase 1 retrospective (per spec exit criteria).

After the retrospective lands, the Phase 2 plan can be written. Suggested next-step prompt: "Based on Phase 1 evidence in `cloud-validation.log`, write the Phase 2 plan selecting from Fix B / C / D."

## Deferred from this plan

- **Stub-server Playwright integration tests** (spec § Testing → Integration tests). The plan covers `validate()` via unit tests with a mocked `PageLike` and exercises the real Playwright path through the manual smoke test in Task 10. Adding a stub HTTP server + Playwright integration test harness would require new test infrastructure with no precedent in this repo and is better tackled as a focused follow-up PR once Phase 1 telemetry is informing real decisions.
- **Connector README updates** describing the new options (`chromiumMode`, `onValidation`). The cloud-notebook package has no README today; if one is added later, those should be documented there.
