import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import crypto from "node:crypto";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import dotenv from "dotenv";
import { CoreRepository, computeFingerprintHash, openCoreDatabase } from "@archi/core";
import { NotionDestination, type NotionSyncBatchProgressEvent } from "@archi/destination-notion";
import { PlaywrightCloudNotebookConnector, decodeKindleHighlightLocation, appendValidationReport, type CloudPassage, type CloudValidationReport } from "@archi/source-cloud-notebook";
import { normalizeDeviceExport } from "@archi/source-device-export";
import {
  CloudNotebookConnectionAdapter,
  CloudValidationLog,
  ConnectionManager,
  type ConnectionProvider,
  DeviceExportConnectionAdapter,
  NotionConnectionAdapter,
  type NotionAuth,
  type NotionAuthStore
} from "./connections.js";
import { CredentialStore } from "./credentialStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_NAME = "Archi";
app.setName(APP_NAME);

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

loadEnvironmentFiles();

const resolveAppAssetPath = (filename: string): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, "assets", filename)
    : path.resolve(__dirname, "../../assets", filename);

const state: {
  status: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
} = {
  status: "idle",
  lastRunAt: null,
  nextRunAt: null,
  lastError: null
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

let scheduleTimer: NodeJS.Timeout | null = null;
let mainWindow: BrowserWindow | null = null;
const connectionDebugEvents: Array<{
  at: string;
  scope: "main";
  provider?: string;
  action: string;
  stage: "start" | "success" | "error" | "info";
  message: string;
}> = [];

function pushConnectionDebugEvent(event: {
  provider?: string;
  action: string;
  stage: "start" | "success" | "error" | "info";
  message: string;
}): void {
  connectionDebugEvents.push({
    at: new Date().toISOString(),
    scope: "main",
    ...event
  });
  if (connectionDebugEvents.length > 300) {
    connectionDebugEvents.splice(0, connectionDebugEvents.length - 300);
  }
}

function createWindow(): BrowserWindow {
  const iconPath = resolveAppAssetPath("icon.png");
  const hasIcon = fs.existsSync(iconPath);
  const window = new BrowserWindow({
    title: APP_NAME,
    width: 1240,
    height: 840,
    show: false,
    ...(hasIcon ? { icon: iconPath } : {}),
    ...(process.platform === "darwin" ? { titleBarStyle: "hidden" as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js")
    }
  });
  if (process.platform === "darwin") {
    window.setWindowButtonVisibility(false);
    if (hasIcon) {
      app.dock.setIcon(iconPath);
    }
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  window.once("ready-to-show", () => {
    window.show();
    window.focus();
    if (process.platform === "darwin") {
      app.dock.show();
    }
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  mainWindow = window;
  return window;
}

function focusOrCreateMainWindow(): void {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    return;
  }
  const candidate = mainWindow ?? BrowserWindow.getAllWindows()[0] ?? null;
  if (!candidate) {
    createWindow();
    return;
  }
  if (candidate.isMinimized()) {
    candidate.restore();
  }
  if (!candidate.isVisible()) {
    candidate.show();
  }
  candidate.focus();
}

app.whenReady().then(() => {
  const userDataPath = app.getPath("userData");
  fs.mkdirSync(path.join(userDataPath, "logs"), { recursive: true });

  const dbPath = path.join(userDataPath, "archi.db");
  const settingsPath = path.join(userDataPath, "settings.json");
  const syncStatePath = path.join(userDataPath, "sync-state.json");
  const logPath = path.join(userDataPath, "logs", "sync.log");
  const db = openCoreDatabase(dbPath);
  const repository = new CoreRepository(db);
  const backfilledPositions = repository.backfillCloudPassagePositions(decodeKindleHighlightLocation);
  if (backfilledPositions > 0) {
    console.log(`[archi] Backfilled position for ${backfilledPositions} cloud passages from external_passage_id.`);
  }

  const emitSyncProgress = (
    params: Omit<SyncProgressEvent, "at" | "elapsedMs"> & { startedAtMs: number; persist?: boolean }
  ): void => {
    const payload: SyncProgressEvent = {
      ...params,
      at: new Date().toISOString(),
      elapsedMs: Date.now() - params.startedAtMs
    };
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("archi:sync-progress", payload);
    }
    if (params.persist) {
      fs.appendFileSync(
        logPath,
        `${payload.at} progress run=${payload.runId} phase=${payload.phase} status=${payload.status} msg=${payload.message}\n`
      );
    }
  };

  const settings = loadSettings(settingsPath);
  clearStaleNotionDatabaseIdsFromSyncError(syncStatePath, settingsPath, settings);
  const credentialStore = new CredentialStore(userDataPath, {
    allowEncryption: app.isPackaged
  });
  const notionAuthStore: NotionAuthStore = {
    get: () => {
      const raw = credentialStore.get("notion.auth");
      if (!raw) {
        return null;
      }
      try {
        return JSON.parse(raw) as NotionAuth;
      } catch {
        return null;
      }
    },
    set: (auth) => {
      credentialStore.set("notion.auth", JSON.stringify(auth));
    },
    clear: () => {
      credentialStore.delete("notion.auth");
    }
  };
  migrateLegacyNotionToken(settingsPath, settings, notionAuthStore);
  let activeCloudFetchRunId: string | null = null;
  let activeCloudFetchStartedAtMs: number | null = null;
  let lastCloudFetchProgressKey: string | null = null;
  let activeCloudFetchMessage = "Fetching cloud notebook highlights.";
  let activeCloudFetchCounts: SyncProgressEvent["counts"] | undefined;

  const cloudValidationLogPath = path.join(app.getPath("userData"), "cloud-validation.log");
  const cloudValidationLog = new CloudValidationLog({
    persist: (report: CloudValidationReport) => appendValidationReport(cloudValidationLogPath, report)
  });

  const cloudConnector = new PlaywrightCloudNotebookConnector({
    notebookUrl: settings.cloud.notebookUrl,
    storageStatePath: settings.cloud.storageStatePath,
    profilePath: settings.cloud.profilePath,
    onValidation: (report) => cloudValidationLog.record(report),
    onNeedsAuth: async () => {
      state.status = "needs_auth";
    },
    onFetchProgress: (event) => {
      if (!activeCloudFetchRunId || !activeCloudFetchStartedAtMs) {
        return;
      }
      const progressKey = `${event.scannedBooks}:${event.totalBooks}:${event.passagesDiscovered}:${event.skippedBooks}:${event.rowsAccepted}:${event.rowsSeen}`;
      if (progressKey === lastCloudFetchProgressKey) {
        return;
      }
      lastCloudFetchProgressKey = progressKey;
      activeCloudFetchMessage = `Scanning cloud books ${event.scannedBooks}/${event.totalBooks}. Discovered ${event.passagesDiscovered} quotes (${event.rowsAccepted}/${event.rowsSeen} rows accepted).`;
      activeCloudFetchCounts = {
        processed: event.scannedBooks,
        total: event.totalBooks,
        works: event.scannedBooks,
        passages: event.passagesDiscovered
      };
      emitSyncProgress({
        runId: activeCloudFetchRunId,
        startedAtMs: activeCloudFetchStartedAtMs,
        phase: "source_cloud_fetch",
        status: "running",
        source: "cloud-notebook",
        message: activeCloudFetchMessage,
        counts: activeCloudFetchCounts
      });
    },
    onBookFetched: ({ passages }) => {
      if (!activeCloudFetchRunId || !activeCloudFetchStartedAtMs || passages.length === 0) {
        return;
      }
      const now = new Date().toISOString();
      upsertCloudPassagesIncremental(passages, now);
      emitSyncProgress({
        runId: activeCloudFetchRunId,
        startedAtMs: activeCloudFetchStartedAtMs,
        phase: "source_cloud_fetch",
        status: "running",
        source: "cloud-notebook",
        message: activeCloudFetchMessage,
        counts: activeCloudFetchCounts,
        refreshHint: "ingest_update"
      });
    },
    onDebug: (message) => {
      if (!activeCloudFetchRunId || !activeCloudFetchStartedAtMs) {
        return;
      }
      emitSyncProgress({
        runId: activeCloudFetchRunId,
        startedAtMs: activeCloudFetchStartedAtMs,
        phase: "source_cloud_fetch",
        status: "info",
        source: "cloud-notebook",
        message: `Cloud debug: ${message}`
      });
    }
  });

  const upsertCloudPassagesIncremental = (passages: CloudPassage[], now: string): void => {
    const seenWorks = new Set<string>();
    for (const cloudPassage of passages) {
      const identity = toCloudWorkIdentity(cloudPassage);
      const workId = createId(`cloud-work:${identity.key}`);
      if (!seenWorks.has(identity.key)) {
        seenWorks.add(identity.key);
        repository.upsertWork({
          id: workId,
          ingestSource: "cloud-notebook",
          externalId: identity.externalBookId,
          displayTitle: identity.displayTitle,
          rawTitle: identity.rawTitle,
          creator: identity.creator,
          workType: "book",
          storeIdentifier: identity.storeIdentifier,
          coverImageUrl: cloudPassage.coverImageUrl,
          labels: [],
          isArchived: false,
          firstIngestedAt: now
        });
        noteTouchedWork(workId);
      }
      const rawExternalPassageId = cloudPassage.externalPassageId?.trim();
      const externalPassageNamespace =
        identity.externalBookId ?? identity.storeIdentifier ?? cloudPassage.storeIdentifier ?? workId;
      const normalizedExternalPassageId =
        rawExternalPassageId && externalPassageNamespace
          ? `${externalPassageNamespace}::${rawExternalPassageId}`
          : rawExternalPassageId;
      const passageId = createId(
        `cloud-passage:${normalizedExternalPassageId ?? `${workId}:${cloudPassage.body.slice(0, 80)}`}`
      );
      repository.upsertPassage({
        id: passageId,
        workId,
        externalPassageId: normalizedExternalPassageId,
        body: cloudPassage.body,
        readerNote: cloudPassage.note,
        positionStart: cloudPassage.positionStart,
        positionEnd: cloudPassage.positionEnd,
        positionKind: cloudPassage.positionKind,
        labels: [],
        isStarred: false,
        isHidden: false,
        isArchived: false,
        markedAt: cloudPassage.markedAt,
        ingestedAt: now,
        updatedAt: now,
        fingerprintHash: computeFingerprintHash({
          displayTitle: identity.displayTitle,
          creator: identity.creator,
          body: cloudPassage.body,
          positionStart: cloudPassage.positionStart,
          sourceScope: `cloud-notebook:${identity.externalBookId ?? identity.storeIdentifier ?? workId}`
        })
      });
      noteTouchedPassage(passageId);
    }
  };

  const notionAdapter = new NotionConnectionAdapter(
    {
      getDeviceExportPath: () => settings.deviceExportPath,
      getCloudSettings: () => settings.cloud,
      getNotionSettings: () => settings.notion
    },
    notionAuthStore
  );
  const cloudAdapter = new CloudNotebookConnectionAdapter(
    {
      getDeviceExportPath: () => settings.deviceExportPath,
      getCloudSettings: () => settings.cloud,
      getNotionSettings: () => settings.notion
    },
    cloudConnector,
    cloudValidationLog
  );
  const deviceAdapter = new DeviceExportConnectionAdapter({
    getDeviceExportPath: () => settings.deviceExportPath,
    getCloudSettings: () => settings.cloud,
    getNotionSettings: () => settings.notion
  });
  const connectionManager = new ConnectionManager([notionAdapter, cloudAdapter, deviceAdapter]);
  let inFlightSync: Promise<typeof state> | null = null;
  let inFlightRunId: string | null = null;
  let inFlightRunStartedAtMs: number | null = null;
  let cancelSyncRequested = false;
  let cancelSyncController: AbortController | null = null;
  const clearStaleNotionSyncErrorIfResolved = (): void => {
    if (!state.lastError) {
      return;
    }
    const lowerCaseError = state.lastError.toLowerCase();
    const looksLikeNotionDestinationIssue =
      lowerCaseError.includes("database with id") || lowerCaseError.includes("notion");
    if (!looksLikeNotionDestinationIssue) {
      return;
    }
    state.lastError = null;
    fs.writeFileSync(syncStatePath, JSON.stringify(state, null, 2));
    fs.appendFileSync(logPath, `${new Date().toISOString()} status=${state.status} error=none (cleared by notion reconnect)\n`);
  };

  class SyncCancelledError extends Error {
    constructor() {
      super("Sync cancelled by user.");
      this.name = "SyncCancelledError";
    }
  }

  const hasConfiguredSource = (): boolean =>
    fs.existsSync(settings.deviceExportPath) || settings.cloud.enabled;

  // Tracks IDs touched by the most recent sync run. Source-of-truth for the Home screen's
  // "new this run" activity feed — works/passages keep their original ingest timestamps on
  // re-upsert, so a timestamp-based filter would miss every already-known item.
  let runTouchedWorkIds: Set<string> | null = null;
  let runTouchedPassageIds: Set<string> | null = null;
  const noteTouchedWork = (id: string): void => {
    if (runTouchedWorkIds) {
      runTouchedWorkIds.add(id);
    }
  };
  const noteTouchedPassage = (id: string): void => {
    if (runTouchedPassageIds) {
      runTouchedPassageIds.add(id);
    }
  };

  const runSyncOnce = async (): Promise<typeof state> => {
    const runId = crypto.randomUUID();
    const startedAtMs = Date.now();
    cancelSyncRequested = false;
    cancelSyncController = new AbortController();
    inFlightRunId = runId;
    inFlightRunStartedAtMs = startedAtMs;
    runTouchedWorkIds = new Set<string>();
    runTouchedPassageIds = new Set<string>();
    if (!hasConfiguredSource()) {
      // Don't surface a hard failure when the user hasn't connected any source yet — that
      // happens immediately after onboarding and the red banner is a bad first impression.
      state.status = "idle";
      state.lastError = null;
      state.lastRunAt = new Date().toISOString();
      emitSyncProgress({
        runId,
        startedAtMs,
        phase: "sync_complete",
        status: "info",
        message: "Configure a source (Kindle Highlights, a Kindle export file, or Notion) to start syncing.",
        refreshHint: "completed",
        persist: true
      });
      fs.writeFileSync(syncStatePath, JSON.stringify(state, null, 2));
      return state;
    }
    state.status = "running";
    state.lastError = null;
    state.lastRunAt = new Date().toISOString();
    const totals = {
      worksUpserted: 0,
      passagesUpserted: 0,
      cloudPassagesFetched: 0
    };
    const throwIfCancelled = (): void => {
      if (cancelSyncRequested) {
        throw new SyncCancelledError();
      }
    };
    emitSyncProgress({
      runId,
      startedAtMs,
      phase: "sync_start",
      status: "running",
      message: "Sync run started.",
      persist: true
    });

    try {
      throwIfCancelled();
      let hasSuccessfulSource = false;
      let hadSourceFailure = false;
      const deviceSourceOptional = settings.cloud.enabled;
      const syncJobs = {
        device: repository.getSyncJob("device-export") ?? {
          id: createId("job:device-export"),
          source: "device-export" as const,
          status: "idle" as const
        },
        cloud: repository.getSyncJob("cloud-notebook") ?? {
          id: createId("job:cloud-notebook"),
          source: "cloud-notebook" as const,
          status: "idle" as const
        }
      };
      repository.upsertSyncJob({ ...syncJobs.device, status: "running", lastAttemptAt: new Date().toISOString() });
      emitSyncProgress({
        runId,
        startedAtMs,
        phase: "source_device_read",
        status: "running",
        source: "device-export",
        message: "Reading device export file.",
        persist: true
      });

      if (fs.existsSync(settings.deviceExportPath)) {
        const rawExport = fs.readFileSync(settings.deviceExportPath, "utf8");
        const normalized = normalizeDeviceExport(rawExport);
        emitSyncProgress({
          runId,
          startedAtMs,
          phase: "source_device_read",
          status: "success",
          source: "device-export",
          message: "Device export parsed.",
          counts: { works: normalized.works.length, passages: normalized.passages.length },
          persist: true
        });

        for (const [index, work] of normalized.works.entries()) {
          throwIfCancelled();
          repository.upsertWork(work);
          noteTouchedWork(work.id);
          totals.worksUpserted += 1;
          if ((index + 1) % 100 === 0 || index === normalized.works.length - 1) {
            emitSyncProgress({
              runId,
              startedAtMs,
              phase: "source_device_upsert_works",
              status: "running",
              source: "device-export",
              message: "Upserting works from device export.",
              counts: { processed: index + 1, total: normalized.works.length },
              refreshHint: "ingest_update"
            });
          }
        }

        for (const [index, passage] of normalized.passages.entries()) {
          throwIfCancelled();
          repository.upsertPassage(passage);
          noteTouchedPassage(passage.id);
          totals.passagesUpserted += 1;
          if ((index + 1) % 100 === 0 || index === normalized.passages.length - 1) {
            emitSyncProgress({
              runId,
              startedAtMs,
              phase: "source_device_upsert_passages",
              status: "running",
              source: "device-export",
              message: "Upserting passages from device export.",
              counts: { processed: index + 1, total: normalized.passages.length },
              refreshHint: "ingest_update"
            });
          }
        }
        repository.upsertSyncJob({
          ...syncJobs.device,
          status: "success",
          lastSuccessAt: new Date().toISOString(),
          lastAttemptAt: new Date().toISOString()
        });
        emitSyncProgress({
          runId,
          startedAtMs,
          phase: "source_device_upsert_passages",
          status: "success",
          source: "device-export",
          message: "Device export ingestion finished.",
          counts: { works: normalized.works.length, passages: normalized.passages.length },
          refreshHint: "ingest_update",
          persist: true
        });
        hasSuccessfulSource = true;
      } else {
        if (!deviceSourceOptional) {
          hadSourceFailure = true;
        }
        repository.upsertSyncJob({
          ...syncJobs.device,
          status: deviceSourceOptional ? "idle" : "failed",
          lastAttemptAt: new Date().toISOString(),
          lastError: deviceSourceOptional ? undefined : `Device export file not found at ${settings.deviceExportPath}`
        });
        emitSyncProgress({
          runId,
          startedAtMs,
          phase: "source_device_read",
          status: deviceSourceOptional ? "info" : "failed",
          source: "device-export",
          message: deviceSourceOptional
            ? `Device export file not found at ${settings.deviceExportPath}; skipping optional local source.`
            : `Device export file not found at ${settings.deviceExportPath}`,
          persist: true
        });
      }

      if (settings.cloud.enabled) {
        throwIfCancelled();
        repository.upsertSyncJob({ ...syncJobs.cloud, status: "running", lastAttemptAt: new Date().toISOString() });
        emitSyncProgress({
          runId,
          startedAtMs,
          phase: "source_cloud_fetch",
          status: "running",
          source: "cloud-notebook",
          message: activeCloudFetchMessage,
          counts: activeCloudFetchCounts,
          persist: true
        });
        const cloudFetchHeartbeat = setInterval(() => {
          emitSyncProgress({
            runId,
            startedAtMs,
            phase: "source_cloud_fetch",
            status: "running",
            source: "cloud-notebook",
            message: activeCloudFetchMessage,
            counts: activeCloudFetchCounts
          });
        }, 10_000);
        try {
          const priorCloudPassageCount = repository.countCloudPassages();
          activeCloudFetchRunId = runId;
          activeCloudFetchStartedAtMs = startedAtMs;
          lastCloudFetchProgressKey = null;
          activeCloudFetchMessage = "Fetching cloud notebook highlights.";
          activeCloudFetchCounts = undefined;
          const cloudBatch = await withTimeout(
            cloudConnector.fetchSince(syncJobs.cloud.resumeCursor, {
              signal: cancelSyncController.signal
            }),
            900_000,
            "Cloud notebook fetch timed out after 900 seconds."
          );
          clearInterval(cloudFetchHeartbeat);
          activeCloudFetchRunId = null;
          activeCloudFetchStartedAtMs = null;
          lastCloudFetchProgressKey = null;
          activeCloudFetchMessage = "Fetching cloud notebook highlights.";
          activeCloudFetchCounts = undefined;
          throwIfCancelled();
          const now = new Date().toISOString();
          totals.cloudPassagesFetched = cloudBatch.passages.length;
          const distinctCloudWorkCount = new Set(cloudBatch.passages.map((passage) => toCloudWorkIdentity(passage).key)).size;
          emitSyncProgress({
            runId,
            startedAtMs,
            phase: "source_cloud_fetch",
            status: "success",
            source: "cloud-notebook",
            message: `Cloud fetch completed: ${cloudBatch.passages.length} quotes across ${distinctCloudWorkCount} books (${cloudBatch.stats.rowsAccepted}/${cloudBatch.stats.rowsSeen} rows accepted).`,
            counts: { works: distinctCloudWorkCount, passages: cloudBatch.passages.length },
            persist: true
          });
          const workRecords = new Map<
            string,
            {
              id: string;
              displayTitle: string;
              creator?: string;
              externalId?: string;
              storeIdentifier?: string;
              coverImageUrl?: string;
            }
          >();
          const normalizedExternalPassageIds = new Set<string>();
          for (const [index, cloudPassage] of cloudBatch.passages.entries()) {
            throwIfCancelled();
            const identity = toCloudWorkIdentity(cloudPassage);
            const workKey = identity.key;
            let workRecord = workRecords.get(workKey);
            if (!workRecord) {
              workRecord = {
                id: createId(`cloud-work:${workKey}`),
                displayTitle: identity.displayTitle,
                creator: identity.creator,
                externalId: identity.externalBookId,
                storeIdentifier: identity.storeIdentifier,
                coverImageUrl: cloudPassage.coverImageUrl
              };
              workRecords.set(workKey, workRecord);
              repository.upsertWork({
                id: workRecord.id,
                ingestSource: "cloud-notebook",
                externalId: workRecord.externalId,
                displayTitle: workRecord.displayTitle,
                rawTitle: identity.rawTitle,
                creator: workRecord.creator,
                workType: "book",
                storeIdentifier: workRecord.storeIdentifier,
                coverImageUrl: workRecord.coverImageUrl,
                labels: [],
                isArchived: false,
                firstIngestedAt: now
              });
              noteTouchedWork(workRecord.id);
              totals.worksUpserted += 1;
            } else {
              const nextExternalId = workRecord.externalId ?? identity.externalBookId;
              const nextStoreIdentifier = workRecord.storeIdentifier ?? identity.storeIdentifier;
              const nextCoverImageUrl = workRecord.coverImageUrl ?? cloudPassage.coverImageUrl;
              const nextDisplayTitle = choosePreferredCloudTitle(workRecord.displayTitle, identity.displayTitle);
              const nextCreator = workRecord.creator ?? identity.creator;
              if (
                nextExternalId !== workRecord.externalId ||
                nextStoreIdentifier !== workRecord.storeIdentifier ||
                nextCoverImageUrl !== workRecord.coverImageUrl ||
                nextDisplayTitle !== workRecord.displayTitle ||
                nextCreator !== workRecord.creator
              ) {
                workRecord = {
                  ...workRecord,
                  externalId: nextExternalId,
                  storeIdentifier: nextStoreIdentifier,
                  coverImageUrl: nextCoverImageUrl,
                  displayTitle: nextDisplayTitle,
                  creator: nextCreator
                };
                workRecords.set(workKey, workRecord);
                repository.upsertWork({
                  id: workRecord.id,
                  ingestSource: "cloud-notebook",
                  externalId: workRecord.externalId,
                  displayTitle: workRecord.displayTitle,
                  rawTitle: workRecord.displayTitle,
                  creator: workRecord.creator,
                  workType: "book",
                  storeIdentifier: workRecord.storeIdentifier,
                  coverImageUrl: workRecord.coverImageUrl,
                  labels: [],
                  isArchived: false,
                  firstIngestedAt: now
                });
              }
            }
            const rawExternalPassageId = cloudPassage.externalPassageId?.trim();
            const externalPassageNamespace =
              workRecord.externalId ?? workRecord.storeIdentifier ?? cloudPassage.storeIdentifier ?? workRecord.id;
            const normalizedExternalPassageId =
              rawExternalPassageId && externalPassageNamespace
                ? `${externalPassageNamespace}::${rawExternalPassageId}`
                : rawExternalPassageId;
            if (normalizedExternalPassageId) {
              normalizedExternalPassageIds.add(normalizedExternalPassageId);
            }
            const postFetchPassageId = createId(
              `cloud-passage:${normalizedExternalPassageId ?? `${workRecord.id}:${index}`}`
            );
            repository.upsertPassage({
              id: postFetchPassageId,
              workId: workRecord.id,
              externalPassageId: normalizedExternalPassageId,
              body: cloudPassage.body,
              readerNote: cloudPassage.note,
              positionStart: cloudPassage.positionStart,
              positionEnd: cloudPassage.positionEnd,
              positionKind: cloudPassage.positionKind,
              labels: [],
              isStarred: false,
              isHidden: false,
              isArchived: false,
              markedAt: cloudPassage.markedAt,
              ingestedAt: now,
              updatedAt: now,
              fingerprintHash: computeFingerprintHash({
                displayTitle: workRecord.displayTitle,
                creator: workRecord.creator,
                body: cloudPassage.body,
                positionStart: cloudPassage.positionStart,
                sourceScope: `cloud-notebook:${identity.externalBookId ?? identity.storeIdentifier ?? workRecord.id}`
              })
            });
            noteTouchedPassage(postFetchPassageId);
            totals.passagesUpserted += 1;
            if ((index + 1) % 25 === 0 || index === cloudBatch.passages.length - 1) {
              const hydrated = index + 1;
              const remaining = Math.max(0, cloudBatch.passages.length - hydrated);
              emitSyncProgress({
                runId,
                startedAtMs,
                phase: "source_cloud_upsert",
                status: "running",
                source: "cloud-notebook",
                message: `Hydrating cloud highlights into ${workRecords.size} books. ${remaining} quotes remaining.`,
                counts: { processed: hydrated, total: cloudBatch.passages.length, works: workRecords.size },
                refreshHint: "ingest_update"
              });
            }
          }
          const shouldReconcileDeletes =
            normalizedExternalPassageIds.size > 0 &&
            (cloudBatch.passages.length > 0 || priorCloudPassageCount === 0) &&
            !(priorCloudPassageCount > 0 && cloudBatch.passages.length < Math.max(50, Math.floor(priorCloudPassageCount * 0.1)));
          let removedPassages = 0;
          let removedWorks = 0;
          if (shouldReconcileDeletes) {
            removedPassages = repository.deleteCloudPassagesNotInExternalIds(Array.from(normalizedExternalPassageIds));
            removedWorks = repository.deleteEmptyCloudWorks();
          } else {
            emitSyncProgress({
              runId,
              startedAtMs,
              phase: "source_cloud_upsert",
              status: "info",
              source: "cloud-notebook",
              message: `Skipped destructive reconciliation due to low-confidence fetch evidence (${cloudBatch.passages.length} quotes, ${normalizedExternalPassageIds.size} external ids, prior=${priorCloudPassageCount}).`,
              persist: true
            });
          }
          if (removedPassages > 0 || removedWorks > 0) {
            emitSyncProgress({
              runId,
              startedAtMs,
              phase: "source_cloud_upsert",
              status: "info",
              source: "cloud-notebook",
              message: `Reconciled cloud data: removed ${removedPassages} stale quotes and ${removedWorks} empty books.`,
              refreshHint: "ingest_update",
              persist: true
            });
          }
          if (cloudBatch.stats.skippedBooks > 0) {
            emitSyncProgress({
              runId,
              startedAtMs,
              phase: "source_cloud_fetch",
              status: "info",
              source: "cloud-notebook",
              message: `Skipped ${cloudBatch.stats.skippedBooks} books that were inaccessible during fetch.`,
              persist: true
            });
          }

          repository.upsertSyncJob({
            ...syncJobs.cloud,
            status: "success",
            resumeCursor: cloudBatch.cursor,
            lastSuccessAt: now,
            lastAttemptAt: now
          });
          emitSyncProgress({
            runId,
            startedAtMs,
            phase: "source_cloud_upsert",
            status: "success",
            source: "cloud-notebook",
            message: "Cloud notebook ingestion finished.",
            counts: { passages: cloudBatch.passages.length },
            refreshHint: "ingest_update",
            persist: true
          });
          hasSuccessfulSource = true;
        } catch (error) {
          clearInterval(cloudFetchHeartbeat);
          activeCloudFetchRunId = null;
          activeCloudFetchStartedAtMs = null;
          lastCloudFetchProgressKey = null;
          activeCloudFetchMessage = "Fetching cloud notebook highlights.";
          activeCloudFetchCounts = undefined;
          if (error instanceof SyncCancelledError) {
            throw error;
          }
          hadSourceFailure = true;
          const status = (await cloudConnector.getStatus()) === "needs_auth" ? "needs_auth" : "partial_success";
          repository.upsertSyncJob({
            ...syncJobs.cloud,
            status,
            lastAttemptAt: new Date().toISOString(),
            lastError: error instanceof Error ? error.message : "Cloud sync failed"
          });
          state.status = status;
          emitSyncProgress({
            runId,
            startedAtMs,
            phase: "source_cloud_fetch",
            status,
            source: "cloud-notebook",
            message: error instanceof Error ? error.message : "Cloud sync failed",
            persist: true
          });
        }
      }

      const allWorks = repository.listWorks();
      const allPassages = repository.listPassages();
      throwIfCancelled();

      const notionToken = notionAdapter.getToken();
      if (!notionToken) {
        emitSyncProgress({
          runId,
          startedAtMs,
          phase: "destination_notion_works",
          status: "info",
          source: "notion",
          message: "Notion is not connected. Skipping destination sync for this run.",
          persist: true
        });
      } else {
        try {
          const syncNotionDestination = async (): Promise<void> => {
            throwIfCancelled();
            const notionDestination = new NotionDestination({
              integrationToken: notionToken,
              parentPageId: settings.notion.parentPageId,
              libraryDatabaseId: settings.notion.libraryDatabaseId,
              passagesDatabaseId: settings.notion.passagesDatabaseId
            });

            const onNotionProgress = (event: NotionSyncBatchProgressEvent): void => {
              throwIfCancelled();
              emitSyncProgress({
                runId,
                startedAtMs,
                phase: event.phase === "works" ? "destination_notion_works" : "destination_notion_passages",
                status: "running",
                source: "notion",
                message: event.phase === "works" ? "Syncing works to Notion." : "Syncing passages to Notion.",
                counts: { processed: event.processed, total: event.total }
              });
            };

            await notionDestination.syncBatch(
              allWorks.map((work) => ({
                sourceWorkId: work.id,
                externalId: work.externalId,
                displayTitle: work.displayTitle,
                creator: work.creator,
                workType: work.workType,
                ingestSource: work.ingestSource,
                storeIdentifier: work.storeIdentifier,
                coverImageUrl: work.coverImageUrl,
                labels: work.labels,
                workNote: work.workNote,
                firstIngestedAt: work.firstIngestedAt,
                lastSourceChangedAt: work.lastSourceChangedAt,
                lastSyncedAt: work.lastSyncedAt,
                isArchived: work.isArchived
              })),
              allPassages.map((passage) => {
                return {
                  workId: passage.workId,
                  externalPassageId: passage.externalPassageId,
                  body: passage.body,
                  readerNote: passage.readerNote,
                  position: passage.positionStart,
                  markerColor: passage.markerColor,
                  positionKind: passage.positionKind,
                  markedAt: passage.markedAt,
                  ingestedAt: passage.ingestedAt,
                  updatedAt: passage.updatedAt,
                  labels: passage.labels,
                  isStarred: passage.isStarred,
                  isHidden: passage.isHidden,
                  isArchived: passage.isArchived,
                  fingerprintHash: passage.fingerprintHash
                };
              }),
              { onProgress: onNotionProgress }
            );
            throwIfCancelled();
            const resolvedNotionConfig = notionDestination.getResolvedConfig();
            let shouldPersistNotionSettings = false;
            if (resolvedNotionConfig.parentPageId && settings.notion.parentPageId !== resolvedNotionConfig.parentPageId) {
              settings.notion.parentPageId = resolvedNotionConfig.parentPageId;
              shouldPersistNotionSettings = true;
            }
            if (
              resolvedNotionConfig.libraryDatabaseId &&
              settings.notion.libraryDatabaseId !== resolvedNotionConfig.libraryDatabaseId
            ) {
              settings.notion.libraryDatabaseId = resolvedNotionConfig.libraryDatabaseId;
              shouldPersistNotionSettings = true;
            }
            if (
              resolvedNotionConfig.passagesDatabaseId &&
              settings.notion.passagesDatabaseId !== resolvedNotionConfig.passagesDatabaseId
            ) {
              settings.notion.passagesDatabaseId = resolvedNotionConfig.passagesDatabaseId;
              shouldPersistNotionSettings = true;
            }
            if (shouldPersistNotionSettings) {
              saveSettings(settingsPath, settings);
            }
          };

          try {
            await syncNotionDestination();
          } catch (error) {
            if (error instanceof SyncCancelledError) {
              throw error;
            }
            if (!isNotionObjectMissingError(error)) {
              throw error;
            }
            if (!settings.notion.libraryDatabaseId && !settings.notion.passagesDatabaseId) {
              throw error;
            }
            // Stale Notion DB ids can linger in local settings after manual DB deletion
            // or integration scope changes. Clear and retry once to self-heal.
            settings.notion.libraryDatabaseId = undefined;
            settings.notion.passagesDatabaseId = undefined;
            saveSettings(settingsPath, settings);
            emitSyncProgress({
              runId,
              startedAtMs,
              phase: "destination_notion_works",
              status: "info",
              source: "notion",
              message: "Detected stale Notion database IDs; reprovisioning destination.",
              persist: true
            });
            await syncNotionDestination();
          }

          emitSyncProgress({
            runId,
            startedAtMs,
            phase: "destination_notion_passages",
            status: "success",
            source: "notion",
            message: "Notion destination sync finished.",
            counts: { works: allWorks.length, passages: allPassages.length },
            persist: true
          });
        } catch (error) {
          if (error instanceof SyncCancelledError) {
            throw error;
          }
          const message = getErrorMessage(error) || "Notion destination sync failed.";
          state.status = "partial_success";
          state.lastError = message;
          emitSyncProgress({
            runId,
            startedAtMs,
            phase: "destination_notion_works",
            status: "partial_success",
            source: "notion",
            message,
            persist: true
          });
        }
      }

      if (state.status === "running") {
        if (!hasSuccessfulSource) {
          state.status = "failed";
          if (!state.lastError) {
            state.lastError = "No source completed successfully. Configure at least one source before syncing.";
          }
        } else {
          state.status = hadSourceFailure ? "partial_success" : "success";
        }
      }
    } catch (error) {
      const isAbortError = error instanceof Error && error.name === "AbortError";
      if (error instanceof SyncCancelledError || isAbortError) {
        state.status = "cancelled";
        state.lastError = null;
        emitSyncProgress({
          runId,
          startedAtMs,
          phase: "sync_error",
          status: "info",
          message: error instanceof Error ? error.message : "Sync cancelled by user.",
          persist: true
        });
      } else {
        state.status = "failed";
        state.lastError = error instanceof Error ? error.message : "Unknown error";
        emitSyncProgress({
          runId,
          startedAtMs,
          phase: "sync_error",
          status: "failed",
          message: state.lastError,
          persist: true
        });
      }
    }

    const completionStatus: SyncProgressStatus =
      state.status === "success" ||
      state.status === "failed" ||
      state.status === "needs_auth" ||
      state.status === "partial_success"
        ? state.status
        : "info";
    emitSyncProgress({
      runId,
      startedAtMs,
      phase: "sync_complete",
      status: completionStatus,
      message: `Sync completed with status=${state.status}.`,
      counts: {
        works: totals.worksUpserted,
        passages: totals.passagesUpserted,
        total: totals.cloudPassagesFetched
      },
      refreshHint: "completed",
      persist: true
    });

    fs.writeFileSync(syncStatePath, JSON.stringify(state, null, 2));
    fs.appendFileSync(logPath, `${new Date().toISOString()} status=${state.status} error=${state.lastError ?? "none"}\n`);
    return state;
  };

  const runSync = (): Promise<typeof state> => {
    if (inFlightSync) {
      return inFlightSync;
    }
    inFlightSync = runSyncOnce().finally(() => {
      inFlightSync = null;
      inFlightRunId = null;
      inFlightRunStartedAtMs = null;
      cancelSyncRequested = false;
      cancelSyncController = null;
    });
    return inFlightSync;
  };

  let backgroundSyncStarted = false;
  const startBackgroundSync = (): void => {
    if (backgroundSyncStarted) {
      return;
    }
    backgroundSyncStarted = true;
    schedule();
    void runSync();
  };

  const schedule = (): void => {
    if (scheduleTimer) {
      clearTimeout(scheduleTimer);
    }
    const intervalMs = Math.max(settings.syncIntervalHours, 1) * 60 * 60 * 1000;
    state.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    scheduleTimer = setTimeout(() => {
      void runSync().finally(schedule);
    }, intervalMs);
  };

  ipcMain.handle("archi:get-sync-state", () => state);
  ipcMain.handle("archi:close-window", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.handle("archi:get-settings", () => ({
    deviceExportPath: settings.deviceExportPath,
    cloudEnabled: settings.cloud.enabled,
    cloudNotebookUrl: settings.cloud.notebookUrl,
    onboardingCompleted: settings.onboarding.completed
  }));
  ipcMain.handle("archi:complete-onboarding", () => {
    if (!settings.onboarding.completed) {
      settings.onboarding.completed = true;
      settings.onboarding.completedAt = new Date().toISOString();
      saveSettings(settingsPath, settings);
    }
    startBackgroundSync();
    return {
      onboardingCompleted: settings.onboarding.completed
    };
  });
  ipcMain.handle("archi:choose-device-export-path", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose Kindle export file",
      properties: ["openFile"],
      filters: [
        { name: "Text files", extensions: ["txt"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return {
        selected: false,
        deviceExportPath: settings.deviceExportPath
      };
    }

    const [selectedPath] = result.filePaths;
    if (!selectedPath) {
      return {
        selected: false,
        deviceExportPath: settings.deviceExportPath
      };
    }

    settings.deviceExportPath = selectedPath;
    saveSettings(settingsPath, settings);
    return {
      selected: true,
      deviceExportPath: settings.deviceExportPath
    };
  });
  ipcMain.handle("archi:set-cloud-enabled", (_event, enabled: boolean) => {
    settings.cloud.enabled = enabled;
    saveSettings(settingsPath, settings);
    return {
      cloudEnabled: settings.cloud.enabled
    };
  });
  ipcMain.handle("archi:get-connections", () => connectionManager.getAllStatuses());
  ipcMain.handle("archi:set-notion-token", async (_event, token: string) => {
    pushConnectionDebugEvent({
      provider: "notion",
      action: "set-notion-token",
      stage: "start",
      message: "Received token set request."
    });
    try {
      const result = await connectionManager.setNotionToken(token);
      if (result.status === "connected") {
        clearStaleNotionSyncErrorIfResolved();
      }
      pushConnectionDebugEvent({
        provider: "notion",
        action: "set-notion-token",
        stage: "success",
        message: `Token set request completed with status=${result.status}.`
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      pushConnectionDebugEvent({
        provider: "notion",
        action: "set-notion-token",
        stage: "error",
        message
      });
      throw error;
    }
  });
  ipcMain.handle("archi:connect-connection", async (_event, provider: ConnectionProvider) => {
    pushConnectionDebugEvent({
      provider,
      action: "connect",
      stage: "start",
      message: "Connect requested."
    });
    try {
      const result = await connectionManager.connect(provider);
      if (provider === "notion" && result.status === "connected") {
        clearStaleNotionSyncErrorIfResolved();
      }
      pushConnectionDebugEvent({
        provider,
        action: "connect",
        stage: "success",
        message: `Connect completed with status=${result.status}.`
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      pushConnectionDebugEvent({
        provider,
        action: "connect",
        stage: "error",
        message
      });
      throw error;
    }
  });
  ipcMain.handle("archi:reconnect-connection", async (_event, provider: ConnectionProvider) => {
    pushConnectionDebugEvent({
      provider,
      action: "reconnect",
      stage: "start",
      message: "Reconnect requested."
    });
    try {
      const result = await connectionManager.reconnect(provider);
      if (provider === "notion" && result.status === "connected") {
        clearStaleNotionSyncErrorIfResolved();
      }
      pushConnectionDebugEvent({
        provider,
        action: "reconnect",
        stage: "success",
        message: `Reconnect completed with status=${result.status}.`
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      pushConnectionDebugEvent({
        provider,
        action: "reconnect",
        stage: "error",
        message
      });
      throw error;
    }
  });
  ipcMain.handle("archi:disconnect-connection", async (_event, provider: ConnectionProvider) => {
    pushConnectionDebugEvent({
      provider,
      action: "disconnect",
      stage: "start",
      message: "Disconnect requested."
    });
    try {
      const result = await connectionManager.disconnect(provider);
      pushConnectionDebugEvent({
        provider,
        action: "disconnect",
        stage: "success",
        message: `Disconnect completed with status=${result.status}.`
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      pushConnectionDebugEvent({
        provider,
        action: "disconnect",
        stage: "error",
        message
      });
      throw error;
    }
  });
  ipcMain.handle("archi:test-connection", async (_event, provider: ConnectionProvider) => {
    pushConnectionDebugEvent({
      provider,
      action: "test",
      stage: "start",
      message: "Connection test requested."
    });
    try {
      const result = await connectionManager.testConnection(provider);
      if (provider === "notion" && result.status === "connected") {
        clearStaleNotionSyncErrorIfResolved();
      }
      pushConnectionDebugEvent({
        provider,
        action: "test",
        stage: "success",
        message: `Connection test completed with status=${result.status}.`
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      pushConnectionDebugEvent({
        provider,
        action: "test",
        stage: "error",
        message
      });
      throw error;
    }
  });
  ipcMain.handle("archi:list-connection-debug-events", () => connectionDebugEvents.slice(-200).reverse());
  ipcMain.handle("archi:get-recent-validations", (_event, limit: number = 5) => cloudValidationLog.recent(limit));
  ipcMain.handle("archi:open-validation-log", () => {
    shell.showItemInFolder(cloudValidationLogPath);
  });
  ipcMain.handle("archi:list-works", () =>
    repository.listWorks().map((work) => ({
      id: work.id,
      title: work.displayTitle,
      creator: work.creator,
      ingestSource: work.ingestSource,
      externalId: work.externalId,
      storeIdentifier: work.storeIdentifier,
      coverImageUrl: work.coverImageUrl
    }))
  );
  ipcMain.handle("archi:list-passages", () => {
    const worksById = new Map(repository.listWorks().map((work) => [work.id, work.displayTitle]));
    return repository.listPassages().map((passage) => ({
      id: passage.id,
      body: passage.body,
      workId: passage.workId,
      workTitle: worksById.get(passage.workId) ?? "Unknown Work"
    }));
  });
  ipcMain.handle("archi:list-recent-activity", (_event, limit?: number) => {
    const max = typeof limit === "number" && limit > 0 ? Math.min(limit, 50) : 8;
    const allWorks = repository.listWorks();
    const worksById = new Map(allWorks.map((work) => [work.id, work]));
    // When a sync has run this session, prefer the touched-this-run set so the activity
    // feed reflects what just happened — re-upserting an existing work keeps its original
    // first_ingested_at, so a timestamp-only sort would never surface familiar books.
    if (runTouchedWorkIds && runTouchedPassageIds) {
      const passagesById = new Map(repository.listPassages().map((passage) => [passage.id, passage]));
      const recentWorks = Array.from(runTouchedWorkIds)
        .reverse()
        .slice(0, max)
        .map((id) => worksById.get(id))
        .filter((work): work is NonNullable<typeof work> => work !== undefined)
        .map((work) => ({
          id: work.id,
          title: work.displayTitle,
          creator: work.creator,
          coverImageUrl: work.coverImageUrl,
          ingestedAt: work.firstIngestedAt
        }));
      const recentPassages = Array.from(runTouchedPassageIds)
        .reverse()
        .slice(0, max)
        .map((id) => passagesById.get(id))
        .filter((passage): passage is NonNullable<typeof passage> => passage !== undefined)
        .map((passage) => ({
          id: passage.id,
          body: passage.body,
          workTitle: worksById.get(passage.workId)?.displayTitle ?? "Unknown Work",
          ingestedAt: passage.markedAt ?? passage.ingestedAt
        }));
      return { works: recentWorks, passages: recentPassages };
    }
    const recentWorks = [...allWorks]
      .sort((a, b) => (b.firstIngestedAt ?? "").localeCompare(a.firstIngestedAt ?? ""))
      .slice(0, max)
      .map((work) => ({
        id: work.id,
        title: work.displayTitle,
        creator: work.creator,
        coverImageUrl: work.coverImageUrl,
        ingestedAt: work.firstIngestedAt
      }));
    const recentPassages = repository
      .listPassages()
      .slice(0, max)
      .map((passage) => ({
        id: passage.id,
        body: passage.body,
        workTitle: worksById.get(passage.workId)?.displayTitle ?? "Unknown Work",
        ingestedAt: passage.markedAt ?? passage.ingestedAt
      }));
    return { works: recentWorks, passages: recentPassages };
  });
  ipcMain.handle("archi:list-passages-by-work", (_event, workId: string) =>
    repository.listPassagesByWorkId(workId).map((passage) => ({
      id: passage.id,
      body: passage.body,
      readerNote: passage.readerNote,
      externalPassageId: passage.externalPassageId,
      positionKind: passage.positionKind,
      positionStart: passage.positionStart,
      positionEnd: passage.positionEnd,
      markedAt: passage.markedAt,
      updatedAt: passage.updatedAt
    }))
  );
  ipcMain.handle("archi:open-external-url", async (_event, rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      return {
        opened: false,
        error: "URL is required."
      };
    }
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return {
        opened: false,
        error: "URL is not valid."
      };
    }
    const allowedProtocols = new Set(["https:", "http:", "kindle:"]);
    if (!allowedProtocols.has(parsed.protocol)) {
      return {
        opened: false,
        error: `Protocol ${parsed.protocol} is not allowed.`
      };
    }
    try {
      await shell.openExternal(parsed.toString());
      return {
        opened: true
      };
    } catch (error) {
      return {
        opened: false,
        error: error instanceof Error ? error.message : "Failed to open URL."
      };
    }
  });
  ipcMain.handle("archi:list-logs", () => {
    if (!fs.existsSync(logPath)) {
      return [] as string[];
    }
    return fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-200)
      .reverse();
  });
  ipcMain.handle("archi:run-sync-now", async () => {
    const current = await runSync();
    schedule();
    return current;
  });
  ipcMain.handle("archi:cancel-sync", () => {
    if (!inFlightSync || !inFlightRunId || !inFlightRunStartedAtMs) {
      return {
        requested: false,
        message: "No sync is currently running."
      };
    }
    if (cancelSyncRequested) {
      return {
        requested: true,
        message: "Sync cancellation already requested."
      };
    }
    cancelSyncRequested = true;
    cancelSyncController?.abort();
    emitSyncProgress({
      runId: inFlightRunId,
      startedAtMs: inFlightRunStartedAtMs,
      phase: "sync_cancel_requested",
      status: "info",
      message: "Cancellation requested. Sync will stop after the current step.",
      persist: true
    });
    return {
      requested: true,
      message: "Sync cancellation requested."
    };
  });

  createWindow();
  if (settings.onboarding.completed) {
    startBackgroundSync();
  }
});

app.on("activate", () => {
  focusOrCreateMainWindow();
});

app.on("second-instance", () => {
  if (!app.isReady()) {
    return;
  }
  focusOrCreateMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

type AppSettings = {
  deviceExportPath: string;
  syncIntervalHours: number;
  onboarding: {
    completed: boolean;
    completedAt?: string;
  };
  cloud: {
    enabled: boolean;
    notebookUrl: string;
    storageStatePath: string;
    profilePath: string;
  };
  notion: {
    integrationToken?: string;
    parentPageId?: string;
    libraryDatabaseId?: string;
    passagesDatabaseId?: string;
  };
};

function loadSettings(settingsPath: string): AppSettings {
  if (!fs.existsSync(settingsPath)) {
    const defaults: AppSettings = {
      deviceExportPath: path.join(process.env.HOME ?? ".", "Documents", "My Clippings.txt"),
      syncIntervalHours: Number(process.env.SYNC_INTERVAL_HOURS ?? "6"),
      onboarding: {
        completed: false
      },
      cloud: {
        enabled: process.env.CLOUD_SYNC_ENABLED === "true",
        notebookUrl: process.env.CLOUD_NOTEBOOK_URL ?? "https://read.amazon.com/notebook",
        storageStatePath: path.join(process.env.HOME ?? ".", ".archi-cloud-storage-state.json"),
        profilePath: path.join(process.env.HOME ?? ".", ".archi-cloud-profile")
      },
      notion: {
        integrationToken: process.env.NOTION_INTEGRATION_TOKEN ?? undefined,
        parentPageId: process.env.NOTION_PARENT_PAGE_ID,
        libraryDatabaseId: process.env.NOTION_LIBRARY_DB_ID,
        passagesDatabaseId: process.env.NOTION_PASSAGES_DB_ID
      }
    };
    fs.writeFileSync(settingsPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }

  const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Partial<AppSettings> & {
    onboarding?: {
      completed?: boolean;
      completedAt?: string;
      completedSteps?: string[];
    };
  };
  const resolved: AppSettings = {
    deviceExportPath: parsed.deviceExportPath ?? path.join(process.env.HOME ?? ".", "Documents", "My Clippings.txt"),
    syncIntervalHours: Number(parsed.syncIntervalHours ?? process.env.SYNC_INTERVAL_HOURS ?? "6"),
    onboarding: {
      completed: parsed.onboarding?.completed ?? false,
      completedAt: parsed.onboarding?.completedAt
    },
    cloud: {
      enabled: parsed.cloud?.enabled ?? process.env.CLOUD_SYNC_ENABLED === "true",
      notebookUrl: parsed.cloud?.notebookUrl ?? process.env.CLOUD_NOTEBOOK_URL ?? "https://read.amazon.com/notebook",
      storageStatePath:
        parsed.cloud?.storageStatePath ?? path.join(process.env.HOME ?? ".", ".archi-cloud-storage-state.json"),
      profilePath: parsed.cloud?.profilePath ?? path.join(process.env.HOME ?? ".", ".archi-cloud-profile")
    },
    notion: {
      integrationToken: parsed.notion?.integrationToken ?? process.env.NOTION_INTEGRATION_TOKEN ?? undefined,
      parentPageId: parsed.notion?.parentPageId ?? process.env.NOTION_PARENT_PAGE_ID,
      libraryDatabaseId: parsed.notion?.libraryDatabaseId ?? process.env.NOTION_LIBRARY_DB_ID,
      passagesDatabaseId: parsed.notion?.passagesDatabaseId ?? process.env.NOTION_PASSAGES_DB_ID
    }
  };

  const hasLegacyOnboardingShape =
    Array.isArray(parsed.onboarding?.completedSteps) && typeof parsed.onboarding?.completed !== "boolean";
  if (hasLegacyOnboardingShape) {
    // Legacy payload had {completedSteps, completedAt} but no boolean `completed`.
    // Treat completedAt (or any completedSteps) as evidence the user already finished
    // onboarding so we don't push them through it again on upgrade.
    const hadCompletionEvidence =
      typeof parsed.onboarding?.completedAt === "string" ||
      (Array.isArray(parsed.onboarding?.completedSteps) && parsed.onboarding.completedSteps.length > 0);
    resolved.onboarding.completed = hadCompletionEvidence;
    resolved.onboarding.completedAt = hadCompletionEvidence
      ? parsed.onboarding?.completedAt ?? new Date().toISOString()
      : undefined;
    saveSettings(settingsPath, resolved);
  }

  return resolved;
}

function saveSettings(settingsPath: string, settings: AppSettings): void {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function createId(seed: string): string {
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

function normalizeWhitespace(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeLower(value: string | undefined): string {
  return normalizeWhitespace(value).toLowerCase();
}

function looksLikeAsin(value: string | undefined): boolean {
  return /^[A-Z0-9]{10}$/i.test(normalizeWhitespace(value));
}

function looksLikeHighlightMetadata(value: string | undefined): boolean {
  const normalized = normalizeLower(value);
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("highlight") ||
    normalized.startsWith("page ") ||
    normalized.startsWith("location ") ||
    normalized.startsWith("loc ") ||
    normalized.startsWith("note ")
  );
}

function isReadableCloudTitle(value: string | undefined): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return false;
  }
  if (looksLikeAsin(normalized) || looksLikeHighlightMetadata(normalized)) {
    return false;
  }
  return normalized.length >= 3;
}

function choosePreferredCloudTitle(current: string, candidate: string): string {
  if (!isReadableCloudTitle(current) && isReadableCloudTitle(candidate)) {
    return candidate;
  }
  if (isReadableCloudTitle(current) && !isReadableCloudTitle(candidate)) {
    return current;
  }
  return candidate.length > current.length ? candidate : current;
}

function toCloudWorkIdentity(passage: CloudPassage): {
  key: string;
  displayTitle: string;
  rawTitle: string;
  creator?: string;
  externalBookId?: string;
  storeIdentifier?: string;
} {
  const externalBookId = normalizeWhitespace(passage.externalBookId) || undefined;
  const storeIdentifier = normalizeWhitespace(passage.storeIdentifier) || undefined;
  const title = normalizeWhitespace(passage.title);
  const creator = normalizeWhitespace(passage.creator) || undefined;
  const readableTitle = isReadableCloudTitle(title) ? title : undefined;
  const displayTitle = readableTitle ?? "Untitled Kindle Book";
  const key =
    storeIdentifier ||
    externalBookId ||
    (readableTitle
      ? `${normalizeLower(readableTitle)}::${normalizeLower(creator)}`
      : `untitled::${normalizeLower(creator) || "unknown"}`);
  return {
    key,
    displayTitle,
    rawTitle: readableTitle ?? displayTitle,
    creator,
    externalBookId,
    storeIdentifier
  };
}

function loadEnvironmentFiles(): void {
  const candidatePaths = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
    path.resolve(process.cwd(), "..", "..", ".env"),
    path.resolve(__dirname, "..", "..", "..", ".env")
  ];
  for (const filePath of candidatePaths) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    dotenv.config({ path: filePath, override: false });
    break;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Unknown error";
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

function isNotionObjectMissingError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code === "object_not_found") {
    return true;
  }
  return /could not find .* with id|object_not_found|not found/i.test(getErrorMessage(error));
}

function clearStaleNotionDatabaseIdsFromSyncError(
  syncStatePath: string,
  settingsPath: string,
  settings: AppSettings
): void {
  if (!fs.existsSync(syncStatePath)) {
    return;
  }
  const lastErrorRaw = JSON.parse(fs.readFileSync(syncStatePath, "utf8")) as { lastError?: unknown };
  const lastError = typeof lastErrorRaw.lastError === "string" ? lastErrorRaw.lastError : "";
  const match = /could not find database with id:\s*([a-f0-9-]+)/i.exec(lastError);
  if (!match?.[1]) {
    return;
  }
  const missingDatabaseId = match[1];
  if (
    settings.notion.libraryDatabaseId !== missingDatabaseId &&
    settings.notion.passagesDatabaseId !== missingDatabaseId
  ) {
    return;
  }
  settings.notion.libraryDatabaseId = undefined;
  settings.notion.passagesDatabaseId = undefined;
  saveSettings(settingsPath, settings);
}

function migrateLegacyNotionToken(settingsPath: string, settings: AppSettings, authStore: NotionAuthStore): void {
  if (!settings.notion.integrationToken) {
    return;
  }
  if (authStore.get()) {
    settings.notion.integrationToken = undefined;
    saveSettings(settingsPath, settings);
    return;
  }
  authStore.set({
    accessToken: settings.notion.integrationToken,
    obtainedAt: new Date().toISOString()
  });
  settings.notion.integrationToken = undefined;
  saveSettings(settingsPath, settings);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
