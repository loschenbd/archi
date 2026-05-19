# Cloud notebook connection: stay-connected design

**Date:** 2026-05-19
**Author:** Archi maintainers (drafted via brainstorming session)
**Status:** Draft, awaiting user review before implementation planning
**Scope:** `packages/source-cloud-notebook`, `apps/desktop/src/main/connections.ts`, related preload/renderer surfaces.

## Problem

The cloud-notebook provider flips from `connected` to `needs_auth` immediately after every app close. After a successful `reconnect()` (headed Playwright Chromium, user signs in), the next cold launch of Anamnesis reports `needs_auth` with no user action in between. Users must re-run the Amazon sign-in flow on every launch, which makes scheduled sync effectively unusable.

The same connection layer covers Notion and device export; both are stable. This spec is scoped to the cloud-notebook provider only.

## Goals

- Cloud-notebook status remains `connected` across cold launches, idle periods, and scheduled syncs except when the user genuinely must reauth (cookies expired, Amazon forces MFA, password change).
- When the connector reports `needs_auth`, structured diagnostics tell us (and the user) **why** — not just "needs auth."
- The decision to flip `connected → needs_auth` is based on a deterministic signal, not on missing DOM selectors that may be transient.

## Success criteria

- After a successful reconnect, 5 consecutive cold launches of the app report `connected` without user action.
- Every validation produces a `CloudValidationReport` with a `decisionReasonCode`; "needs_auth" without a reason code is impossible.
- A deliberately corrupted session (clear cookies + delete profile dir) still flips to `needs_auth`, with the correct hard reason code.

## Non-goals

- Replacing Playwright with Electron `BrowserWindow` + native `session` (Approach 3 in brainstorming — out of scope here).
- Cross-device session sharing.
- Elevating cloud sync above best-effort, per `AGENTS.md`.
- Working around Amazon ToS restrictions in any way beyond what the existing connector already does.
- Background keepalive jobs that periodically ping the notebook. Out of scope unless Phase 1 evidence demonstrates long-idle session decay (a different symptom than the one driving this spec).

## Approach: diagnose, then fix

Two phases. Phase 1 ships structured diagnostics plus one eager, low-risk fix (Fix A). Phase 2 picks the remaining fixes (B/C/D) based on what Phase 1 reveals.

Rationale: the "immediately after every close" symptom is consistent with at least four plausible root causes, each with a different fix. Two days of instrumentation will resolve which root cause is firing; the instrumentation itself is durable value (the Connections screen currently surfaces no reason at all when validation fails).

---

## Phase 1 — Diagnostic instrumentation + eager Fix A

### CloudValidationReport (new type)

Produced by `validateNotebookAccess(page, phase)` on every validation attempt. Replaces today's bare boolean return from `canAccessNotebook`.

| Field | Type | Purpose |
|---|---|---|
| `timestamp` | ISO string | When |
| `phase` | `"startup" \| "reconnect" \| "fetch" \| "status_refresh"` | From where |
| `headless` | `boolean` | Headless vs headed run — confirms or rules out headless detection |
| `finalUrl` | `string` | Where Amazon actually landed after redirects |
| `urlClassification` | `"notebook" \| "signin" \| "mfa" \| "captcha" \| "interstitial_continue_shopping" \| "interstitial_other" \| "unknown"` | Pattern-matched on URL + small DOM markers |
| `loginFormVisible` | `boolean` | Did `isAuthenticatedPage` see a password field |
| `notebookDomPresent` | `boolean` | Did `#kp-notebook-library` / `#kp-notebook-annotations` exist |
| `cookieJarSize` | `number` | Count of cookies on the context at load time |
| `hasAtMainCookie` | `boolean` | Amazon `at-main` session cookie present |
| `hasUbidMainCookie` | `boolean` | Amazon `ubid-main` identity cookie present |
| `storageStateFileExists` | `boolean` | Was storage-state JSON on disk |
| `storageStateFileSizeBytes` | `number` | Size hint (0 = empty) |
| `profileDirExists` | `boolean` | Was profile dir on disk |
| `profileDirEntryCount` | `number` | File count in profile dir |
| `outcome` | `"connected" \| "needs_auth" \| "transient"` | The decision |
| `decisionReasonCode` | `DecisionReasonCode` (enum) | Machine-readable cause |
| `errorMessage` | `string \| undefined` | If exception |
| `errorStack` | `string \| undefined` | If exception |

