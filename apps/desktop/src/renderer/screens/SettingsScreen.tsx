import { useEffect, useState, type KeyboardEvent } from "react";
import { ConnectionsScreen, type ConnectionState } from "./ConnectionsScreen";
import { LogsScreen } from "./LogsScreen";
import { useSearchPreferences } from "../state/SearchPreferencesContext";
import { useIndexerStatus } from "../state/IndexerStatusContext";

const EMBEDDING_MODEL_ID = "bge-small-en-v1.5@v1";
// Inlined here for the same reason it was inlined upstream: the @archi/search
// barrel pulls embedding/modelPaths.ts which imports node:fs. Vite stubs node:fs
// in the renderer bundle, so importing through the barrel throws at module load.

type ConnectionProvider = "notion" | "cloud_notebook" | "device_export";
export type SettingsTab = "connections" | "logs" | "search";

type Props = {
  defaultTab: SettingsTab;
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
  logs: string[];
};

function Toggle({
  checked,
  onChange,
  label,
  description
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}): JSX.Element {
  return (
    <label className="settings-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        {description ? <span className="settings-toggle-description">{description}</span> : null}
      </span>
    </label>
  );
}

function SearchSection(): JSX.Element {
  const prefs = useSearchPreferences();
  const { status: indexerStatus, start, starting } = useIndexerStatus();
  const status = indexerStatus?.status ?? "idle";
  const indexed = indexerStatus?.indexed ?? 0;
  const total = indexerStatus?.total ?? 0;
  const totalLabel = total > 0 ? total.toLocaleString() : "—";
  const indexedLabel = indexed.toLocaleString();
  const statusLabel =
    status === "running" ? "Indexing in progress" : status === "idle" ? "Idle" : status;
  const reindexDisabled = status === "running" || starting;
  const onReindex = (): void => {
    void start();
  };
  return (
    <div className="settings-search-section">
      <Toggle
        checked={prefs.showMatchSource}
        onChange={prefs.setShowMatchSource}
        label="Show match-source labels"
        description="Show KEYWORD / VECTOR / BOTH badges on results."
      />
      <Toggle
        checked={prefs.includeArchived}
        onChange={prefs.setIncludeArchived}
        label="Include archived passages"
      />
      <Toggle
        checked={prefs.includeHidden}
        onChange={prefs.setIncludeHidden}
        label="Include hidden passages"
      />
      <div className="settings-search-index-status">
        <p className="content-eyebrow">Index status</p>
        <p>
          <span className="tabular">{indexedLabel}</span> of{" "}
          <span className="tabular">{totalLabel}</span> indexed
          <span aria-hidden="true"> · </span>
          model <code>{EMBEDDING_MODEL_ID}</code>
          <span aria-hidden="true"> · </span>
          {statusLabel}
        </p>
        <button
          type="button"
          className="settings-search-reindex"
          onClick={onReindex}
          disabled={reindexDisabled}
        >
          Re-index now
        </button>
      </div>
    </div>
  );
}

const tabIds = {
  connections: { tabId: "settings-tab-connections", panelId: "settings-panel-connections" },
  logs: { tabId: "settings-tab-logs", panelId: "settings-panel-logs" },
  search: { tabId: "settings-tab-search", panelId: "settings-panel-search" }
} as const;

const tabOrder: readonly SettingsTab[] = ["connections", "logs", "search"];

export function SettingsScreen(props: Props): JSX.Element {
  const [activeTab, setActiveTab] = useState<SettingsTab>(props.defaultTab);

  // When the parent passes a fresh defaultTab (e.g. user clicked a sync-banner
  // action that targets a specific tab), reflect it.
  useEffect(() => {
    setActiveTab(props.defaultTab);
  }, [props.defaultTab]);

  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: SettingsTab
  ): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const index = tabOrder.indexOf(current);
    const nextIndex =
      event.key === "ArrowLeft"
        ? (index - 1 + tabOrder.length) % tabOrder.length
        : (index + 1) % tabOrder.length;
    const nextTab = tabOrder[nextIndex];
    if (!nextTab) return;
    setActiveTab(nextTab);
    document.getElementById(tabIds[nextTab].tabId)?.focus();
  };

  return (
    <section className="settings-screen">
      <div className="ui-tabs" role="tablist" aria-label="Settings sections">
        {tabOrder.map((tab) => {
          const ids = tabIds[tab];
          const active = activeTab === tab;
          const label =
            tab === "connections" ? "Connections" : tab === "logs" ? "Logs" : "Search";
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              id={ids.tabId}
              aria-selected={active}
              aria-controls={ids.panelId}
              tabIndex={active ? 0 : -1}
              className="ui-tab"
              onClick={() => setActiveTab(tab)}
              onKeyDown={(event) => onTabKeyDown(event, tab)}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        className="settings-tab-panel"
        role="tabpanel"
        id={tabIds[activeTab].panelId}
        aria-labelledby={tabIds[activeTab].tabId}
      >
        {activeTab === "connections" ? (
          <ConnectionsScreen
            connections={props.connections}
            cloudEnabled={props.cloudEnabled}
            notionTokenDraft={props.notionTokenDraft}
            onNotionTokenDraftChange={props.onNotionTokenDraftChange}
            onSetNotionToken={props.onSetNotionToken}
            onConnect={props.onConnect}
            onReconnect={props.onReconnect}
            onDisconnect={props.onDisconnect}
            onTest={props.onTest}
            onChooseDeviceExportPath={props.onChooseDeviceExportPath}
            onSetCloudEnabled={props.onSetCloudEnabled}
            onRefreshNotionMedia={props.onRefreshNotionMedia}
            isSyncing={props.isSyncing}
          />
        ) : activeTab === "logs" ? (
          <LogsScreen entries={props.logs} />
        ) : (
          <SearchSection />
        )}
      </div>
    </section>
  );
}
