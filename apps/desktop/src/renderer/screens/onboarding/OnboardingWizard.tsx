import { useCallback, useEffect, useRef, useState } from "react";
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
  kindleAuthInProgress: false,
  notionTokenDraft: "",
  stepError: null,
  isCompleting: false,
};

// Kindle sign-in poll: the cloud adapter returns needs_action + metadata.authInProgress
// after a 20s timeout while the underlying Playwright connector keeps polling for up
// to 5 minutes. Mirror the connector's deadline here (150 ticks × 2s = 5 min).
const KINDLE_POLL_INTERVAL_MS = 2000;
const KINDLE_POLL_MAX_TICKS = 150;

function isAuthInProgress(snapshot: ConnectionsSnapshot["cloud_notebook"]): boolean {
  const value = snapshot?.metadata?.authInProgress;
  return value === true;
}

export function OnboardingWizard({ ipcError, onComplete }: Props): JSX.Element {
  const [state, setState] = useState<WizardState>(INITIAL_STATE);

  // Mount: seed already-connected status so steps 2/3 and the recap show ✓ pre-filled.
  // The wizard always starts at step 1 (Welcome) — no fast-forward.
  useEffect(() => {
    void window.archi
      .getConnections()
      .then((connections: ConnectionsSnapshot) => {
        setState((prev) => ({
          ...prev,
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
        // No-op. App-level IPC retry logic covers the cold-start race.
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

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTicksRef = useRef(0);

  const stopKindlePolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollTicksRef.current = 0;
  }, []);

  useEffect(() => stopKindlePolling, [stopKindlePolling]);

  const startKindlePolling = useCallback(() => {
    if (pollTimerRef.current) {
      return;
    }
    pollTicksRef.current = 0;
    pollTimerRef.current = setInterval(() => {
      pollTicksRef.current += 1;
      void window.archi
        .getConnections()
        .then((connections: ConnectionsSnapshot) => {
          const cn = connections.cloud_notebook;
          if (cn?.status === "connected") {
            stopKindlePolling();
            setState((prev) => ({
              ...prev,
              kindleStatus: "connected",
              kindleLabel: cn.diagnostics?.summary ?? "Signed in",
              kindleAuthInProgress: false,
              stepError: null,
            }));
            return;
          }
          if (!isAuthInProgress(cn)) {
            stopKindlePolling();
            setState((prev) => ({
              ...prev,
              kindleStatus: "error",
              kindleLabel: null,
              kindleAuthInProgress: false,
              stepError:
                cn?.diagnostics?.details ?? cn?.diagnostics?.summary ?? "Sign-in didn't complete.",
            }));
            return;
          }
          if (pollTicksRef.current >= KINDLE_POLL_MAX_TICKS) {
            stopKindlePolling();
            setState((prev) => ({
              ...prev,
              kindleStatus: "error",
              kindleLabel: null,
              kindleAuthInProgress: false,
              stepError: "Sign-in didn't complete in time. Try again.",
            }));
          }
        })
        .catch(() => {
          // Transient IPC error during polling — keep polling, the next tick will retry.
        });
    }, KINDLE_POLL_INTERVAL_MS);
  }, [stopKindlePolling]);

  const signInKindle = useCallback(() => {
    stopKindlePolling();
    setState((prev) => ({
      ...prev,
      kindleStatus: "pending",
      kindleAuthInProgress: false,
      stepError: null,
    }));
    void window.archi
      .connectConnection("cloud_notebook")
      .then((next) => {
        if (next.status === "connected") {
          setState((prev) => ({
            ...prev,
            kindleStatus: "connected",
            kindleLabel: next.diagnostics?.summary ?? "Signed in",
            kindleAuthInProgress: false,
            stepError: null,
          }));
          return;
        }
        const stillAuthing =
          next.status === "needs_action" &&
          Boolean((next.metadata as Record<string, unknown> | undefined)?.authInProgress);
        if (stillAuthing) {
          setState((prev) => ({
            ...prev,
            kindleStatus: "pending",
            kindleAuthInProgress: true,
            stepError: null,
          }));
          startKindlePolling();
          return;
        }
        setState((prev) => ({
          ...prev,
          kindleStatus: "error",
          kindleLabel: null,
          kindleAuthInProgress: false,
          stepError:
            next.diagnostics?.details ?? next.diagnostics?.summary ?? "Sign-in didn't complete.",
        }));
      })
      .catch((err) => {
        setState((prev) => ({
          ...prev,
          kindleStatus: "error",
          kindleLabel: null,
          kindleAuthInProgress: false,
          stepError: err instanceof Error ? err.message : "Sign-in didn't complete.",
        }));
      });
  }, [startKindlePolling, stopKindlePolling]);

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
          continueDisabled={state.kindleStatus !== "connected"}
          onSkip={() => advanceTo(3)}
          onContinue={() => advanceTo(3)}
        >
          <KindleStep
            status={state.kindleStatus}
            label={state.kindleLabel}
            authInProgress={state.kindleAuthInProgress}
            onSignIn={signInKindle}
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
          continueDisabled={state.notionStatus !== "connected"}
          onBack={() => advanceTo(2)}
          onSkip={() => advanceTo(4)}
          onContinue={() => advanceTo(4)}
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
    case 4:
      return (
        <WizardChrome
          currentStep={4}
          ipcError={ipcError}
          stepError={wizardError}
          showBack={true}
          showSkip={false}
          continueLabel="Import my highlights → Open Archi"
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
