# Onboarding Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-screen "Welcome → Settings" onboarding with a 5-step in-app wizard (Welcome → Notion → Kindle → Confirm → First sync) that lands users on Home with a sync already running. Spec: [`docs/superpowers/specs/2026-06-09-onboarding-refactor-design.md`](../specs/2026-06-09-onboarding-refactor-design.md).

**Architecture:** Renderer-only refactor. New directory `apps/desktop/src/renderer/screens/onboarding/` holding a thin orchestrator (`OnboardingWizard.tsx`), a presentation shell (`WizardChrome.tsx`), five step components, types, and a pure resume function. Wizard reuses existing preload IPC (`getConnections`, `setNotionToken`, `connectConnection`, `completeOnboarding`, `runSyncNow`) verbatim. No main-process changes. `App.tsx` swaps the import in its `!onboardingCompleted` branch.

**Tech Stack:** React 18 (renderer) · TypeScript · Vite · Vitest (existing tests in `apps/desktop/tests/`) · plain CSS extending `apps/desktop/src/renderer/styles.css`.

**Coordination note:** Two parallel worktrees (`.claude/worktrees/local-semantic-search`, `.claude/worktrees/sync-pause`) are actively editing `HomeScreen.tsx`, `screens/home/*`, `ConnectionsScreen.tsx`, `main/connections.ts`, and `main/index.ts`. This plan touches NONE of those files. The only shared file is `App.tsx`, and the changes there are localized to a single ~30-line block plus extracting one inline component.

---

## File map

| Path | Action | Owner / responsibility |
|---|---|---|
| `apps/desktop/src/renderer/components/WindowTitleBar.tsx` | **Create** | Extracted from App.tsx so both App and WizardChrome can import the same component. |
| `apps/desktop/src/renderer/screens/onboarding/types.ts` | **Create** | `Step`, `StepStatus`, `WizardState`, `OnboardingCompleteResult`, `ConnectionsSnapshot` types. |
| `apps/desktop/src/renderer/screens/onboarding/computeStartStep.ts` | **Create** | Pure resume function: connections → start step. |
| `apps/desktop/src/renderer/screens/onboarding/computeStartStep.test.ts` | **Create** | Vitest unit tests for the pure function. |
| `apps/desktop/src/renderer/screens/onboarding/WizardChrome.tsx` | **Create** | Title bar + progress dots + footer (Back/Skip/Continue). |
| `apps/desktop/src/renderer/screens/onboarding/steps/WelcomeStep.tsx` | **Create** | Step 1 view. |
| `apps/desktop/src/renderer/screens/onboarding/steps/NotionStep.tsx` | **Create** | Step 2 view (token paste + Test). |
| `apps/desktop/src/renderer/screens/onboarding/steps/KindleStep.tsx` | **Create** | Step 3 view (Amazon sign-in). |
| `apps/desktop/src/renderer/screens/onboarding/steps/ConfirmStep.tsx` | **Create** | Step 4 recap view. |
| `apps/desktop/src/renderer/screens/onboarding/steps/FirstSyncStep.tsx` | **Create** | Step 5 transient pane. |
| `apps/desktop/src/renderer/screens/onboarding/OnboardingWizard.tsx` | **Create** | Orchestrator (state, IPC wiring, step routing). |
| `apps/desktop/src/renderer/styles.css` | **Modify** (append) | ~80 lines under existing `.onboarding-*` rules. |
| `apps/desktop/src/renderer/App.tsx` | **Modify** | Replace inline `WindowTitleBar` with import; replace `OnboardingScreen` block with `OnboardingWizard`; extract `handleOnboardingComplete` callback. |
| `apps/desktop/src/renderer/screens/OnboardingScreen.tsx` | **Delete** | Replaced by the wizard directory. |

---

## Task 1: Extract `WindowTitleBar` to its own component

**Files:**
- Create: `apps/desktop/src/renderer/components/WindowTitleBar.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx:105-118` (remove inline function, add import)

- [ ] **Step 1: Create the extracted component**

`apps/desktop/src/renderer/components/WindowTitleBar.tsx`:

