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
