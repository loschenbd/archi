export type Step = 1 | 2 | 3 | 4 | 5;

export type StepStatus = "idle" | "pending" | "connected" | "error";

export type WizardState = {
  currentStep: Step;
  notionStatus: StepStatus;
  notionLabel: string | null;
  kindleStatus: StepStatus;
  kindleLabel: string | null;
  // True while the Amazon sign-in browser window is still open and the connector
  // is polling for completion. The wizard keeps `kindleStatus: "pending"` during
  // this phase and renders a friendly waiting message instead of an error.
  kindleAuthInProgress: boolean;
  notionTokenDraft: string;
  stepError: string | null;
  isCompleting: boolean;
};

export type OnboardingCompleteResult = {
  syncStartError: string | null;
};

// Shape the wizard reads from getConnections(). Defensive about missing keys
// because the IPC handler-not-registered race can yield partial results.
export type ConnectionsSnapshot = {
  notion?: {
    status?: string;
    diagnostics?: { summary?: string | null; details?: string | null };
  };
  cloud_notebook?: {
    status?: string;
    diagnostics?: { summary?: string | null; details?: string | null };
    metadata?: Record<string, string | boolean | number | null>;
  };
  device_export?: { status?: string };
};
