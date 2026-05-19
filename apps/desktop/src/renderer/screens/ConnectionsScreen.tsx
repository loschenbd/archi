type ConnectionProvider = "notion" | "cloud_notebook" | "device_export";
type ConnectionStatus = "connected" | "needs_action" | "error" | "disconnected" | "configuring";

export type ConnectionState = {
  provider: ConnectionProvider;
  label: string;
  status: ConnectionStatus;
  canConnect: boolean;
  canReconnect: boolean;
  canDisconnect: boolean;
  hints: string[];
  diagnostics?: {
    summary: string;
    details?: string;
  };
  metadata?: Record<string, string | boolean | number | null>;
};

type Props = {
  connections: Record<ConnectionProvider, ConnectionState>;
  cloudEnabled: boolean;
  notionTokenDraft: string;
  onNotionTokenDraftChange: (value: string) => void;
  onSetNotionToken: () => void;
  onConnect: (provider: ConnectionProvider) => void;
  onReconnect: (provider: ConnectionProvider) => void;
  onDisconnect: (provider: ConnectionProvider) => void;
  onTest: (provider: ConnectionProvider) => void;
  onChooseDeviceExportPath: () => void;
  onSetCloudEnabled: (enabled: boolean) => void;
};

export function ConnectionsScreen({
  connections,
  cloudEnabled,
  notionTokenDraft,
  onNotionTokenDraftChange,
  onSetNotionToken,
  onConnect,
  onReconnect,
  onDisconnect,
  onTest,
  onSetCloudEnabled
}: Props): JSX.Element {
  const notion = connections.notion;
  const cloud = connections.cloud_notebook;
  const notionConnected = notion.status === "connected";
  const cloudConnected = cloud.status === "connected";
  const notionBusy = notion.status === "configuring";
  const cloudBusy = cloud.status === "configuring";
  const cloudAuthInProgress = cloud.metadata?.authInProgress === true;

  return (
    <section className="connections-screen">
      <header className="screen-intro">
        <p>Set up integrations once and keep them healthy from one place.</p>
      </header>
      <div className="connections-grid">
        <article className="connection-card">
          <header>
            <h3>Kindle Highlights</h3>
            <span className={`status-pill status-${cloud.status}`}>{cloud.status.replace("_", " ")}</span>
          </header>
          <label className="toggle-row">
            <input type="checkbox" checked={cloudEnabled} onChange={(event) => onSetCloudEnabled(event.target.checked)} /> Enable Kindle
            Highlights sync
          </label>
          {cloudAuthInProgress ? (
            <p className="info-text">Authentication is in progress in your browser. Finish sign-in there, then click Test.</p>
          ) : null}
          {cloudConnected ? <p className="success-text">Connected and ready to ingest cloud highlights.</p> : null}
          {cloud.diagnostics ? <p>{cloud.diagnostics.summary}</p> : null}
          {cloud.diagnostics?.details ? <p className="error">{cloud.diagnostics.details}</p> : null}
          {cloud.hints.length > 0 ? (
            <ul className="hint-list">
              {cloud.hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          ) : null}
          <div className="connection-actions">
            {!cloudConnected && cloud.canConnect ? (
              <button onClick={() => onConnect("cloud_notebook")} disabled={cloudBusy}>
                Connect
              </button>
            ) : null}
            {cloud.canReconnect ? (
              <button onClick={() => onReconnect("cloud_notebook")} disabled={cloudBusy}>
                {cloudConnected ? "Reconnect session" : "Reconnect"}
              </button>
            ) : null}
            <button onClick={() => onTest("cloud_notebook")} disabled={cloudBusy}>
              {cloudConnected ? "Run test" : "Test"}
            </button>
            {cloud.canDisconnect ? (
              <button onClick={() => onDisconnect("cloud_notebook")} disabled={cloudBusy}>
                Disconnect
              </button>
            ) : null}
          </div>

        </article>

        <article className="connection-card">
          <header>
            <h3>{notion.label}</h3>
            <span className={`status-pill status-${notion.status}`}>{notion.status.replace("_", " ")}</span>
          </header>
          <div className="token-entry">
            <label htmlFor="notion-token-input">Notion token (PAT or integration)</label>
            <input
              id="notion-token-input"
              type="password"
              placeholder={notionConnected ? "Token saved. Paste a new token to replace it." : "ntn_... or secret_..."}
              value={notionTokenDraft}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              onSelect={(event) => {
                const input = event.currentTarget;
                const end = input.value.length;
                input.setSelectionRange(end, end);
              }}
              onChange={(event) => onNotionTokenDraftChange(event.target.value)}
            />
            <button onClick={onSetNotionToken} disabled={notionBusy}>
              {notionConnected ? "Update token" : "Save token"}
            </button>
          </div>
          {notionConnected ? <p className="success-text">Connected and ready to sync to Notion.</p> : null}
          {notion.diagnostics ? <p>{notion.diagnostics.summary}</p> : null}
          {notion.diagnostics?.details ? <p className="error">{notion.diagnostics.details}</p> : null}
          {notion.hints.length > 0 ? (
            <ul className="hint-list">
              {notion.hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          ) : null}
          <div className="connection-actions">
            {!notionConnected && notion.canConnect ? (
              <button onClick={() => onConnect("notion")} disabled={notionBusy}>
                Use token flow
              </button>
            ) : null}
            {notion.canReconnect ? (
              <button onClick={() => onReconnect("notion")} disabled={notionBusy}>
                {notionConnected ? "Refresh" : "Reconnect"}
              </button>
            ) : null}
            <button onClick={() => onTest("notion")} disabled={notionBusy}>
              {notionConnected ? "Run test" : "Test"}
            </button>
            {notion.canDisconnect ? (
              <button onClick={() => onDisconnect("notion")} disabled={notionBusy}>
                Disconnect
              </button>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}

