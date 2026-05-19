import fs from "node:fs";
import { NotionDestination } from "@archi/destination-notion";
import { PlaywrightCloudNotebookConnector, type CloudConnectorStatus } from "@archi/source-cloud-notebook";
import type { CloudValidationReport } from "@archi/source-cloud-notebook";

export type CloudValidationLogOptions = {
  persist: (report: CloudValidationReport) => void;
  ringBufferSize?: number;
};

export class CloudValidationLog {
  private readonly buffer: CloudValidationReport[] = [];
  private readonly capacity: number;
  private readonly persist: (report: CloudValidationReport) => void;

  constructor(options: CloudValidationLogOptions) {
    this.persist = options.persist;
    this.capacity = options.ringBufferSize ?? 20;
  }

  record(report: CloudValidationReport): void {
    this.buffer.push(report);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
    try {
      this.persist(report);
    } catch {
      // persist failures must not propagate
    }
  }

  recent(limit: number): CloudValidationReport[] {
    const safe = Math.max(0, Math.min(limit, this.buffer.length));
    return this.buffer.slice(-safe).reverse();
  }

  latest(): CloudValidationReport | undefined {
    return this.buffer[this.buffer.length - 1];
  }
}

export type ConnectionProvider = "notion" | "cloud_notebook" | "device_export";
export type ConnectionStatus = "connected" | "needs_action" | "error" | "disconnected" | "configuring";

export type ConnectionDiagnostics = {
  summary: string;
  details?: string;
};

export type ConnectionState = {
  provider: ConnectionProvider;
  label: string;
  status: ConnectionStatus;
  canConnect: boolean;
  canReconnect: boolean;
  canDisconnect: boolean;
  hints: string[];
  diagnostics?: ConnectionDiagnostics;
  metadata?: Record<string, string | boolean | number | null>;
};

export type CloudSettings = {
  enabled: boolean;
  notebookUrl: string;
  storageStatePath: string;
  profilePath?: string;
};

export type NotionSettings = {
  parentPageId?: string;
  libraryDatabaseId?: string;
  passagesDatabaseId?: string;
};

export type AppSettingsAccess = {
  getDeviceExportPath: () => string;
  getCloudSettings: () => CloudSettings;
  getNotionSettings: () => NotionSettings;
};

export type NotionAuth = {
  accessToken: string;
  workspaceId?: string;
  workspaceName?: string;
  obtainedAt: string;
};

export interface NotionAuthStore {
  get(): NotionAuth | null;
  set(auth: NotionAuth): void;
  clear(): void;
}

interface ConnectionAdapter {
  readonly provider: ConnectionProvider;
  getStatus(): Promise<ConnectionState>;
  connect(): Promise<ConnectionState>;
  reconnect(): Promise<ConnectionState>;
  disconnect(): Promise<ConnectionState>;
  testConnection(): Promise<ConnectionState>;
}

function createConnectionState(input: Omit<ConnectionState, "canConnect" | "canReconnect" | "canDisconnect"> & Partial<Pick<ConnectionState, "canConnect" | "canReconnect" | "canDisconnect">>): ConnectionState {
  return {
    canConnect: true,
    canReconnect: true,
    canDisconnect: false,
    ...input
  };
}

export function mapCloudStatusToConnectionStatus(status: CloudConnectorStatus): ConnectionStatus {
  if (status === "connected" || status === "reconnected") {
    return "connected";
  }
  return "needs_action";
}

export class NotionConnectionAdapter implements ConnectionAdapter {
  readonly provider: ConnectionProvider = "notion";
  private lastError: string | null = null;

  constructor(private readonly settings: AppSettingsAccess, private readonly authStore: NotionAuthStore) {}

  getToken(): string | null {
    const auth = this.authStore.get();
    return auth?.accessToken ?? null;
  }

  async getStatus(): Promise<ConnectionState> {
    const auth = this.authStore.get();
    if (!auth?.accessToken) {
      return createConnectionState({
        provider: this.provider,
        label: "Notion",
        status: "needs_action",
        canDisconnect: false,
        hints: [
          "Paste your Notion token once (PAT or internal integration token).",
          "If using an internal integration token, share your parent page with that integration.",
          "If using a PAT, access follows your own Notion user permissions."
        ],
        diagnostics: this.lastError
          ? {
              summary: "Notion is not connected.",
              details: this.lastError
            }
          : {
              summary: "Notion is not connected."
            }
      });
    }

    return createConnectionState({
      provider: this.provider,
      label: "Notion",
      status: "connected",
      hints: [],
      canDisconnect: true,
      metadata: {
        workspace: auth.workspaceName ?? auth.workspaceId ?? null
      },
      diagnostics: {
        summary: "Notion token is configured."
      }
    });
  }

