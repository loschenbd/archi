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
      <p className="content-eyebrow">Step 3 of 5 · Notion</p>
      <h1>Mirror your library to Notion.</h1>
      <p>
        Optional. Archi can mirror your local library to a Notion database &mdash; useful for browsing on your phone,
        sharing, or editing in place. Paste an internal integration token from <code>notion.so/profile/integrations</code>;
        Archi creates the database on first sync. Skip this if you don&apos;t use Notion.
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
        <button
          type="button"
          className="onboarding-wizard-help-link"
          onClick={() => {
            void window.archi.openExternalUrl("https://www.notion.so/help/create-integrations-with-the-notion-api");
          }}
        >
          How to create a Notion integration token →
        </button>
      </p>
    </div>
  );
}
