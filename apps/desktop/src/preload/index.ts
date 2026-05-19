import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type SyncState = {
  status: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
};

type SyncProgressPhase =
  | "sync_start"
  | "sync_cancel_requested"
  | "source_device_read"
  | "source_device_upsert_works"
  | "source_device_upsert_passages"
  | "source_cloud_fetch"
  | "source_cloud_upsert"
  | "destination_notion_works"
  | "destination_notion_passages"
  | "sync_complete"
  | "sync_error";

type SyncProgressStatus = "running" | "success" | "failed" | "needs_auth" | "partial_success" | "info";

type SyncProgressEvent = {
  runId: string;
  at: string;
  elapsedMs: number;
  phase: SyncProgressPhase;
  status: SyncProgressStatus;
  message: string;
  source?: "device-export" | "cloud-notebook" | "notion";
  counts?: {
    processed?: number;
    total?: number;
    works?: number;
    passages?: number;
  };
  refreshHint?: "ingest_update" | "completed";
};

type ConnectionProvider = "notion" | "cloud_notebook" | "device_export";
type ConnectionStatus = "connected" | "needs_action" | "error" | "disconnected" | "configuring";
type ConnectionState = {
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
  phase: "startup" | "reconnect" | "fetch" | "status_refresh";
  headless: boolean;
  finalUrl: string;
  urlClassification:
    | "notebook"
    | "signin"
    | "mfa"
    | "captcha"
    | "interstitial_continue_shopping"
    | "interstitial_other"
    | "unknown";
  loginFormVisible: boolean;
  notebookDomPresent: boolean;
  cookieJarSize: number;
  hasAtMainCookie: boolean;
  hasUbidMainCookie: boolean;
  storageStateFileExists: boolean;
  storageStateFileSizeBytes: number;
  profileDirExists: boolean;
  profileDirEntryCount: number;
  outcome: "connected" | "needs_auth" | "transient";
  decisionReasonCode:
    | "ok"
    | "signin_url_redirect"
    | "login_form_visible"
    | "notebook_dom_missing"
    | "goto_failed"
    | "cookies_empty_on_load"
    | "interstitial_unrecognized"
    | "unknown_error";
  errorMessage?: string;
  errorStack?: string;
};

type SyncProgressListener = (event: SyncProgressEvent) => void;
const syncProgressListenerMap = new Map<SyncProgressListener, (_event: IpcRendererEvent, payload: SyncProgressEvent) => void>();

const api = {
  getSyncState: (): Promise<SyncState> => ipcRenderer.invoke("archi:get-sync-state"),
  closeWindow: (): Promise<void> => ipcRenderer.invoke("archi:close-window"),
  getSettings: (): Promise<{
    deviceExportPath: string;
    cloudEnabled: boolean;
    cloudNotebookUrl: string;
    onboardingCompleted: boolean;
  }> =>
    ipcRenderer.invoke("archi:get-settings"),
  completeOnboarding: (): Promise<{ onboardingCompleted: boolean }> => ipcRenderer.invoke("archi:complete-onboarding"),
  chooseDeviceExportPath: (): Promise<{ selected: boolean; deviceExportPath: string }> =>
    ipcRenderer.invoke("archi:choose-device-export-path"),
  setCloudEnabled: (enabled: boolean): Promise<{ cloudEnabled: boolean }> => ipcRenderer.invoke("archi:set-cloud-enabled", enabled),
  runSyncNow: (): Promise<SyncState> => ipcRenderer.invoke("archi:run-sync-now"),
  forceFullKindleSync: (): Promise<SyncState> => ipcRenderer.invoke("archi:force-full-kindle-sync"),
  cancelSync: (): Promise<{ requested: boolean; message: string }> => ipcRenderer.invoke("archi:cancel-sync"),
  listWorks: (): Promise<
    Array<{
      id: string;
      title: string;
      creator?: string;
      ingestSource: "cloud-notebook" | "device-export";
      externalId?: string;
      storeIdentifier?: string;
      coverImageUrl?: string;
    }>
  > => ipcRenderer.invoke("archi:list-works"),
  listPassages: (): Promise<Array<{ id: string; body: string; workId: string; workTitle: string }>> =>
    ipcRenderer.invoke("archi:list-passages"),
  listRecentActivity: (
    limit?: number
  ): Promise<{
    works: Array<{ id: string; title: string; creator?: string; coverImageUrl?: string; ingestedAt: string }>;
    passages: Array<{ id: string; body: string; workTitle: string; ingestedAt: string }>;
  }> => ipcRenderer.invoke("archi:list-recent-activity", limit),
  listPassagesByWork: (
    workId: string
  ): Promise<
    Array<{
      id: string;
      body: string;
      readerNote?: string;
      externalPassageId?: string;
      positionKind?: "page" | "location" | "offset" | "order" | "unknown";
      positionStart?: string;
      positionEnd?: string;
      markedAt?: string;
      updatedAt: string;
    }>
  > => ipcRenderer.invoke("archi:list-passages-by-work", workId),
  openExternalUrl: (url: string): Promise<{ opened: boolean; error?: string }> =>
    ipcRenderer.invoke("archi:open-external-url", url),
  listLogs: (): Promise<string[]> => ipcRenderer.invoke("archi:list-logs"),
  getConnections: (): Promise<Record<ConnectionProvider, ConnectionState>> => ipcRenderer.invoke("archi:get-connections"),
  setNotionToken: (token: string): Promise<ConnectionState> => ipcRenderer.invoke("archi:set-notion-token", token),
  connectConnection: (provider: ConnectionProvider): Promise<ConnectionState> =>
    ipcRenderer.invoke("archi:connect-connection", provider),
  reconnectConnection: (provider: ConnectionProvider): Promise<ConnectionState> =>
    ipcRenderer.invoke("archi:reconnect-connection", provider),
  disconnectConnection: (provider: ConnectionProvider): Promise<ConnectionState> =>
    ipcRenderer.invoke("archi:disconnect-connection", provider),
  testConnection: (provider: ConnectionProvider): Promise<ConnectionState> => ipcRenderer.invoke("archi:test-connection", provider),
  listConnectionDebugEvents: (): Promise<
    Array<{
      at: string;
      scope: "main";
      provider?: string;
      action: string;
      stage: "start" | "success" | "error" | "info";
      message: string;
    }>
  > => ipcRenderer.invoke("archi:list-connection-debug-events"),
  onSyncProgress: (listener: SyncProgressListener): void => {
    const wrapped = (_event: IpcRendererEvent, payload: SyncProgressEvent): void => {
      listener(payload);
    };
    syncProgressListenerMap.set(listener, wrapped);
    ipcRenderer.on("archi:sync-progress", wrapped);
  },
  offSyncProgress: (listener: SyncProgressListener): void => {
    const wrapped = syncProgressListenerMap.get(listener);
    if (!wrapped) {
      return;
    }
    ipcRenderer.removeListener("archi:sync-progress", wrapped);
    syncProgressListenerMap.delete(listener);
  },
  getRecentValidations: (limit: number = 5): Promise<CloudValidationReportView[]> =>
    ipcRenderer.invoke("archi:get-recent-validations", limit),
  openValidationLog: (): Promise<void> => ipcRenderer.invoke("archi:open-validation-log")
};

contextBridge.exposeInMainWorld("archi", api);
