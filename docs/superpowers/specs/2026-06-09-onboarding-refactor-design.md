# Onboarding Refactor — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorming → ready for implementation plan)

## Goal

Replace the current single-screen "Welcome → Open Settings" onboarding with a 5-step in-app wizard that walks first-run users through (1) what Archi does, (2) connecting Notion, (3) connecting Kindle highlights, (4) a recap, and (5) kicking off the first sync. Users land on Home with a real library importing — not in the Connections tab with no guidance.

The current onboarding ([`apps/desktop/src/renderer/screens/OnboardingScreen.tsx`](../../apps/desktop/src/renderer/screens/OnboardingScreen.tsx)) is 22 lines and one button. The wizard becomes a small directory of focused components.

## Non-goals

- No new main-process IPC. The wizard reuses `getConnections`, `setNotionToken`, `testConnection`, `connectConnection`, `completeOnboarding`, `runSyncNow`, `getSyncState` exactly as they exist today.
- No persisted "current step" or "wizard state" anywhere. Resume after restart is computed purely from `getConnections()`.
- No edits to `HomeScreen.tsx` / `screens/home/*` (parallel `local-semantic-search` agent), `ConnectionsScreen.tsx` / connection-card components (parallel `sync-pause` agent), `main/connections.ts`, or `main/index.ts` connection-related handlers.
- No device-export option surfaced inside the wizard. "Kindle highlights" in the wizard means the cloud-notebook scrape flow (`connectConnection('cloud_notebook')`). Device-export remains in Settings → Connections as today.
- No additional Kindle method picker in the wizard. Single path.
- No "Finish setup" card on Home for users who skip — relies on the existing sidebar warning dot (just shipped) as the sole nudge.
- No new test framework. Playwright is not introduced as a side-effect.
- No redesign of `OnboardingScreen.tsx`'s parent (`App.tsx`) beyond the swap described below.
- No animation beyond a 120ms opacity fade on step transitions.

## Information architecture

While `settings.onboardingCompleted === false`, `App.tsx` continues to render an alternate root (no sidebar, no content header) — same gate pattern as today. The alternate root is now `<OnboardingWizard ipcError={ipcError} onComplete={handleOnboardingComplete} />` instead of `<OnboardingScreen />`.

The wizard occupies the full window with the existing `.window-titlebar` (close button). The sidebar, content header, and SyncBanner are not rendered while onboarding is incomplete.

5 steps, all in-wizard:

| # | Step | Connection touched | Skippable |
|---|---|---|---|
| 1 | Welcome | — | n/a (no skip; one button: "Get started") |
| 2 | Notion | `setNotionToken` → `testConnection('notion')` | yes ("Skip for now") |
| 3 | Kindle highlights | `connectConnection('cloud_notebook')` | yes |
| 4 | Confirm | — | n/a |
| 5 | First sync | `completeOnboarding` then fire-and-forget `runSyncNow` | n/a (auto-transitions) |

**Entry point — always Welcome.** Earlier drafts of this spec had a `computeStartStep` resume function that fast-forwarded returning users past steps they'd already completed. Removed during the post-merge smoke test (commit added below this design): Welcome is a one-click pitch screen, not a chore, and skipping it makes the wizard feel disjointed when triggered manually (e.g., during testing or after a forced re-onboarding from an upgrade). The wizard always starts at Step 1; on mount, `getConnections()` is read only to *seed already-connected status* on steps 2/3 (so user sees ✓ when they arrive there) and on the Confirm step.

## File layout

New (mirrors the existing `screens/home/` pattern):

```
apps/desktop/src/renderer/screens/onboarding/
├── OnboardingWizard.tsx        ← orchestrator: step state, IPC wiring, onComplete
├── WizardChrome.tsx            ← titlebar + progress dots + footer (Back / Skip / Continue)
├── types.ts                    ← Step union, per-step status types, prop shapes
└── steps/
    ├── WelcomeStep.tsx
    ├── NotionStep.tsx
    ├── KindleStep.tsx
    ├── ConfirmStep.tsx
    └── FirstSyncStep.tsx
```

Deleted: `apps/desktop/src/renderer/screens/OnboardingScreen.tsx`.