`DecisionReasonCode` initial enum: `ok`, `signin_url_redirect`, `login_form_visible`, `notebook_dom_missing`, `goto_failed`, `cookies_empty_on_load`, `interstitial_unrecognized`, `unknown_error`. Treated as "hard" (flip to needs_auth) for Phase 2 Fix C: `signin_url_redirect`, `login_form_visible`, `cookies_empty_on_load`, `goto_failed`. All others are "transient" candidates.

### Telemetry surfaces

- **JSONL log** at `app.getPath("userData")/cloud-validation.log`. Append-only. Size-based rotation at 1 MB → `.log.1` (one generation kept). Synchronous append from main process; failures are logged to console but do not throw.
- **In-memory ring buffer** of last 20 reports in `CloudNotebookConnectionAdapter`.
- **IPC channels** (new):
  - `archi:get-recent-validations(limit: number) → CloudValidationReport[]`
  - `archi:open-validation-log() → void` (calls `shell.showItemInFolder(logPath)`)
- **Renderer**: Connections screen cloud-notebook card gains a collapsed "Diagnostics" disclosure. Open state shows: latest decision (timestamp, phase, outcome, reason code, `finalUrl`, `headless`), 5-row table of recent attempts, "Reveal log" button.
- **Startup artifact snapshot**: `dumpAuthArtifactsState()` runs once on connector construction and emits a one-line summary report with `phase="startup"`, `outcome="transient"`, `decisionReasonCode="ok"`, populated with the storage-state / profile dir stats. This guarantees we capture artifact state on every launch even if no real validation runs.

### Eager Fix A — Load `storageState` when `profilePath` is set

`openContext` today (line 339 of `packages/source-cloud-notebook/src/index.ts`) takes the persistent-profile branch and never loads `storageStatePath`. `persistContextState` still writes the JSON, so the file becomes write-only — it can never act as a fallback.

**Change:** When `profilePath` is set, after `chromium.launchPersistentContext(...)`, if `storageStatePath` exists and is non-empty, parse the JSON and call `context.addCookies(parsedCookies)`. Skip cookies already present in the persistent context (compare by `name + domain + path`). Storage-state becomes the canonical source of truth; the profile dir is a hot cache.

**Why eager (not gated on Phase 1).** The change is small, idempotent, ~10 ms per `openContext`, and fixes a real code smell regardless of whether it cures this specific symptom. Gating it would force a second PR for the same trivial change.

### Phase 1 code change scope

- New `packages/source-cloud-notebook/src/validation-report.ts`: types, `appendValidationReport(path, report)` with rotation, pure `classifyUrl(url)` and `validate(page, opts) → CloudValidationReport` helpers.
- `packages/source-cloud-notebook/src/index.ts`: `PlaywrightCloudNotebookConnector` gains `onValidation?(report)` option, `validateNotebookAccess(page, phase)` replaces inline checks inside `canAccessNotebook`, cookie-merge helper, `dumpAuthArtifactsState()`. `runChromiumOptions(phase, interactive)` returns launch options based on a new `chromiumMode: "legacy_headless" | "new_headless" | "offscreen_headed" | "headed_visible"` constructor option. Phase 1 default is `"legacy_headless"` (matches today's `headless: true` exactly — no behavioral change). Reconnect continues to use `"headed_visible"` (matches today's `headless: false`). Fix B is what changes the non-interactive default.
- `apps/desktop/src/main/connections.ts`: `CloudNotebookConnectionAdapter` constructs connector with `onValidation` handler → JSONL append + ring buffer; surfaces latest report in `ConnectionState.metadata`.
- `apps/desktop/src/main/index.ts`: register two new IPC channels.
- `apps/desktop/src/preload/index.ts`: expose channels on `window.archi`.
- `apps/desktop/src/renderer/screens/ConnectionsScreen.tsx`: Diagnostics disclosure on cloud-notebook card.

No schema changes. No changes to `fetchSince` extraction, parsing, dedupe, Notion destination, sync scheduler, or connection lifecycle API.

### Phase 1 exit criteria

- 3 cold-launch cycles' worth of validations captured in the log under representative usage (open app, sign in, close, relaunch, open Connections screen).
- One short Phase 1 retrospective note appended to this spec linking specific log evidence to the chosen Phase 2 fix subset.

---

## Phase 2 — Targeted fixes (gated on Phase 1 evidence)

Each fix is independent and shippable in its own PR. Selected based on which trigger conditions fire in the Phase 1 log. Priority order is A → B → C → D; ship the subset that applies.

### Fix B — Hidden offscreen-headed Chromium for validation and fetch

**Trigger:** Phase 1 shows headed `reconnect()` lands at `urlClassification=notebook` but the immediately-following non-headed validation (`status_refresh` or `fetch` phase) lands at `urlClassification=signin` with the same cookies present.

