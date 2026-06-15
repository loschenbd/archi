import type { StepStatus } from "../types";

type Props = {
  status: StepStatus;
  label: string | null;
  authInProgress: boolean;
  onSignIn: () => void;
};

export function KindleStep({ status, label, authInProgress, onSignIn }: Props): JSX.Element {
  const buttonLabel =
    status === "connected"
      ? "Signed in"
      : authInProgress
        ? "Waiting for sign-in…"
        : status === "pending"
          ? "Opening sign-in…"
          : "Sign in with Amazon";

  return (
    <div className="onboarding-wizard-step">
      <p className="content-eyebrow">Step 2 of 5 · Kindle</p>
      <h1 className="ui-card__title">Connect your Kindle highlights.</h1>
      <div className="ui-card__body">
        <p>
          Sign in to Amazon so Archi can read your Kindle notebook and pull every highlight you&apos;ve ever made into
          your local library. The sign-in window opens once; Archi keeps the session and refreshes it as needed.
        </p>
        <div className="onboarding-wizard-row">
          <button
            type="button"
            className="ui-btn ui-btn--primary"
            onClick={onSignIn}
            disabled={status === "pending" || status === "connected"}
          >
            {buttonLabel}
          </button>
          {status === "connected" ? (
            <span className="onboarding-wizard-status onboarding-wizard-status--ok">
              ✓ {label ?? "Signed in"}
            </span>
          ) : null}
        </div>
        {authInProgress ? (
          <p className="onboarding-wizard-help">
            Finish signing in to Amazon in the browser window — including any verification prompts. Archi will pick
            up the session as soon as the notebook loads.
          </p>
        ) : null}
      </div>
    </div>
  );
}