Modified: `apps/desktop/src/renderer/App.tsx` (~10 line diff — import swap + extract the inline `onContinue` closure into a named handler). `apps/desktop/src/renderer/styles.css` (~50 lines appended under existing `.onboarding-*` rules).

## Wizard state machine

```ts
// types.ts
export type Step = 1 | 2 | 3 | 4 | 5;
export type StepStatus = 'idle' | 'pending' | 'connected' | 'error';

export type WizardState = {
  currentStep: Step;
  notionStatus: StepStatus;
  notionLabel: string | null;        // "Connected to <workspace name>" once known
  kindleStatus: StepStatus;
  kindleLabel: string | null;        // "Signed in as <email>" or just "Signed in"
  notionTokenDraft: string;          // owned by NotionStep but lifted so Back/Forward preserves it
  stepError: string | null;          // per-step inline error
  isCompleting: boolean;             // true during step-5 completeOnboarding/runSyncNow
};
```

`OnboardingWizard.tsx` holds this state in a single `useState<WizardState>(...)`. No reducer, no context — the surface is small enough that direct setter calls are clearer than dispatch indirection.

### Mount sequence

```ts
useEffect(() => {
  void window.archi.getConnections().then((connections) => {
    setState((prev) => ({
      ...prev,
      currentStep: computeStartStep(connections),
      notionStatus: connections.notion.status === 'connected' ? 'connected' : prev.notionStatus,
      notionLabel: connections.notion.status === 'connected'
        ? (connections.notion.diagnostics.summary ?? null)
        : null,
      kindleStatus: connections.cloud_notebook.status === 'connected' ? 'connected' : prev.kindleStatus,
      kindleLabel: connections.cloud_notebook.status === 'connected'
        ? (connections.cloud_notebook.diagnostics.summary ?? null)
        : null,
    }));
  }).catch(() => {
    // Fall back to step 1; App.tsx's existing IPC retry handles the "handler not registered yet" race.
  });
}, []);
```

### `computeStartStep` (pure)

```ts
export function computeStartStep(
  connections: Record<'notion' | 'cloud_notebook' | 'device_export', { status: string }>
): Step {
  const notion = connections?.notion?.status === 'connected';
  const kindle = connections?.cloud_notebook?.status === 'connected';
  if (notion && kindle) return 4;
  if (notion && !kindle) return 3;
  if (!notion && kindle) return 2;   // Notion is required; always make user finish it
  return 1;
}
```

Cases covered by `computeStartStep.test.ts`:
- empty / all `configuring` → step 1
- only `notion` connected → step 3
- only `cloud_notebook` connected → step 2 (Notion is the gating destination)
- both connected → step 4
- malformed / missing connection keys → step 1 (defensive)
- arbitrary unknown status strings → not `connected` → step 1

## Per-step behavior

### Step 1 — Welcome