**Change:** Default the non-interactive `chromiumMode` from `"legacy_headless"` to `"offscreen_headed"`. Launch full Chromium (`headless: false`) with `args: ["--window-position=-2400,-2400", "--window-size=1280,900"]`. On macOS, call `app.dock.hide()` during the launch window or use a transient `LSUIElement` flag so the Dock icon does not flash. Provide an opt-in `CLOUD_USE_NEW_HEADLESS=true` env override that maps to `chromiumMode="new_headless"` for users who accept the reliability trade-off in exchange for lower resource use.

**Why offscreen-headed over `--headless=new`:** Amazon's notebook page is on the aggressive end of bot detection (Sec-CH-UA exposes `"HeadlessChrome"`, no real window-size/screen-position behavior in `--headless=new`). Offscreen-headed is a real Chromium process — same renderer, real GPU, real fonts, real window — and is essentially undetectable. Cost: full Chromium RAM (~300–500 MB) per sync, brief CPU spike on launch. Operation lock already in the connector serializes launches.

**Risk:** moderate. Mitigated by the existing operation queue and by documenting resource cost in the connector README.

### Fix C — Validation tolerance: transient vs hard outcomes

**Trigger:** Phase 1 shows `loginFormVisible=false` AND `notebookDomPresent=false` AND `urlClassification` is `interstitial_*` or `unknown` (i.e., we're authenticated but on a page we don't recognize).

**Change:** The connector reports facts (`CloudValidationReport`); the adapter chooses status. When `report.outcome === "transient"` AND cached status is `connected`, the adapter preserves the cached status rather than flipping to `needs_auth`. The adapter retries once on a fresh page; if the retry is also transient, it logs but keeps `connected` until the next user-initiated action or a hard reason code. Only `signin_url_redirect`, `login_form_visible`, `cookies_empty_on_load`, and `goto_failed` cause `connected → needs_auth`.

Opportunistically extend the continue-shopping interstitial selector list as we encounter new variants in the log.

**Risk:** moderate. We might paper over a real auth failure for one cycle, but the next user action or scheduled fetch will hit a hard signal.

### Fix D — Cold-start grace period

**Trigger:** Phase 1 shows the first validation on cold launch fails (non-hard reason) but a retry 1–2 seconds later succeeds — i.e., cookies loaded asynchronously, network not yet warm.

**Change:** On `phase === "startup"` only, if validation fails with a non-hard reason, retry once after 1500 ms before reporting `needs_auth`. Do not apply this retry to user-initiated test, reconnect, or mid-fetch validation — those should be authoritative.

**Risk:** low. Adds at most 1500 ms of latency on cold launch, only when the first attempt fails.

### Phase 2 exit criteria

- 5 consecutive cold launches → `connected` reported without user action.
- Deliberately corrupted session (clear cookies + delete profile dir) flips to `needs_auth` with the correct hard reason code on the first validation.
- No regressions in the JSONL log relative to the Phase 1 baseline: same reason codes or fewer, no new `unknown_error`.

---

## Components and boundaries

```
PlaywrightCloudNotebookConnector  (packages/source-cloud-notebook)
├── runChromiumOptions(phase, interactive) → launch options
├── openContext(opts)                       — opens persistent context, merges storageState cookies
├── validateNotebookAccess(page, phase)     → CloudValidationReport
├── canAccessNotebook(page)                 — thin wrapper: returns boolean from report.outcome
├── reconnect() / fetchSince() / getStatus() — unchanged call sites
└── onValidation?(report)                   — emitted to adapter

CloudNotebookConnectionAdapter  (apps/desktop/src/main/connections.ts)
├── onValidation handler
│   ├── appendValidationReport(logPath, report)   — JSONL + rotation
│   ├── ringBuffer.push(report)
│   ├── if outcome === "transient" and cached === "connected": preserve cache
│   └── if phase === "startup" and non-hard fail: schedule one retry
├── getStatus() — surfaces latest report in metadata
└── IPC: archi:get-recent-validations, archi:open-validation-log
```

**Boundaries that stay clean:**

- `validate()` is a pure function over `Page` + options; testable with a mocked Playwright Page.
- Cookie-merge helper is a pure function over storage-state JSON + existing cookie list; testable without a browser.
- Decision policy (transient vs hard, startup grace) lives in the adapter, not the connector. The connector reports facts; the adapter decides status.

---

## Data flow for one validation attempt

