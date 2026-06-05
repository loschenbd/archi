import { useEffect, useState } from "react";
import { ConnectionsScreen, type ConnectionState } from "./ConnectionsScreen";
import { LogsScreen } from "./LogsScreen";

type ConnectionProvider = "notion" | "cloud_notebook" | "device_export";
export type SettingsTab = "connections" | "logs";

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

export function SettingsScreen(props: Props): JSX.Element {
  const [activeTab, setActiveTab] = useState<SettingsTab>(props.defaultTab);

  // When the parent passes a fresh defaultTab (e.g. user clicked a sync-banner
  // action that targets a specific tab), reflect it.
  useEffect(() => {
    setActiveTab(props.defaultTab);
  }, [props.defaultTab]);

  return (
    <section className="settings-screen">
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "connections"}
          className={`settings-tab-button${activeTab === "connections" ? " settings-tab-button-active" : ""}`}
          onClick={() => setActiveTab("connections")}
        >
          Connections
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "logs"}
          className={`settings-tab-button${activeTab === "logs" ? " settings-tab-button-active" : ""}`}
          onClick={() => setActiveTab("logs")}
        >
          Logs
        </button>
      </div>

      <div className="settings-tab-panel" role="tabpanel">
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
        ) : (
          <LogsScreen entries={props.logs} />
        )}
      </div>
    </section>
  );
}