  async connect(): Promise<ConnectionState> {
    this.lastError = "Provide a Notion integration token to connect.";
    return this.getStatus();
  }

  async reconnect(): Promise<ConnectionState> {
    return this.connect();
  }

  async disconnect(): Promise<ConnectionState> {
    this.authStore.clear();
    this.lastError = null;
    return this.getStatus();
  }

  async testConnection(): Promise<ConnectionState> {
    const token = this.getToken();
    if (!token) {
      this.lastError = "Notion is not connected.";
      return this.getStatus();
    }

    try {
      const notionSettings = this.settings.getNotionSettings();
      const destination = new NotionDestination({
        integrationToken: token,
        parentPageId: notionSettings.parentPageId,
        libraryDatabaseId: notionSettings.libraryDatabaseId,
        passagesDatabaseId: notionSettings.passagesDatabaseId
      });
      await destination.testConnection();
      this.lastError = null;
      return this.getStatus();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Failed to verify Notion connection.";
      return createConnectionState({
        provider: this.provider,
        label: "Notion",
        status: "error",
        canDisconnect: true,
        hints: [
          "Verify your token is valid and not expired.",
          "PAT: ensure your Notion user can access the target page/database.",
          "Internal integration token: ensure the page/database is shared with the integration."
        ],
        diagnostics: {
          summary: "Notion connection test failed.",
          details: this.lastError
        }
      });
    }
  }

  async connectWithToken(token: string): Promise<ConnectionState> {
    const trimmed = token.trim();
    if (!trimmed) {
      this.lastError = "Notion token is required.";
      this.authStore.clear();
      return this.getStatus();
    }

    const previousAuth = this.authStore.get();
    this.authStore.set({
      accessToken: trimmed,
      obtainedAt: new Date().toISOString()
    });
    const result = await this.testConnection();
    if (result.status === "error") {
      // Validation failed - roll back to the prior auth (or clear) so getStatus
      // doesn't lie about being connected on the next refresh.
      if (previousAuth) {
        this.authStore.set(previousAuth);
      } else {
        this.authStore.clear();
      }
    }
    return result;
  }
}

export class CloudNotebookConnectionAdapter implements ConnectionAdapter {
  readonly provider: ConnectionProvider = "cloud_notebook";
  private static readonly ACTION_TIMEOUT_MS = 20_000;
  private lastError: string | null = null;
  private inFlightReconnect: Promise<void> | null = null;

  constructor(
    private readonly settings: AppSettingsAccess,
    private readonly connector: PlaywrightCloudNotebookConnector,
    private readonly validationLog?: CloudValidationLog
  ) {}

  private latestValidationMetadata(): Record<string, string | boolean | number | null> {
    const latest = this.validationLog?.latest();
    if (!latest) {
      return {};
    }
    return {
      latestValidationTimestamp: latest.timestamp,
      latestValidationPhase: latest.phase,
      latestValidationOutcome: latest.outcome,
      latestValidationReason: latest.decisionReasonCode,
      latestValidationUrlClass: latest.urlClassification,
      latestValidationHeadless: latest.headless,
      latestValidationCookieJarSize: latest.cookieJarSize
    };
  }

  async getStatus(): Promise<ConnectionState> {
    if (!this.settings.getCloudSettings().enabled) {
      return createConnectionState({
        provider: this.provider,
        label: "Cloud notebook",
        status: "disconnected",
        canDisconnect: false,
        hints: ["Enable cloud notebook sync when you want to use browser-session ingestion."],
        diagnostics: {
          summary: "Cloud notebook sync is disabled."
        },
        metadata: {
          enabled: false
        }
      });
    }
    if (this.inFlightReconnect) {
      return this.createNeedsActionState(
        "Cloud authentication is in progress.",
        "Complete sign-in in the browser window, then click Test to verify cloud access.",
        true
      );
    }

    const cached = this.connector.getCachedStatus();
    const cachedFreshMs = 5 * 60 * 1000;
    if (
      cached.validatedAtMs !== null &&
      Date.now() - cached.validatedAtMs < cachedFreshMs &&
      cached.status !== "needs_auth"
    ) {
      return createConnectionState({
        provider: this.provider,
        label: "Cloud notebook",
        status: "connected",
        canDisconnect: false,
        hints: [],
        diagnostics: {
          summary: "Cloud notebook session is ready."
        },
        metadata: {
          enabled: this.settings.getCloudSettings().enabled,
          ...this.latestValidationMetadata()
        }
      });
    }

    const status = await this.connector.getStatus();
    return createConnectionState({
      provider: this.provider,
      label: "Cloud notebook",
      status: mapCloudStatusToConnectionStatus(status),
      canDisconnect: false,
      hints:
        status === "needs_auth"
          ? ["Authentication needed. Click Reconnect, complete Amazon login if prompted, then Test before syncing."]
          : [],
      diagnostics:
        status === "needs_auth"
          ? {
              summary: "Cloud notebook needs authentication.",
              details: this.lastError ?? undefined
            }
          : {
              summary: "Cloud notebook session is ready."
            },
      metadata: {
        enabled: this.settings.getCloudSettings().enabled,
        ...this.latestValidationMetadata()
      }
    });
  }

