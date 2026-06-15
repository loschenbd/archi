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
      <section className="ui-card ui-card--ruled ui-card--loose wizard-chrome-card">
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
        <div key={currentStep} className="onboarding-wizard-step-body">{children}</div>
        {stepError ? <p className="error banner-error">{stepError}</p> : null}
        {showFooter ? (
          <div className="wizard-chrome-actions">
            <div className="left-actions">
              {showBack ? (
                <button type="button" className="ui-btn ui-btn--ghost" onClick={onBack}>
                  ← Back
                </button>
              ) : null}
            </div>
            <div className="right-actions">
              {showSkip ? (
                <button type="button" className="ui-btn ui-btn--secondary" onClick={onSkip}>
                  Skip for now
                </button>
              ) : null}
              <button
                type="button"
                className="ui-btn ui-btn--primary"
                disabled={continueDisabled}
                onClick={onContinue}
              >
                {continueLabel}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
