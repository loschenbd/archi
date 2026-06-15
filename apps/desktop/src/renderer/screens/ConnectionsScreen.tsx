import { useEffect, useState } from "react";
import type { IndexerStatus } from "@archi/search";

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

type CloudValidationReportView = {
  timestamp: string;
  phase: string;
  headless: boolean;
  finalUrl: string;
  urlClassification: string;
  outcome: string;
  decisionReasonCode: string;
  cookieJarSize: number;
};

type CloudValidationDiagnosticsApi = {
  getRecentValidations(limit?: number): Promise<CloudValidationReportView[]>;
  openValidationLog(): Promise<void>;
};

const diagnosticsApi = (): CloudValidationDiagnosticsApi =>
  window.archi as unknown as CloudValidationDiagnosticsApi;

type BadgeVariant = "ok" | "warn" | "neutral";

function statusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case "connected":
    case "healthy":
      return "ok";
    case "needs_action":
    case "needs_auth":
    case "error":
    case "failed":
      return "warn";
    default:
      return "neutral";
  }
}

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
  onRefreshNotionMedia: () => void;
  isSyncing: boolean;
};

function SearchSettingsPanel(): JSX.Element {
  const [status, setStatus] = useState<IndexerStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const next = await window.archi.search.indexerStatus();
        if (!cancelled) setStatus(next);
      } catch {
        /* ignore — search may be unavailable in some environments */
      }
    };
    void load();
    const interval = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const indexLabel = ((): string => {
    if (!status) return "Loading…";
    if (status.status === "unavailable") return "Unavailable on this device";
    return `${status.indexed} of ${status.total} highlights indexed`;
  })();

  const runtimeLabel = ((): string => {
    if (!status) return "—";
    if (status.status === "running") return "Indexing…";
    if (status.status === "failed") return "Failed";
    if (status.status === "unavailable") return "Unavailable";
    return "Idle";
  })();

  return (
    <section className="ui-card">
      <header className="connection-card-header">
        <h2 className="ui-card__title">Search</h2>
        <span className="ui-badge ui-badge--neutral">{runtimeLabel}</span>
      </header>
      <dl className="search-card-stats">
        <div>
          <dt className="ui-card__eyebrow">Index status</dt>
          <dd>{indexLabel}</dd>
        </div>
        <div>
          <dt className="ui-card__eyebrow">Runtime</dt>
          <dd>{runtimeLabel}</dd>
        </div>
        <div>
          <dt className="ui-card__eyebrow">Embedding model</dt>
          <dd><code>bge-small-en-v1.5</code> — managed by Archi</dd>
        </div>
        {status?.failed ? (
          <div>
            <dt className="ui-card__eyebrow">Failed</dt>
            <dd>{status.failed}</dd>
          </div>
        ) : null}
        {status?.lastError ? (
          <div>
            <dt className="ui-card__eyebrow">Last error</dt>
            <dd className="error">{status.lastError}</dd>
          </div>
        ) : null}
      </dl>
      {/*
        TODO: add "Include archived" and "Include hidden" toggles; persist via preferences
              and pass into SearchService options.
      */}
    </section>
  );
}

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
  onSetCloudEnabled,
  onRefreshNotionMedia,
  isSyncing
}: Props): JSX.Element {
  const notion = connections.notion;
  const cloud = connections.cloud_notebook;
  const notionConnected = notion.status === "connected";
  const cloudConnected = cloud.status === "connected";
  const notionBusy = notion.status === "configuring";
  const cloudBusy = cloud.status === "configuring";
  const cloudAuthInProgress = cloud.metadata?.authInProgress === true;

  const [recentValidations, setRecentValidations] = useState<CloudValidationReportView[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const reports = await diagnosticsApi()
        .getRecentValidations(5)
        .catch(() => [] as CloudValidationReportView[]);
      if (!cancelled) {
        setRecentValidations(reports);
      }
    };
    void load();
    const interval = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const latestValidation = recentValidations[0];

  return (
    <section className="connections-screen">
      <header className="screen-intro">
        <p>Set up integrations once and keep them healthy from one place.</p>
      </header>
      <div className="connections-grid">
        <section className="ui-card">
          <header className="connection-card-header">
            <h2 className="ui-card__title">Kindle Highlights</h2>
            <span className={`ui-badge ui-badge--${statusBadgeVariant(cloud.status)}`}>
              {cloud.status.replace("_", " ")}
            </span>
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
          <footer className="ui-card__footer connection-card-footer">
            {!cloudConnected && cloud.canConnect ? (
              <button
                type="button"
                className="ui-btn ui-btn--secondary"
                onClick={() => onConnect("cloud_notebook")}
                disabled={cloudBusy}
              >
                Connect
              </button>
            ) : null}
            {cloud.canReconnect ? (
              <button
                type="button"
                className="ui-btn ui-btn--secondary"
                onClick={() => onReconnect("cloud_notebook")}
                disabled={cloudBusy}
              >
                {cloudConnected ? "Reconnect session" : "Reconnect"}
              </button>
            ) : null}
            <button
              type="button"
              className="ui-btn ui-btn--secondary"
              onClick={() => onTest("cloud_notebook")}
              disabled={cloudBusy}
            >
              {cloudConnected ? "Run test" : "Test"}
            </button>
            {cloud.canDisconnect ? (
              <button
                type="button"
                className="ui-btn ui-btn--danger"
                onClick={() => onDisconnect("cloud_notebook")}
                disabled={cloudBusy}
              >
                Disconnect
              </button>
            ) : null}
            {cloudConnected ? (
              <button
                type="button"
                className="ui-btn ui-btn--secondary"
                onClick={async () => {
                  const ok = window.confirm(
                    "Re-extract highlights from every book in your Kindle library, ignoring incremental sync state. This is slower than a normal sync but useful if highlights look out of date. Continue?"
                  );
                  if (!ok) return;
                  await window.archi.forceFullKindleSync();
                }}
                disabled={cloudBusy}
              >
                Force full Kindle sync
              </button>
            ) : null}
          </footer>
          <details className="connection-diagnostics">
            <summary>Diagnostics</summary>
            {latestValidation === undefined ? (
              <p>No validation reports yet. Click Test or wait for the next sync.</p>
            ) : (
              <>
                <dl className="diagnostics-latest">
                  <dt>Latest check</dt>
                  <dd>{new Date(latestValidation.timestamp).toLocaleString()}</dd>
                  <dt>Phase</dt>
                  <dd>{latestValidation.phase}</dd>
                  <dt>Outcome</dt>
                  <dd>
                    <span className="diagnostics-outcome" data-status={latestValidation.outcome}>
                      {latestValidation.outcome.replace(/_/g, " ")}
                    </span>
                  </dd>
                  <dt>Reason</dt>
                  <dd className="diagnostics-mono">{latestValidation.decisionReasonCode}</dd>
                  <dt>URL class</dt>
                  <dd>{latestValidation.urlClassification}</dd>
                  <dt>Headless</dt>
                  <dd>{latestValidation.headless ? "yes" : "no"}</dd>
                  <dt>Cookie jar size</dt>
                  <dd>{latestValidation.cookieJarSize}</dd>
                  <dt>Final URL</dt>
                  <dd className="diagnostics-url">{latestValidation.finalUrl || "—"}</dd>
                </dl>
                <table className="diagnostics-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Phase</th>
                      <th>Outcome</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentValidations.map((r, idx) => (
                      <tr key={`${r.timestamp}-${idx}`}>
                        <td>{new Date(r.timestamp).toLocaleTimeString()}</td>
                        <td>{r.phase}</td>
                        <td>
                          <span className="diagnostics-outcome" data-status={r.outcome}>
                            {r.outcome.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="diagnostics-mono">{r.decisionReasonCode}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            <button
              type="button"
              className="diagnostics-reveal-button"
              onClick={() => void diagnosticsApi().openValidationLog()}
            >
              Reveal log in Finder
            </button>
          </details>
        </section>

        <section className="ui-card">
          <header className="connection-card-header">
            <h2 className="ui-card__title">{notion.label}</h2>
            <span className={`ui-badge ui-badge--${statusBadgeVariant(notion.status)}`}>
              {notion.status.replace("_", " ")}
            </span>
          </header>
          <div className="token-entry">
            <label htmlFor="notion-token-input">Notion token (PAT or integration)</label>
            <input
              id="notion-token-input"
              type="password"
              className="ui-input"
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
            <button
              type="button"
              className="ui-btn ui-btn--primary"
              onClick={onSetNotionToken}
              disabled={notionBusy}
            >
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
          <footer className="ui-card__footer connection-card-footer">
            {!notionConnected && notion.canConnect ? (
              <button
                type="button"
                className="ui-btn ui-btn--secondary"
                onClick={() => onConnect("notion")}
                disabled={notionBusy}
              >
                Use token flow
              </button>
            ) : null}
            {notion.canReconnect ? (
              <button
                type="button"
                className="ui-btn ui-btn--secondary"
                onClick={() => onReconnect("notion")}
                disabled={notionBusy}
              >
                {notionConnected ? "Refresh" : "Reconnect"}
              </button>
            ) : null}
            <button
              type="button"
              className="ui-btn ui-btn--secondary"
              onClick={() => onTest("notion")}
              disabled={notionBusy}
            >
              {notionConnected ? "Run test" : "Test"}
            </button>
            {notion.canDisconnect ? (
              <button
                type="button"
                className="ui-btn ui-btn--danger"
                onClick={() => onDisconnect("notion")}
                disabled={notionBusy}
              >
                Disconnect
              </button>
            ) : null}
            {notionConnected ? (
              <button
                type="button"
                className="ui-btn ui-btn--secondary"
                onClick={onRefreshNotionMedia}
                disabled={notionBusy || isSyncing}
              >
                Refresh Notion media
              </button>
            ) : null}
          </footer>
        </section>

        <SearchSettingsPanel />
      </div>
    </section>
  );
}