  async connect(): Promise<ConnectionState> {
    return this.reconnect();
  }

  private timeoutAfter<T>(ms: number, onTimeout: () => T): Promise<T> {
    return new Promise<T>((resolve) => {
      setTimeout(() => resolve(onTimeout()), ms);
    });
  }

  private createNeedsActionState(summary: string, details?: string, authInProgress = false): ConnectionState {
    return createConnectionState({
      provider: this.provider,
      label: "Cloud notebook",
      status: "needs_action",
      canDisconnect: false,
      hints: ["Authenticate in the opened browser window, then click Test to verify and refresh status."],
      diagnostics: {
        summary,
        details
      },
      metadata: {
        enabled: this.settings.getCloudSettings().enabled,
        ...this.latestValidationMetadata(),
        authInProgress
      }
    });
  }

  async reconnect(): Promise<ConnectionState> {
    if (!this.settings.getCloudSettings().enabled) {
      return this.getStatus();
    }
    if (!this.inFlightReconnect) {
      this.inFlightReconnect = this.connector
        .reconnect()
        .then(() => {
          this.lastError = null;
        })
        .catch((error) => {
          this.lastError = error instanceof Error ? error.message : "Cloud reconnect failed.";
          throw error;
        })
        .finally(() => {
          this.inFlightReconnect = null;
        });
    }

    const timeoutResult = Symbol("cloud-reconnect-timeout");
    try {
      const reconnectResult = await Promise.race([
        this.inFlightReconnect,
        this.timeoutAfter(CloudNotebookConnectionAdapter.ACTION_TIMEOUT_MS, () => timeoutResult)
      ]);
      if (reconnectResult === timeoutResult) {
        return this.createNeedsActionState(
          "Reconnect is taking longer than expected.",
          "Complete sign-in in the browser window, then click Test to verify cloud access.",
          true
        );
      }
    } catch (error) {
      return this.createNeedsActionState("Cloud reconnect failed.", error instanceof Error ? error.message : "Cloud reconnect failed.");
    }
    return this.getStatus();
  }

  async disconnect(): Promise<ConnectionState> {
    return this.getStatus();
  }

  async testConnection(): Promise<ConnectionState> {
    return this.reconnect();
  }
}

export class DeviceExportConnectionAdapter implements ConnectionAdapter {
  readonly provider: ConnectionProvider = "device_export";

  constructor(private readonly settings: AppSettingsAccess) {}

  private evaluateStatus(): ConnectionState {
    const exportPath = this.settings.getDeviceExportPath();
    const exists = exportPath.trim().length > 0 && fs.existsSync(exportPath);
    return createConnectionState({
      provider: this.provider,
      label: "Device export file",
      status: exists ? "connected" : "needs_action",
      canDisconnect: false,
      canReconnect: false,
      hints: exists ? [] : ["Choose your Kindle export file to enable reliable local ingestion."],
      diagnostics: exists
        ? {
            summary: "Device export file is configured."
          }
        : {
            summary: "Device export file is missing."
          },
      metadata: {
        path: exportPath
      }
    });
  }

  async getStatus(): Promise<ConnectionState> {
    return this.evaluateStatus();
  }

  async connect(): Promise<ConnectionState> {
    return this.evaluateStatus();
  }

  async reconnect(): Promise<ConnectionState> {
    return this.evaluateStatus();
  }

  async disconnect(): Promise<ConnectionState> {
    return this.evaluateStatus();
  }

  async testConnection(): Promise<ConnectionState> {
    return this.evaluateStatus();
  }
}

