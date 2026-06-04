export {};

import type { IndexerStatus, SearchQuery, SearchResponse } from "@archi/search";

type ConnectionProvider = "notion" | "cloud_notebook" | "device_export";
type ConnectionStatus = "connected" | "needs_action" | "error" | "disconnected" | "configuring";
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

type UpdaterStatusKind = "available" | "none" | "progress" | "downloaded" | "error";

type UpdaterStatusEvent = {
  kind: UpdaterStatusKind;
  payload?: { version?: string; percent?: number; message?: string };
};

declare global {
  interface Window {
    archi: {
      getSyncState: () => Promise<{ status: string; lastRunAt: string | null; nextRunAt: string | null; lastError: string | null }>;
      closeWindow: () => Promise<void>;
      getSettings: () => Promise<{
        deviceExportPath: string;
        cloudEnabled: boolean;
        cloudNotebookUrl: string;
        onboardingCompleted: boolean;
      }>;
      completeOnboarding: () => Promise<{ onboardingCompleted: boolean }>;
      chooseDeviceExportPath: () => Promise<{ selected: boolean; deviceExportPath: string }>;
      setCloudEnabled: (enabled: boolean) => Promise<{ cloudEnabled: boolean }>;
      runSyncNow: () => Promise<{ status: string; lastRunAt: string | null; nextRunAt: string | null; lastError: string | null }>;
      forceFullKindleSync: () => Promise<{ status: string; lastRunAt: string | null; nextRunAt: string | null; lastError: string | null }>;
      refreshNotionMedia: () => Promise<{ status: string; lastRunAt: string | null; nextRunAt: string | null; lastError: string | null }>;
      cancelSync: () => Promise<{ requested: boolean; message: string }>;
      openSupportLink: () => Promise<void>;
      updater: {
        download: () => Promise<void>;
        quitAndInstall: () => Promise<void>;
        onStatus: (cb: (event: UpdaterStatusEvent) => void) => () => void;
      };
      preferences: {
        get: <T>(key: string, fallback: T) => Promise<T>;
        set: (key: string, value: unknown) => Promise<void>;
      };
      listWorks: () => Promise<
        Array<{
          id: string;
          title: string;
          creator?: string;
          ingestSource: "cloud-notebook" | "device-export";
          externalId?: string;
          storeIdentifier?: string;
          coverImageUrl?: string;
        }>
      >;
      listRecentActivity: (limit?: number) => Promise<{
        works: Array<{ id: string; title: string; creator?: string; coverImageUrl?: string; ingestedAt: string }>;
        passages: Array<{ id: string; body: string; workTitle: string; ingestedAt: string }>;
      }>;
      listPassagesByWork: (
        workId: string
      ) => Promise<
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
      >;
      openExternalUrl: (url: string) => Promise<{ opened: boolean; error?: string }>;
      listLogs: () => Promise<string[]>;
      getConnections: () => Promise<
        Record<
          ConnectionProvider,
          {
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
          }
        >
      >;
      setNotionToken: (token: string) => Promise<{
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
      }>;
      connectConnection: (provider: ConnectionProvider) => Promise<{
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
      }>;
      reconnectConnection: (provider: ConnectionProvider) => Promise<{
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
      }>;
      disconnectConnection: (provider: ConnectionProvider) => Promise<{
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
      }>;
      testConnection: (provider: ConnectionProvider) => Promise<{
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
      }>;
      listConnectionDebugEvents: () => Promise<
        Array<{
          at: string;
          scope: "main";
          provider?: string;
          action: string;
          stage: "start" | "success" | "error" | "info";
          message: string;
        }>
      >;
      onSyncProgress: (listener: (event: SyncProgressEvent) => void) => void;
      offSyncProgress: (listener: (event: SyncProgressEvent) => void) => void;
      search: {
        query: (q: SearchQuery) => Promise<SearchResponse>;
        indexerStatus: () => Promise<IndexerStatus>;
        startIndexing: () => Promise<{ started: boolean }>;
        facets: () => Promise<{ creators: string[]; labels: string[] }>;
      };
    };
  }
}