Pure presentation. One button (`Get started →`) advances to step 2. No skip link (welcome is 1 click; there's nothing to skip past).

Copy:
- Eyebrow: `Setup · Step 1 of 5`
- H1: **Set up Archi.**
- Body: *Archi pulls your Kindle highlights into a Notion database and keeps them searchable on your machine. Two connections to make: your Notion workspace, and your Kindle account. Takes a couple of minutes.*

### Step 2 — Notion

Token input + `[ Test connection ]` button. On click:

```ts
setState((s) => ({ ...s, notionStatus: 'pending', stepError: null }));
window.archi.setNotionToken(state.notionTokenDraft)
  .then((next) => {
    setState((s) => ({
      ...s,
      notionStatus: next.status === 'connected' ? 'connected' : 'error',
      notionLabel: next.status === 'connected' ? (next.diagnostics.summary ?? null) : null,
      stepError: next.status === 'connected' ? null : (next.diagnostics.details ?? next.diagnostics.summary ?? 'Could not connect to Notion.'),
    }));
  })
  .catch((err) => {
    setState((s) => ({ ...s, notionStatus: 'error', stepError: err instanceof Error ? err.message : 'Could not connect to Notion.' }));
  });
```

`Continue →` is enabled only when `notionStatus === 'connected'`. `Skip for now` is always enabled and advances to step 3 regardless of status (it does NOT mutate the connection — skipped means "leave whatever's there alone").

`Back` is hidden (step 2 has no previous step worth reopening — Welcome doesn't accept input).

Copy:
- Eyebrow: `Step 2 of 5 · Notion`
- H1: **Connect your Notion workspace.**
- Body: *Paste an internal integration token from `notion.so/profile/integrations`. Archi will write your library to a database it creates the first time you sync.*
- Help link (small text under input): *How do I create a Notion integration token? →* (opens the Notion docs page via the existing OS browser handler)

### Step 3 — Kindle highlights

`[ Sign in with Amazon ]` button. On click:

```ts
setState((s) => ({ ...s, kindleStatus: 'pending', stepError: null }));
window.archi.connectConnection('cloud_notebook')
  .then((next) => {
    setState((s) => ({
      ...s,
      kindleStatus: next.status === 'connected' ? 'connected' : 'error',
      kindleLabel: next.status === 'connected' ? (next.diagnostics.summary ?? null) : null,
      stepError: next.status === 'connected' ? null : (next.diagnostics.details ?? next.diagnostics.summary ?? 'Sign-in didn’t complete.'),
    }));
  })
  .catch((err) => {
    setState((s) => ({ ...s, kindleStatus: 'error', stepError: err instanceof Error ? err.message : 'Sign-in didn’t complete.' }));
  });
```

Same `Continue` / `Skip` rules as step 2. `Back` jumps to step 2.

Copy:
- Eyebrow: `Step 3 of 5 · Kindle`
- H1: **Connect your Kindle highlights.**
- Body: *Sign in to your Amazon account so Archi can read your Kindle notebook. The sign-in window opens once; Archi keeps the session and refreshes it as needed.*

### Step 4 — Confirm

Pure read of `notionStatus` / `kindleStatus`. Renders a recap list:

- `✓ Notion · <notionLabel>` when connected, else `— Notion · Not connected. You can finish this in Settings later.`
- `✓ Kindle · <kindleLabel>` when connected, else `— Kindle · Not connected. You can finish this in Settings later.`

Primary button: `Start first sync → Open Archi`. Always enabled. `Back` jumps to step 3.

Copy:
- Eyebrow: `Step 4 of 5 · Ready`
- H1: **You're ready to sync.**

### Step 5 — First sync

Transient. Renders a one-line status (`Bringing in your library…`) while:

```ts
setState((s) => ({ ...s, isCompleting: true, stepError: null }));
window.archi.completeOnboarding()
  .then(() => {
    // Fire-and-forget — Home's SyncBanner handles live progress.
    void window.archi.runSyncNow().catch((err) => {
      const message = err instanceof Error ? err.message : 'Sync failed to start.';
      props.onComplete({ syncStartError: message });
    });
    props.onComplete({ syncStartError: null });
  })
  .catch((err) => {
    setState((s) => ({
      ...s,
      isCompleting: false,
      stepError: err instanceof Error ? err.message : 'Could not save onboarding state.',
    }));
  });
```

If `completeOnboarding` rejects, the user stays on step 5 with the error inline and a `[ Try again ]` button. `runSyncNow` is fire-and-forget — its outcome cannot block exit from the wizard, because at that point onboarding is genuinely done.

`Back` is hidden on step 5 (it's transient; nothing to revisit).

## Chrome (WizardChrome.tsx)

Renders:

1. `.window-titlebar` (existing component / class, used verbatim)
2. `.onboarding-wizard-progress` — flex row of 5 `<span>` dots. Past steps filled with a faint check mark; current step filled solid; future steps outlined. ARIA: `role="progressbar"` with `aria-valuenow={currentStep}` `aria-valuemax={5}`.
3. Children slot (the step content)
4. `.onboarding-wizard-footer` — three-cell layout: `[ ← Back ]` (left, conditionally rendered), `Skip for now` text link (center-right, conditional), `[ Continue → ]` primary button (right).

The footer is sticky to the bottom of the `.onboarding-card`. Buttons are wired through props (`onBack`, `onSkip`, `onContinue`, `continueLabel`, `continueDisabled`, `showBack`, `showSkip`).

## Wiring into App.tsx

The current onboarding block (`App.tsx` lines ~743–781):

```tsx
if (!onboardingCompleted) {
  return (
    <main className="onboarding-layout">
      <WindowTitleBar />
      <section className="screen-card onboarding-card">
        {ipcError ? <p className="error banner-error">{ipcError}</p> : null}
        <OnboardingScreen
          isCompleting={isCompletingOnboarding}
          onContinue={() => { /* long inline handler */ }}
        />
      </section>
    </main>
  );
}
```

Becomes:

```tsx
if (!onboardingCompleted) {
  return (
    <OnboardingWizard
      ipcError={ipcError}
      onComplete={handleOnboardingComplete}
    />
  );
}
```

The `.onboarding-layout` / `.onboarding-card` wrapper moves into `WizardChrome.tsx` (since the chrome belongs to the wizard, not to App.tsx). `WindowTitleBar` is currently a local component inside `App.tsx`; it is extracted to `apps/desktop/src/renderer/components/WindowTitleBar.tsx` (small, isolated, no behavior change) and imported by both `App.tsx` and `WizardChrome.tsx`. The standalone `isCompletingOnboarding` `useState` in App.tsx is removed — that's now owned by the wizard.

The inline `onContinue` closure becomes a named `handleOnboardingComplete` function on App.tsx:

```ts
const handleOnboardingComplete = useCallback((result: { syncStartError: string | null }) => {
  setOnboardingCompleted(true);
  setSettingsDefaultTab('connections'); // preserved from current behavior, in case user wants to verify
  setActiveScreen('Home');               // changed: was 'Settings' — wizard already covers setup
  if (result.syncStartError) setIpcError(result.syncStartError);
  refreshConnections();
  refreshLists();
  void window.archi.getSyncState().then(setSyncState);
}, [refreshConnections, refreshLists]);
```

**Behavior change worth flagging:** post-onboarding lands on Home (where SyncBanner runs), not Settings → Connections like today. That's the whole point of the redesign. If preserving the existing "land on Settings" is desired as a fallback (e.g., when both steps were skipped), we can branch on `result.bothSkipped`; current spec says always-Home for simplicity.

## Error handling

| Failure | Wizard response |
|---|---|
| `getConnections()` rejects on mount | Start at step 1. App.tsx's existing IPC-handler-not-registered retry covers the cold-start race. |
| `setNotionToken` rejects | Inline `.banner-error` under the input with the rejection message. Token stays in input. Continue disabled, Skip enabled. |
| Notion returns `status: 'error'` without rejecting | Render `diagnostics.summary` + `diagnostics.details` in the same inline error slot. |
| `connectConnection('cloud_notebook')` rejects (user closes sign-in window, network failure) | Inline forgiving error: *"Sign-in didn't complete. Try again or skip for now."* Can't reliably distinguish cancel from failure today, so we use a forgiving message. |
| `completeOnboarding()` rejects on step 5 | Stay on step 5, show inline error, swap primary button to `[ Try again ]`. Do NOT call `runSyncNow`. |
| `runSyncNow()` rejects after `completeOnboarding()` succeeded | Still navigate to Home (onboarding IS done). Pass `syncStartError` to App, which puts it in the existing `ipcError` banner. User can hit Sync from Home. |
| `onSyncProgress` events arriving during step 5 | Ignored by wizard. Home's SyncBanner handles them. |
| User quits mid-wizard | Next launch: `getSettings()` returns `onboardingCompleted: false` → wizard remounts → `computeStartStep` fast-forwards over any already-connected steps. |
| User has both connections healthy but `onboardingCompleted: false` (manual preferences poke or bug) | `computeStartStep` returns 4 → user sees the confirm step → one click → Home. Graceful. |

## Visual / copy details

CSS additions (~50 lines appended to `styles.css`):

```css
.onboarding-wizard-progress { /* flex row, gap, 5 dots */ }
.onboarding-wizard-progress-dot { /* outlined circle, 8px */ }
.onboarding-wizard-progress-dot--current { /* solid */ }
.onboarding-wizard-progress-dot--done { /* solid + faint check */ }
.onboarding-wizard-footer { /* sticky bottom row */ }
.onboarding-wizard-skip-link { /* small muted text link */ }
.onboarding-wizard-status { /* "✓ Connected to …" line */ }
.onboarding-wizard-status--ok { /* green ✓ */ }
.onboarding-wizard-status--error { /* red ✗ */ }
.onboarding-wizard-status--muted { /* grey em-dash */ }
.onboarding-wizard-help-link { /* small inline help link under input */ }
.onboarding-wizard-step-body { /* 120ms opacity fade keyframe */ }
```

Tone reference (marketing site hero): *"Every Kindle highlight you've ever made. Finally searchable."* — concrete, declarative, no exclamation marks, no emoji. Wizard copy matches.

Button labels:
- Step 1: `Get started →`
- Steps 2–3: `Continue →` (gated); `Skip for now` (tertiary text link, always available)
- Step 4: `Start first sync → Open Archi`
- Step 5: no buttons (auto-transitions) unless `completeOnboarding` errored, then `[ Try again ]`

Animation: 120ms opacity fade on step transitions. Nothing else. (Translating/sliding transitions are deliberately avoided — SyncBanner already owns motion vocabulary in this app.)

## Testing

**Unit (Vitest):** `computeStartStep.test.ts`, 6 cases listed above. Pure function, no mocks.

**Not testing automatically (this spec):** step components and the wizard's IPC orchestration. The repo has no UI test harness today and this spec does not introduce one.

**Manual smoke checklist** (run before merging the implementation PR):

1. Fresh install (wipe `~/Library/Application Support/Archi/preferences.json`) → wizard at step 1, advances through 1–5, lands on Home with SyncBanner showing live import.
2. Library and Passages screens populate as the sync progresses.
3. Skip every step → wizard "completes," lands on Home with the Settings sidebar warning dot lit; no sync runs.
4. Quit the app between steps 2 and 3 → relaunch → wizard resumes at step 3 (Kindle). Step 2 shows ✓ if revisited via Back from step 3.
5. Paste an obviously-bad Notion token → inline error, token stays in field, Continue stays disabled, Skip still works.
6. Cancel the Amazon sign-in window → inline forgiving error, no crash, can retry or skip.
7. After successful completion, manually flip `onboardingCompleted` to `false` in preferences and relaunch → wizard remounts at step 4 (Confirm); one click returns to Home.
8. Both parallel-agent branches (`local-semantic-search`, `sync-pause`) merge cleanly into a branch carrying this work — confirm no conflicts in `App.tsx` beyond the documented ~10 line diff.

## Collision risk with parallel agents

Two worktrees are actively editing the desktop renderer:

- `.claude/worktrees/local-semantic-search` — Home, SyncBanner, source-device-export semantics
- `.claude/worktrees/sync-pause` — ConnectionsScreen, schedule eval, Reconnect CTA

**Files this work touches:**

- `apps/desktop/src/renderer/App.tsx` — ~10 line diff in the `!onboardingCompleted` block, plus removing the inline `WindowTitleBar` function declaration in favor of an import. Both agents may edit App.tsx for unrelated reasons; conflict surface is small and visible.
- `apps/desktop/src/renderer/screens/OnboardingScreen.tsx` — deleted.
- `apps/desktop/src/renderer/screens/onboarding/*` — new directory; no other branch references it.
- `apps/desktop/src/renderer/components/WindowTitleBar.tsx` — new file (extracted from App.tsx). No other branch is editing this component, so the extraction is risk-free.
- `apps/desktop/src/renderer/styles.css` — appended-only section under existing `.onboarding-*` rules. Low collision risk if other branches append unrelated rules.

**Files this work does NOT touch:** `HomeScreen.tsx`, `screens/home/*`, `ConnectionsScreen.tsx`, connection-card components, `main/connections.ts`, `main/index.ts`, anything in `packages/*`. The wizard consumes existing IPC verbatim.

## Migration / rollout

- No database migrations.
- No preferences schema changes. The `settings.onboardingCompleted` boolean keeps its current shape.
- Existing users (already past onboarding) are unaffected — `onboardingCompleted: true` skips the wizard.
- If a future version wants a "redo onboarding" affordance, exposing a Settings button that flips `onboardingCompleted` to `false` is sufficient; `computeStartStep` will land them on whichever step their current connections imply.

## Open questions

None at design time. Implementation may surface minor copy refinements; those can be made inline during the implementation phase.
