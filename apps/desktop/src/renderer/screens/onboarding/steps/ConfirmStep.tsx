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