```
PlaywrightCloudNotebookConnector.canAccessNotebook(page)
  → validateNotebookAccess(page, phase)
      → page.goto(notebookUrl)
      → classify URL, check login form, check notebook DOM, snapshot cookies
      → build CloudValidationReport
  → invoke onValidation(report)                  [crosses into main process]
      → appendValidationReport(file)             — JSONL with size-based rotation
      → ringBuffer.push(report)
      → if outcome === "transient" and cached === "connected": keep cached
      → if phase === "startup" and non-hard fail: schedule one retry
  → return boolean derived from report.outcome
```

**Renderer flow:**

```
ConnectionsScreen mount  → window.archi.getRecentValidations(5)
                         → main reads ring buffer → renders rows
"Reveal log" click       → window.archi.openValidationLog()
                         → main shell.showItemInFolder(logPath)
```

---

## Testing

**Unit tests (no browser).**

- `validateNotebookAccess` over fixture HTML pages: notebook DOM present, sign-in form visible, continue-shopping interstitial, region-gate interstitial, captcha. Each fixture produces a known `decisionReasonCode` and `outcome`.
- Cookie-merge helper: storage-state JSON with N cookies + empty profile cookie jar → exactly N cookies added; overlap → no duplicates.
- JSONL appender: rotation at 1 MB triggers `.log` → `.log.1` rename, new `.log` opens.
- Adapter decision logic: matrix of `cached_status × report.outcome × phase` → expected `ConnectionState.status`. Specifically covers (a) `connected` cached + `transient` report → keep `connected`, (b) `connected` cached + hard `needs_auth` reason → flip, (c) `startup` phase + non-hard fail → retry once.

**Integration tests (Playwright, deterministic).**

- Local HTTP server serves stubbed Amazon-shaped pages: notebook HTML, sign-in HTML, continue-shopping interstitial, unknown interstitial. Point `notebookUrl` at the stub. Verify each path produces the expected `CloudValidationReport`.
- Cookie persistence round-trip: launch persistent context against stub, set cookies, close, reopen — verify cookies survive AND that storage-state-only cookies are merged in.

**Manual / smoke tests (real Amazon).**

- Before Phase 1 ships: confirm the current `reconnect` → cold-launch → `needs_auth` symptom reproduces and the new diagnostics capture meaningful reports on each step.
- After each Phase 2 fix: same cycle; verify the symptom is reduced AND no new `decisionReasonCode` regressions appear in the log.

**Out of scope for testing.**

- Live `read.amazon.com` in CI (flaky, ToS-adjacent, not the project's pattern).
- Stealth-fingerprint tests; offscreen-headed is "treat as a real browser" so the test verifies launch flags are correct.

---

## Risks and open questions

- **macOS Dock icon flash** for offscreen-headed Chromium needs validation. Fallback if `app.dock.hide()` is insufficient: use a transient `LSUIElement` plist or an Electron BrowserWindow `show: false` wrapper. Decided during Fix B implementation.
- **Operation cost** of running full Chromium on every scheduled sync. The existing operation queue serializes launches and the validation phase is short (~1–2 s), but on devices with constrained RAM this is a real cost. Mitigation: surface in the connector README.
- **`hasPersistedAuthArtifacts` check** today returns true if profile dir has *any* entries, which is a weak signal. Phase 1 telemetry will reveal whether this produces false positives ("artifacts exist" but no real cookies); if so, tighten in Phase 2 as a small follow-up.
- **Storage-state cookie schema versioning.** Playwright's storage-state format is stable in practice but not strictly guaranteed across major versions. Cookie-merge helper should fail closed (skip merge) on parse error rather than throwing.

---

## Roll-out

Phase 1 ships as one PR including eager Fix A. Phase 2 ships as up to four small PRs in priority order A → B → C → D, each gated on its trigger condition firing in the Phase 1 log. Each Phase 2 PR includes the relevant unit/integration tests and updates this spec's roll-out section with the decision evidence.

No feature flag needed — diagnostics are additive and Fix A is low-risk. If Fix B (offscreen-headed) causes user-visible regressions, the `chromiumMode` constructor option (and the `CLOUD_USE_NEW_HEADLESS` env override) allows falling back to `"new_headless"` or even `"legacy_headless"` without code changes.

## File changes summary

- New: `packages/source-cloud-notebook/src/validation-report.ts`
- Modified: `packages/source-cloud-notebook/src/index.ts`
- Modified: `apps/desktop/src/main/connections.ts`
- Modified: `apps/desktop/src/main/index.ts`
- Modified: `apps/desktop/src/preload/index.ts`
- Modified: `apps/desktop/src/renderer/screens/ConnectionsScreen.tsx`
- Modified: `docs/architecture.md` (one paragraph on the validation-report model under "Connection model")
