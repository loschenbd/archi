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
