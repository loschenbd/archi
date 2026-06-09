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
