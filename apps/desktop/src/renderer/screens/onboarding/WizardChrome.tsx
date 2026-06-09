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