```tsx
export function WindowTitleBar(): JSX.Element {
  return (
    <div className="window-titlebar">
      <button
        type="button"
        className="window-close-button"
        aria-label="Close window"
        onClick={() => {
          void window.archi.closeWindow();
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Remove the inline component from `App.tsx`**

Delete lines 105–118 of `apps/desktop/src/renderer/App.tsx` (the `function WindowTitleBar()` declaration).

Add the import near the other component imports at the top of `App.tsx` (alphabetically among `./components/*`):

```tsx
import { WindowTitleBar } from "./components/WindowTitleBar";
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @archi/desktop typecheck`
Expected: PASS (no new errors). The renderer's `tsconfig.renderer.json` will pick up both files.

- [ ] **Step 4: Verify the renderer still builds and runs**

Run: `pnpm --filter @archi/desktop dev:renderer` and confirm Vite reports no compile errors. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/WindowTitleBar.tsx apps/desktop/src/renderer/App.tsx
git commit -m "desktop: extract WindowTitleBar to its own component

Prep for onboarding wizard refactor — both App.tsx and the new
WizardChrome will need this component.
"
```

---

## Task 2: Define onboarding types

**Files:**
- Create: `apps/desktop/src/renderer/screens/onboarding/types.ts`

- [ ] **Step 1: Create the types module**

`apps/desktop/src/renderer/screens/onboarding/types.ts`:

```ts
export type Step = 1 | 2 | 3 | 4 | 5;

export type StepStatus = "idle" | "pending" | "connected" | "error";

export type WizardState = {
  currentStep: Step;
  notionStatus: StepStatus;
  notionLabel: string | null;
  kindleStatus: StepStatus;
  kindleLabel: string | null;
  notionTokenDraft: string;
  stepError: string | null;
  isCompleting: boolean;
};

export type OnboardingCompleteResult = {
  syncStartError: string | null;
};

// Shape that `computeStartStep` reads from. Defensive about missing keys
// because the IPC handler-not-registered race can yield partial results.
export type ConnectionsSnapshot = {
  notion?: { status?: string; diagnostics?: { summary?: string | null } };
  cloud_notebook?: { status?: string; diagnostics?: { summary?: string | null } };
  device_export?: { status?: string };
};
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @archi/desktop typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/screens/onboarding/types.ts
git commit -m "desktop(onboarding): add wizard types module"
```

---

## Task 3: TDD `computeStartStep`

**Files:**
- Create: `apps/desktop/src/renderer/screens/onboarding/computeStartStep.test.ts`
- Create: `apps/desktop/src/renderer/screens/onboarding/computeStartStep.ts`

- [ ] **Step 1: Write the failing test**

`apps/desktop/src/renderer/screens/onboarding/computeStartStep.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeStartStep } from "./computeStartStep";

describe("computeStartStep", () => {
  it("returns 1 when no connections snapshot is available", () => {
    expect(computeStartStep(null)).toBe(1);
    expect(computeStartStep(undefined)).toBe(1);
    expect(computeStartStep({})).toBe(1);
  });

  it("returns 1 when both connections are still configuring or disconnected", () => {
    expect(
      computeStartStep({
        notion: { status: "configuring" },
        cloud_notebook: { status: "configuring" },
      })
    ).toBe(1);
    expect(
      computeStartStep({
        notion: { status: "disconnected" },
        cloud_notebook: { status: "needs_action" },
      })
    ).toBe(1);
  });

  it("returns 2 when only Kindle is connected (Notion still gates the flow)", () => {
    expect(
      computeStartStep({
        notion: { status: "needs_action" },
        cloud_notebook: { status: "connected" },
      })
    ).toBe(2);
  });

  it("returns 3 when only Notion is connected", () => {
    expect(
      computeStartStep({
        notion: { status: "connected" },
        cloud_notebook: { status: "disconnected" },
      })
    ).toBe(3);
  });

  it("returns 4 when both Notion and Kindle are connected", () => {
    expect(
      computeStartStep({
        notion: { status: "connected" },
        cloud_notebook: { status: "connected" },
      })
    ).toBe(4);
  });

  it("treats unknown status strings as not-connected (defaults to step 1)", () => {
    expect(
      computeStartStep({
        notion: { status: "weird_value" },
        cloud_notebook: { status: "another_weird_value" },
      })
    ).toBe(1);
  });

  it("tolerates missing connection keys without throwing", () => {
    expect(computeStartStep({ notion: { status: "connected" } })).toBe(3);
    expect(computeStartStep({ cloud_notebook: { status: "connected" } })).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @archi/desktop test computeStartStep`
Expected: FAIL with `Cannot find module './computeStartStep'` (or similar import-not-found error).

- [ ] **Step 3: Implement the minimal function**

`apps/desktop/src/renderer/screens/onboarding/computeStartStep.ts`:

```ts
import type { ConnectionsSnapshot, Step } from "./types";

export function computeStartStep(connections: ConnectionsSnapshot | null | undefined): Step {
  if (!connections) {
    return 1;
  }
  const notionConnected = connections.notion?.status === "connected";
  const kindleConnected = connections.cloud_notebook?.status === "connected";

  if (notionConnected && kindleConnected) {
    return 4;
  }
  if (notionConnected) {
    return 3;
  }
  if (kindleConnected) {
    return 2;
  }
  return 1;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @archi/desktop test computeStartStep`
Expected: PASS — 7 tests pass.

- [ ] **Step 5: Verify typecheck**

Run: `pnpm --filter @archi/desktop typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/screens/onboarding/computeStartStep.ts apps/desktop/src/renderer/screens/onboarding/computeStartStep.test.ts
git commit -m "desktop(onboarding): add computeStartStep with unit tests

Pure function that decides which wizard step to drop a returning
user onto, based on their current connection state.
"
```

---

## Task 4: Build `WizardChrome` shell

**Files:**
- Create: `apps/desktop/src/renderer/screens/onboarding/WizardChrome.tsx`

- [ ] **Step 1: Create the chrome component**

`apps/desktop/src/renderer/screens/onboarding/WizardChrome.tsx`:

```tsx
import type { ReactNode } from "react";
import { WindowTitleBar } from "../../components/WindowTitleBar";
import type { Step } from "./types";

const STEP_COUNT = 5;

type Props = {
  currentStep: Step;
  children: ReactNode;
  ipcError?: string | null;
  stepError?: string | null;
  showBack: boolean;
  showSkip: boolean;
  showFooter?: boolean;
  continueLabel: string;
  continueDisabled: boolean;
  onBack?: () => void;
  onSkip?: () => void;
  onContinue: () => void;
};

export function WizardChrome({
  currentStep,
  children,
  ipcError,
  stepError,
  showBack,
  showSkip,
  showFooter = true,
  continueLabel,
  continueDisabled,
  onBack,
  onSkip,
  onContinue,
}: Props): JSX.Element {
  return (
    <main className="onboarding-layout">
      <WindowTitleBar />
      <section className="screen-card onboarding-card onboarding-wizard-card">
        <div
          className="onboarding-wizard-progress"
          role="progressbar"
          aria-valuenow={currentStep}
          aria-valuemin={1}
          aria-valuemax={STEP_COUNT}
          aria-label={`Step ${currentStep} of ${STEP_COUNT}`}
        >
          {Array.from({ length: STEP_COUNT }, (_, idx) => {
            const step = idx + 1;
            const isCurrent = step === currentStep;
            const isDone = step < currentStep;
            const className =
              "onboarding-wizard-progress-dot" +
              (isCurrent ? " onboarding-wizard-progress-dot--current" : "") +
              (isDone ? " onboarding-wizard-progress-dot--done" : "");
            return <span key={step} className={className} aria-hidden="true" />;
          })}
        </div>
        {ipcError ? <p className="error banner-error">{ipcError}</p> : null}
        <div className="onboarding-wizard-step-body">{children}</div>
        {stepError ? <p className="error banner-error">{stepError}</p> : null}
        {showFooter ? (
          <div className="onboarding-wizard-footer">
            {showBack ? (
              <button type="button" className="button-ghost onboarding-wizard-back" onClick={onBack}>
                ← Back
              </button>
            ) : (
              <span aria-hidden="true" />
            )}
            {showSkip ? (
              <button type="button" className="onboarding-wizard-skip-link" onClick={onSkip}>
                Skip for now
              </button>
            ) : (
              <span aria-hidden="true" />
            )}
            <button
              type="button"
              className="button-primary onboarding-wizard-continue"
              disabled={continueDisabled}
              onClick={onContinue}
            >
              {continueLabel}
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @archi/desktop typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/screens/onboarding/WizardChrome.tsx
git commit -m "desktop(onboarding): add WizardChrome shell with progress + footer"
```

---

## Task 5: Build `WelcomeStep`

**Files:**
- Create: `apps/desktop/src/renderer/screens/onboarding/steps/WelcomeStep.tsx`

- [ ] **Step 1: Create the welcome step**

`apps/desktop/src/renderer/screens/onboarding/steps/WelcomeStep.tsx`:

```tsx
export function WelcomeStep(): JSX.Element {
  return (
    <div className="onboarding-wizard-step">
      <p className="content-eyebrow">Setup · Step 1 of 5</p>
      <h1>Set up Archi.</h1>
      <p>
        Archi pulls your Kindle highlights into a Notion database and keeps them searchable on your machine. Two
        connections to make: your Notion workspace, and your Kindle account. Takes a couple of minutes.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @archi/desktop typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/screens/onboarding/steps/WelcomeStep.tsx
git commit -m "desktop(onboarding): add WelcomeStep view"
```

---

## Task 6: Build `NotionStep`

**Files:**
- Create: `apps/desktop/src/renderer/screens/onboarding/steps/NotionStep.tsx`

- [ ] **Step 1: Create the Notion step**

`apps/desktop/src/renderer/screens/onboarding/steps/NotionStep.tsx`:

```tsx
import type { StepStatus } from "../types";

type Props = {
  tokenDraft: string;
  status: StepStatus;
  label: string | null;
  onTokenChange: (next: string) => void;
  onTest: () => void;
};

export function NotionStep({ tokenDraft, status, label, onTokenChange, onTest }: Props): JSX.Element {
  const testDisabled = status === "pending" || tokenDraft.trim().length === 0;
  return (
    <div className="onboarding-wizard-step">
      <p className="content-eyebrow">Step 2 of 5 · Notion</p>
      <h1>Connect your Notion workspace.</h1>
      <p>
        Paste an internal integration token from <code>notion.so/profile/integrations</code>. Archi will write your
        library to a database it creates the first time you sync.
      </p>
      <label className="onboarding-wizard-field-label" htmlFor="onboarding-notion-token">
        Integration token
      </label>
      <input
        id="onboarding-notion-token"
        type="password"
        autoComplete="off"
        spellCheck={false}
        className="onboarding-wizard-input"
        placeholder="secret_…"
        value={tokenDraft}
        onChange={(event) => onTokenChange(event.target.value)}
      />
      <div className="onboarding-wizard-row">
        <button
          type="button"
          className="button-ghost"
          onClick={onTest}
          disabled={testDisabled}
        >
          {status === "pending" ? "Testing…" : "Test connection"}
        </button>
        {status === "connected" ? (
          <span className="onboarding-wizard-status onboarding-wizard-status--ok">
            ✓ {label ?? "Connected"}
          </span>
        ) : null}
      </div>
      <p className="onboarding-wizard-help">
        Need help?{" "}
        <a
          href="https://www.notion.so/help/create-integrations-with-the-notion-api"
          target="_blank"
          rel="noreferrer"
        >
          How to create a Notion integration token →
        </a>
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @archi/desktop typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/screens/onboarding/steps/NotionStep.tsx
git commit -m "desktop(onboarding): add NotionStep view"
```

---

## Task 7: Build `KindleStep`

**Files:**
- Create: `apps/desktop/src/renderer/screens/onboarding/steps/KindleStep.tsx`

- [ ] **Step 1: Create the Kindle step**

`apps/desktop/src/renderer/screens/onboarding/steps/KindleStep.tsx`:

```tsx
import type { StepStatus } from "../types";

type Props = {
  status: StepStatus;
  label: string | null;
  onSignIn: () => void;
};

export function KindleStep({ status, label, onSignIn }: Props): JSX.Element {
  return (
    <div className="onboarding-wizard-step">
      <p className="content-eyebrow">Step 3 of 5 · Kindle</p>
      <h1>Connect your Kindle highlights.</h1>
      <p>
        Sign in to your Amazon account so Archi can read your Kindle notebook. The sign-in window opens once; Archi
        keeps the session and refreshes it as needed.
      </p>
      <div className="onboarding-wizard-row">
        <button
          type="button"
          className="button-ghost"
          onClick={onSignIn}
          disabled={status === "pending" || status === "connected"}
        >
          {status === "pending" ? "Opening sign-in…" : status === "connected" ? "Signed in" : "Sign in with Amazon"}
        </button>
        {status === "connected" ? (
          <span className="onboarding-wizard-status onboarding-wizard-status--ok">
            ✓ {label ?? "Signed in"}
          </span>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @archi/desktop typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/screens/onboarding/steps/KindleStep.tsx
git commit -m "desktop(onboarding): add KindleStep view"
```

---

## Task 8: Build `ConfirmStep`

**Files:**
- Create: `apps/desktop/src/renderer/screens/onboarding/steps/ConfirmStep.tsx`

- [ ] **Step 1: Create the confirm step**

`apps/desktop/src/renderer/screens/onboarding/steps/ConfirmStep.tsx`:

```tsx
import type { StepStatus } from "../types";

type Props = {
  notionStatus: StepStatus;
  notionLabel: string | null;
  kindleStatus: StepStatus;
  kindleLabel: string | null;
};

function statusLine(label: string, status: StepStatus, detail: string | null): JSX.Element {
  if (status === "connected") {
    return (
      <li className="onboarding-wizard-status onboarding-wizard-status--ok">
        ✓ {label} · {detail ?? "Connected"}
      </li>
    );
  }
  return (
    <li className="onboarding-wizard-status onboarding-wizard-status--muted">
      — {label} · Not connected. You can finish this in Settings later.
    </li>
  );
}

export function ConfirmStep({ notionStatus, notionLabel, kindleStatus, kindleLabel }: Props): JSX.Element {
  return (
    <div className="onboarding-wizard-step">
      <p className="content-eyebrow">Step 4 of 5 · Ready</p>
      <h1>You're ready to sync.</h1>
      <ul className="onboarding-wizard-recap">
        {statusLine("Notion", notionStatus, notionLabel)}
        {statusLine("Kindle", kindleStatus, kindleLabel)}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @archi/desktop typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/screens/onboarding/steps/ConfirmStep.tsx
git commit -m "desktop(onboarding): add ConfirmStep recap view"
```

---

## Task 9: Build `FirstSyncStep`

**Files:**
- Create: `apps/desktop/src/renderer/screens/onboarding/steps/FirstSyncStep.tsx`

- [ ] **Step 1: Create the first-sync step**

`apps/desktop/src/renderer/screens/onboarding/steps/FirstSyncStep.tsx`:

```tsx
type Props = {
  isCompleting: boolean;
  hasError: boolean;
};

export function FirstSyncStep({ isCompleting, hasError }: Props): JSX.Element {
  return (
    <div className="onboarding-wizard-step">
      <p className="content-eyebrow">Step 5 of 5 · Importing</p>
      <h1>Bringing in your library…</h1>
      <p>
        {hasError
          ? "Something went wrong saving your setup. Try again to continue."
          : isCompleting
            ? "Finishing setup and starting your first sync."
            : "Almost there."}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @archi/desktop typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/screens/onboarding/steps/FirstSyncStep.tsx
git commit -m "desktop(onboarding): add FirstSyncStep transient view"
```

---

## Task 10: Build the `OnboardingWizard` orchestrator

**Files:**
- Create: `apps/desktop/src/renderer/screens/onboarding/OnboardingWizard.tsx`

- [ ] **Step 1: Create the orchestrator**

`apps/desktop/src/renderer/screens/onboarding/OnboardingWizard.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { computeStartStep } from "./computeStartStep";
import { ConfirmStep } from "./steps/ConfirmStep";
import { FirstSyncStep } from "./steps/FirstSyncStep";
import { KindleStep } from "./steps/KindleStep";
import { NotionStep } from "./steps/NotionStep";
import { WelcomeStep } from "./steps/WelcomeStep";
import { WizardChrome } from "./WizardChrome";
import type { ConnectionsSnapshot, OnboardingCompleteResult, Step, WizardState } from "./types";

type Props = {
  ipcError: string | null;
  onComplete: (result: OnboardingCompleteResult) => void;
};

const INITIAL_STATE: WizardState = {
  currentStep: 1,
  notionStatus: "idle",
  notionLabel: null,
  kindleStatus: "idle",
  kindleLabel: null,
  notionTokenDraft: "",
  stepError: null,
  isCompleting: false,
};

export function OnboardingWizard({ ipcError, onComplete }: Props): JSX.Element {
  const [state, setState] = useState<WizardState>(INITIAL_STATE);

  // Mount: fast-forward to the first unfinished step based on existing connections.
  useEffect(() => {
    void window.archi
      .getConnections()
      .then((connections: ConnectionsSnapshot) => {
        setState((prev) => ({
          ...prev,
          currentStep: computeStartStep(connections),
          notionStatus: connections.notion?.status === "connected" ? "connected" : prev.notionStatus,
          notionLabel:
            connections.notion?.status === "connected"
              ? connections.notion?.diagnostics?.summary ?? "Connected"
              : prev.notionLabel,
          kindleStatus: connections.cloud_notebook?.status === "connected" ? "connected" : prev.kindleStatus,
          kindleLabel:
            connections.cloud_notebook?.status === "connected"
              ? connections.cloud_notebook?.diagnostics?.summary ?? "Connected"
              : prev.kindleLabel,
        }));
      })
      .catch(() => {
        // Stay on step 1. App-level IPC retry logic covers the cold-start race.
      });
  }, []);

  const advanceTo = useCallback((step: Step) => {
    setState((prev) => ({ ...prev, currentStep: step, stepError: null }));
  }, []);

  const testNotion = useCallback(() => {
    setState((prev) => ({ ...prev, notionStatus: "pending", stepError: null }));
    void window.archi
      .setNotionToken(state.notionTokenDraft)
      .then((next) => {
        setState((prev) => {
          if (next.status === "connected") {
            return {
              ...prev,
              notionStatus: "connected",
              notionLabel: next.diagnostics?.summary ?? "Connected",
              stepError: null,
            };
          }
          return {
            ...prev,
            notionStatus: "error",
            notionLabel: null,
            stepError:
              next.diagnostics?.details ?? next.diagnostics?.summary ?? "Could not connect to Notion.",
          };
        });
      })
      .catch((err) => {
        setState((prev) => ({
          ...prev,
          notionStatus: "error",
          notionLabel: null,
          stepError: err instanceof Error ? err.message : "Could not connect to Notion.",
        }));
      });
  }, [state.notionTokenDraft]);

  const signInKindle = useCallback(() => {
    setState((prev) => ({ ...prev, kindleStatus: "pending", stepError: null }));
    void window.archi
      .connectConnection("cloud_notebook")
      .then((next) => {
        setState((prev) => {
          if (next.status === "connected") {
            return {
              ...prev,
              kindleStatus: "connected",
              kindleLabel: next.diagnostics?.summary ?? "Signed in",
              stepError: null,
            };
          }
          return {
            ...prev,
            kindleStatus: "error",
            kindleLabel: null,
            stepError:
              next.diagnostics?.details ?? next.diagnostics?.summary ?? "Sign-in didn't complete.",
          };
        });
      })
      .catch((err) => {
        setState((prev) => ({
          ...prev,
          kindleStatus: "error",
          kindleLabel: null,
          stepError: err instanceof Error ? err.message : "Sign-in didn't complete.",
        }));
      });
  }, []);

  const finish = useCallback(() => {
    setState((prev) => ({ ...prev, currentStep: 5, isCompleting: true, stepError: null }));
    void window.archi
      .completeOnboarding()
      .then(() => {
        void window.archi.runSyncNow().catch((err) => {
          const message = err instanceof Error ? err.message : "Sync failed to start.";
          onComplete({ syncStartError: message });
        });
        onComplete({ syncStartError: null });
      })
      .catch((err) => {
        setState((prev) => ({
          ...prev,
          isCompleting: false,
          stepError: err instanceof Error ? err.message : "Could not save onboarding state.",
        }));
      });
  }, [onComplete]);

  const retryFinish = finish;

  const wizardError = state.stepError ?? null;

  switch (state.currentStep) {
    case 1:
      return (
        <WizardChrome
          currentStep={1}
          ipcError={ipcError}
          stepError={wizardError}
          showBack={false}
          showSkip={false}
          continueLabel="Get started →"
          continueDisabled={false}
          onContinue={() => advanceTo(2)}
        >
          <WelcomeStep />
        </WizardChrome>
      );
    case 2:
      return (
        <WizardChrome
          currentStep={2}
          ipcError={ipcError}
          stepError={wizardError}
          showBack={false}
          showSkip={true}
          continueLabel="Continue →"
          continueDisabled={state.notionStatus !== "connected"}
          onSkip={() => advanceTo(3)}
          onContinue={() => advanceTo(3)}
        >
          <NotionStep
            tokenDraft={state.notionTokenDraft}
            status={state.notionStatus}
            label={state.notionLabel}
            onTokenChange={(next) =>
              setState((prev) => ({ ...prev, notionTokenDraft: next, stepError: null }))
            }
            onTest={testNotion}
          />
        </WizardChrome>
      );
    case 3:
      return (
        <WizardChrome
          currentStep={3}
          ipcError={ipcError}
          stepError={wizardError}
          showBack={true}
          showSkip={true}
          continueLabel="Continue →"
          continueDisabled={state.kindleStatus !== "connected"}
          onBack={() => advanceTo(2)}
          onSkip={() => advanceTo(4)}
          onContinue={() => advanceTo(4)}
        >
          <KindleStep status={state.kindleStatus} label={state.kindleLabel} onSignIn={signInKindle} />
        </WizardChrome>
      );
    case 4:
      return (
        <WizardChrome
          currentStep={4}
          ipcError={ipcError}
          stepError={wizardError}
          showBack={true}
          showSkip={false}
          continueLabel="Start first sync → Open Archi"
          continueDisabled={false}
          onBack={() => advanceTo(3)}
          onContinue={finish}
        >
          <ConfirmStep
            notionStatus={state.notionStatus}
            notionLabel={state.notionLabel}
            kindleStatus={state.kindleStatus}
            kindleLabel={state.kindleLabel}
          />
        </WizardChrome>
      );
    case 5:
      return (
        <WizardChrome
          currentStep={5}
          ipcError={ipcError}
          stepError={wizardError}
          showBack={false}
          showSkip={false}
          showFooter={wizardError !== null}
          continueLabel="Try again"
          continueDisabled={false}
          onContinue={retryFinish}
        >
          <FirstSyncStep isCompleting={state.isCompleting} hasError={wizardError !== null} />
        </WizardChrome>
      );
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @archi/desktop typecheck`
Expected: PASS.

- [ ] **Step 3: Verify lint**

Run: `pnpm --filter @archi/desktop lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/screens/onboarding/OnboardingWizard.tsx
git commit -m "desktop(onboarding): add OnboardingWizard orchestrator

Owns step routing + IPC wiring for the 5-step wizard. Reuses existing
preload handlers verbatim — no main-process changes.
"
```

---

## Task 11: Append wizard CSS

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css` (append after line 536, end of existing `.onboarding-*` block)

- [ ] **Step 1: Append the wizard CSS**

Open `apps/desktop/src/renderer/styles.css`. Find the last existing `.onboarding-*` rule (`.onboarding-actions`, around line 534–536). Append directly after it (BEFORE the next unrelated rule):

```css
.onboarding-wizard-card {
  display: grid;
  gap: 20px;
  padding: 40px 44px 28px;
}

.onboarding-wizard-progress {
  display: flex;
  gap: 8px;
  align-items: center;
}

.onboarding-wizard-progress-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.5px solid var(--ink-300);
  background: transparent;
  display: inline-block;
}

.onboarding-wizard-progress-dot--current {
  background: var(--accent);
  border-color: var(--accent);
}

.onboarding-wizard-progress-dot--done {
  background: var(--ink-500);
  border-color: var(--ink-500);
}

.onboarding-wizard-step {
  display: grid;
  gap: 14px;
}

.onboarding-wizard-step h1 {
  font-size: 38px;
  line-height: 1.08;
  margin: 4px 0 2px;
}

.onboarding-wizard-step-body {
  animation: onboarding-wizard-fade-in 120ms ease-out;
}

@keyframes onboarding-wizard-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.onboarding-wizard-field-label {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 6px;
}

.onboarding-wizard-input {
  font: inherit;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface, #fff);
  color: var(--text);
  width: 100%;
}

.onboarding-wizard-input:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 36%, transparent);
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
}

.onboarding-wizard-row {
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
}

.onboarding-wizard-status {
  font-size: 14px;
}

.onboarding-wizard-status--ok {
  color: var(--success);
}

.onboarding-wizard-status--error {
  color: var(--error);
}

.onboarding-wizard-status--muted {
  color: var(--text-muted);
}

.onboarding-wizard-help {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 4px;
}

.onboarding-wizard-recap {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: grid;
  gap: 8px;
}

.onboarding-wizard-footer {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  margin-top: 8px;
}

.onboarding-wizard-skip-link {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 4px 8px;
  font: inherit;
  font-size: 14px;
  color: var(--text-muted);
  cursor: pointer;
  justify-self: end;
}

.onboarding-wizard-skip-link:hover,
.onboarding-wizard-skip-link:focus-visible {
  color: var(--text);
  text-decoration: underline;
  outline: none;
}
```

- [ ] **Step 2: Verify the dev renderer still compiles**

Run: `pnpm --filter @archi/desktop dev:renderer` for ~5 seconds, confirm Vite reports no CSS errors, stop it.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/styles.css
git commit -m "desktop(onboarding): add wizard CSS — progress dots, footer, status lines"
```

---

## Task 12: Wire the wizard into `App.tsx` and delete the old screen

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Delete: `apps/desktop/src/renderer/screens/OnboardingScreen.tsx`

- [ ] **Step 1: Swap the import in `App.tsx`**

At the top of `apps/desktop/src/renderer/App.tsx`, find:

```tsx
import { OnboardingScreen } from "./screens/OnboardingScreen";
```

Replace with:

```tsx
import { OnboardingWizard } from "./screens/onboarding/OnboardingWizard";
```

- [ ] **Step 2: Remove the `isCompletingOnboarding` state**

Find the line declaring `isCompletingOnboarding` (around line 198):

```tsx
const [isCompletingOnboarding, setIsCompletingOnboarding] = useState(false);
```

Delete it. The wizard now owns that state internally.

- [ ] **Step 3: Add a `handleOnboardingComplete` callback**

In `App.tsx`, just below the existing `refreshLists` callback declaration, add:

```tsx
const handleOnboardingComplete = useCallback(
  (result: { syncStartError: string | null }): void => {
    setOnboardingCompleted(true);
    setSettingsDefaultTab("connections");
    setActiveScreen("Home");
    if (result.syncStartError) {
      setIpcError(result.syncStartError);
    }
    refreshConnections();
    refreshLists();
    void window.archi.getSyncState().then(setSyncState);
  },
  [refreshConnections, refreshLists]
);
```

- [ ] **Step 4: Replace the `!onboardingCompleted` render block**

Find the block (around line 743):

```tsx
if (!onboardingCompleted) {
  return (
    <main className="onboarding-layout">
      <WindowTitleBar />
      <section className="screen-card onboarding-card">
        {ipcError ? <p className="error banner-error">{ipcError}</p> : null}
        <OnboardingScreen
          isCompleting={isCompletingOnboarding}
          onContinue={() => {
            if (isCompletingOnboarding) {
              return;
            }
            setIpcError(null);
            setIsCompletingOnboarding(true);
            void window.archi
              .completeOnboarding()
              .then((result) => {
                setOnboardingCompleted(result.onboardingCompleted);
                setSettingsDefaultTab("connections");
                setActiveScreen("Settings");
                refreshConnections();
                refreshLists();
                void window.archi.getSyncState().then(setSyncState);
              })
              .catch((error) => {
                setIpcError(
                  `Could not complete onboarding (${error instanceof Error ? error.message : "unknown error"}). ` +
                    "The main process may not be running correctly — check the terminal output."
                );
              })
              .finally(() => {
                setIsCompletingOnboarding(false);
              });
          }}
        />
      </section>
    </main>
  );
}
```

Replace it entirely with:

```tsx
if (!onboardingCompleted) {
  return <OnboardingWizard ipcError={ipcError} onComplete={handleOnboardingComplete} />;
}
```

- [ ] **Step 5: Delete the old `OnboardingScreen.tsx`**

Run: `rm apps/desktop/src/renderer/screens/OnboardingScreen.tsx`

- [ ] **Step 6: Verify typecheck**

Run: `pnpm --filter @archi/desktop typecheck`
Expected: PASS — no unresolved imports of `OnboardingScreen`, no unused `WindowTitleBar` warnings, no missing `isCompletingOnboarding` references.

If typecheck reports the inline `WindowTitleBar` function from Task 1 still exists in App.tsx, return to that task — it should have been removed.

- [ ] **Step 7: Verify lint**

Run: `pnpm --filter @archi/desktop lint`
Expected: PASS.

- [ ] **Step 8: Verify the unit test still passes**

Run: `pnpm --filter @archi/desktop test computeStartStep`
Expected: PASS — 7 tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/screens/OnboardingScreen.tsx
git commit -m "desktop(onboarding): replace welcome screen with 5-step wizard

App.tsx now renders OnboardingWizard while onboardingCompleted is false.
Post-wizard navigation lands on Home (where SyncBanner shows live import
progress) instead of Settings → Connections.
"
```

---

## Task 13: Manual smoke test

**Files:** none modified.

This is a verification-only task. Run each scenario and check the boxes only if the observed behavior matches.

- [ ] **Scenario 1 — Fresh install**

Steps:
1. `rm -f "$HOME/Library/Application Support/Archi/preferences.json"`
2. `pnpm --filter @archi/desktop dev`
3. Observe.

Expected: wizard opens at step 1 (Welcome). Progress dots show `● ○ ○ ○ ○`.

- [ ] **Scenario 2 — Happy path**

Steps:
1. Continuing from Scenario 1, click `Get started →` through to step 2.
2. Paste a known-good Notion integration token → click `Test connection` → wait for ✓.
3. Click `Continue →` to step 3.
4. Click `Sign in with Amazon`, complete the Amazon flow → wait for ✓.
5. Click `Continue →` to step 4.
6. Click `Start first sync → Open Archi`.

Expected: brief transition through step 5 (under ~1s), then lands on Home with SyncBanner showing live import progress. Library begins populating as the sync completes.

- [ ] **Scenario 3 — Skip everything**

Steps:
1. Reset (`rm preferences.json`, restart dev).
2. Click `Get started →`.
3. Click `Skip for now` on step 2.
4. Click `Skip for now` on step 3.
5. Click `Start first sync → Open Archi` on step 4.

Expected: lands on Home. Sidebar Settings nav shows the warning dot (`sidebar-nav-warning-dot`). No books in Library, no passages. SyncBanner does NOT appear (or appears very briefly with "no healthy sources" — that's fine).

- [ ] **Scenario 4 — Resume mid-wizard**

Steps:
1. Reset (`rm preferences.json`, restart dev).
2. Complete step 2 (Notion ✓), then close the app entirely (Cmd+Q).
3. Relaunch with `pnpm --filter @archi/desktop dev`.

Expected: wizard opens at step 3 (Kindle). Progress dots show `● ● ● ○ ○`. Hitting Back returns to step 2 with the green ✓ visible.

- [ ] **Scenario 5 — Bad Notion token**

Steps:
1. On step 2 of a fresh wizard, paste `secret_definitely_not_real` → click `Test connection`.

Expected: inline `banner-error` appears with a real error message from the Notion adapter. Token remains in the input. `Continue →` stays disabled. `Skip for now` still works.

- [ ] **Scenario 6 — Cancel Amazon sign-in**

Steps:
1. On step 3 of a fresh wizard, click `Sign in with Amazon`, then close the Amazon login window without signing in.

Expected: inline forgiving error message. No crash. `Sign in with Amazon` becomes clickable again. `Skip for now` works.

- [ ] **Scenario 7 — Both connected, onboardingCompleted manually false**

Steps:
1. After completing onboarding successfully once, manually edit `preferences.json`: set `onboardingCompleted` to `false`. Restart the app.

Expected: wizard opens directly at step 4 (Confirm) with both ✓ lines shown. One click on `Start first sync → Open Archi` returns user to Home.

- [ ] **Scenario 8 — Parallel-agent rebase check**

Steps:
1. After all wizard work is committed on this branch, fetch the latest from `worktree-local-semantic-search` and `worktree-sync-pause` branches.
2. Attempt a rebase or merge of this branch onto each of them.

Expected: conflicts (if any) are confined to `apps/desktop/src/renderer/App.tsx` and resolve cleanly. No conflicts in `HomeScreen.tsx`, `ConnectionsScreen.tsx`, or any main-process file.

---

## Done criteria

All 13 task checklists complete, all scenarios verified, no new entries in `pnpm --filter @archi/desktop typecheck` or `lint` output.