export class ConnectionManager {
  private readonly adapters: Map<ConnectionProvider, ConnectionAdapter>;
  private static readonly STATUS_TIMEOUT_MS = 1500;
  private readonly lastKnownStatuses = new Map<ConnectionProvider, ConnectionState>();

  constructor(adapters: ConnectionAdapter[]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.provider, adapter]));
  }

  async getAllStatuses(): Promise<Record<ConnectionProvider, ConnectionState>> {
    const [notion, cloud, device] = await Promise.all([
      this.getStatusWithTimeout("notion"),
      this.getStatusWithTimeout("cloud_notebook"),
      this.getStatusWithTimeout("device_export")
    ]);
    return {
      notion,
      cloud_notebook: cloud,
      device_export: device
    };
  }

  async getStatus(provider: ConnectionProvider): Promise<ConnectionState> {
    const adapter = this.requireAdapter(provider);
    return adapter.getStatus();
  }

  async connect(provider: ConnectionProvider): Promise<ConnectionState> {
    const adapter = this.requireAdapter(provider);
    return adapter.connect();
  }

  async reconnect(provider: ConnectionProvider): Promise<ConnectionState> {
    const adapter = this.requireAdapter(provider);
    return adapter.reconnect();
  }

  async disconnect(provider: ConnectionProvider): Promise<ConnectionState> {
    const adapter = this.requireAdapter(provider);
    return adapter.disconnect();
  }

  async testConnection(provider: ConnectionProvider): Promise<ConnectionState> {
    const adapter = this.requireAdapter(provider);
    return adapter.testConnection();
  }

  async setNotionToken(token: string): Promise<ConnectionState> {
    const adapter = this.requireAdapter("notion");
    if (!(adapter instanceof NotionConnectionAdapter)) {
      throw new Error("Notion connection adapter is unavailable.");
    }
    return adapter.connectWithToken(token);
  }

  private requireAdapter(provider: ConnectionProvider): ConnectionAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`Unsupported connection provider: ${provider}`);
    }
    return adapter;
  }

  private async getStatusSafely(provider: ConnectionProvider): Promise<ConnectionState> {
    try {
      const status = await this.getStatus(provider);
      this.lastKnownStatuses.set(provider, status);
      return status;
    } catch (error) {
      const details = error instanceof Error ? error.message : "Unknown connection status error.";
      const labelByProvider: Record<ConnectionProvider, string> = {
        notion: "Notion",
        cloud_notebook: "Cloud notebook",
        device_export: "Device export file"
      };
      return createConnectionState({
        provider,
        label: labelByProvider[provider],
        status: "error",
        canDisconnect: provider === "notion",
        canReconnect: true,
        hints: ["Open Reconnect/Test to refresh this integration status."],
        diagnostics: {
          summary: "Could not load connection status.",
          details
        }
      });
    }
  }

  private async getStatusWithTimeout(provider: ConnectionProvider): Promise<ConnectionState> {
    const timeout = new Promise<ConnectionState>((resolve) => {
      setTimeout(() => {
        const lastKnown = this.lastKnownStatuses.get(provider);
        if (lastKnown) {
          resolve(lastKnown);
          return;
        }
        resolve(this.createTimeoutFallback(provider));
      }, ConnectionManager.STATUS_TIMEOUT_MS);
    });
    return Promise.race([this.getStatusSafely(provider), timeout]);
  }

  private createTimeoutFallback(provider: ConnectionProvider): ConnectionState {
    if (provider === "cloud_notebook") {
      return createConnectionState({
        provider,
        label: "Cloud notebook",
        status: "needs_action",
        canConnect: true,
        canReconnect: true,
        canDisconnect: false,
        hints: ["Status check timed out. Click Reconnect or Test to refresh cloud status."],
        diagnostics: {
          summary: "Cloud status check is taking longer than expected."
        }
      });
    }

    if (provider === "notion") {
      return createConnectionState({
        provider,
        label: "Notion",
        status: "needs_action",
        canConnect: true,
        canReconnect: true,
        canDisconnect: false,
        hints: ["Status check timed out. You can still save a token or run Test."],
        diagnostics: {
          summary: "Notion status check is taking longer than expected."
        }
      });
    }

    return createConnectionState({
      provider,
      label: "Device export file",
      status: "needs_action",
      canConnect: false,
      canReconnect: false,
      canDisconnect: false,
      hints: ["Status check timed out. You can still choose an export file."],
      diagnostics: {
        summary: "Device export status check is taking longer than expected."
      }
    });
  }
}

