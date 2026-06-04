import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectionsScreen, type ConnectionState } from "./screens/ConnectionsScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { LibraryBookDetailScreen } from "./screens/LibraryBookDetailScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { LogsScreen } from "./screens/LogsScreen";
import { OnboardingScreen } from "./screens/OnboardingScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { GlobalSearchBar } from "./components/GlobalSearchBar";
import { IndexerStatusPill } from "./components/IndexerStatusPill";
import { SupportButton } from "./components/SupportButton";
import { SupportPromptModal } from "./components/SupportPromptModal";
import { UpdateBanner } from "./components/UpdateBanner";
import { IndexerStatusProvider } from "./state/IndexerStatusContext";
import { SearchPreferencesProvider } from "./state/SearchPreferencesContext";
import { shouldShowSupportPrompt } from "./support-prompt";
import appLogo from "./assets/logo.png";

const screens = ["Home", "Library", "Search", "Connections", "Logs", "Settings"] as const;
type Screen = (typeof screens)[number];

const screenIcons: Record<Screen, JSX.Element> = {
  Home: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 7L8 2.5L13.5 7v6a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V7z" />
      <path d="M6 14V9.5h4V14" />
    </svg>
  ),
  Connections: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 6.5l-3 3" />
      <path d="M6.5 9.5a2.5 2.5 0 1 1-2-2L6 6" />
      <path d="M9.5 6.5a2.5 2.5 0 1 1 2 2L10 10" />
    </svg>
  ),
  Library: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3h4.5a1.5 1.5 0 0 1 1.5 1.5v8.5a1 1 0 0 0-1-1H3z" />
      <path d="M13 3H8.5A1.5 1.5 0 0 0 7 4.5v8.5a1 1 0 0 1 1-1h5z" />
    </svg>
  ),
  Search: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3 3" />
    </svg>
  ),
  Logs: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4h10" />
      <path d="M3 8h10" />
      <path d="M3 12h7" />
    </svg>
  ),
  Settings: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2 M8 12.5v2 M1.5 8h2 M12.5 8h2 M3.05 3.05l1.42 1.42 M11.53 11.53l1.42 1.42 M3.05 12.95l1.42-1.42 M11.53 4.47l1.42-1.42" />
    </svg>
  ),
};
type ConnectionProvider = "notion" | "cloud_notebook" | "device_export";

type SyncState = {
  status: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
};

const formatLocalDateTime = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short"
  });
};

const isMissingConnectionsHandlerError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message.includes("No handler registered for 'archi:get-connections'") ||
    error.message.includes('No handler registered for "archi:get-connections"')
  );
};

type SyncProgressEvent = {
  runId: string;
  at: string;
  elapsedMs: number;
  phase:
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
  status: "running" | "success" | "failed" | "needs_auth" | "partial_success" | "info";
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

type LibraryWork = {
  id: string;
  title: string;
  creator?: string;
  ingestSource: "cloud-notebook" | "device-export";
  externalId?: string;
  storeIdentifier?: string;
  coverImageUrl?: string;
};

function WindowTitleBar(): JSX.Element {
  return (
    <div className="window-titlebar">
      <button
        type="button"
        className="window-close-button"
        aria-label="Close window"
        onClick={() => {
          void window.archi.closeWindow();
        }}
      />
    </div>
  );
}

const emptyConnections: Record<ConnectionProvider, ConnectionState> = {
  notion: {
    provider: "notion",
    label: "Notion",
    status: "configuring",
    canConnect: false,
    canReconnect: false,
    canDisconnect: false,
    hints: [],
    diagnostics: {
      summary: "Checking connection status..."
    }
  },
  cloud_notebook: {
    provider: "cloud_notebook",
    label: "Cloud notebook",
    status: "configuring",
    canConnect: false,
    canReconnect: false,
    canDisconnect: false,
    hints: [],
    diagnostics: {
      summary: "Checking connection status..."
    }
  },
  device_export: {
    provider: "device_export",
    label: "Device export file",
    status: "configuring",
    canConnect: false,
    canReconnect: false,
    canDisconnect: false,
    hints: [],
    diagnostics: {
      summary: "Checking connection status..."
    }
  }
};

const SIDEBAR_COLLAPSED_STORAGE_KEY = "archi.sidebarCollapsed";

function readInitialSidebarCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function App(): JSX.Element {
  const [activeScreen, setActiveScreen] = useState<Screen>("Home");
  const [searchInitialQuery, setSearchInitialQuery] = useState<string>("");
  const [searchScreenInstance, setSearchScreenInstance] = useState<number>(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(readInitialSidebarCollapsed);

  const toggleSidebar = useCallback((): void => {
    setSidebarCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // ignore — localStorage may be unavailable in some sandbox modes
      }
      return next;
    });
  }, []);
  const [syncState, setSyncState] = useState<SyncState>({
    status: "idle",
    lastRunAt: null,
    nextRunAt: null,
    lastError: null
  });
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [isCompletingOnboarding, setIsCompletingOnboarding] = useState(false);
  const [notionTokenDraft, setNotionTokenDraft] = useState("");
  const [connections, setConnections] = useState<Record<ConnectionProvider, ConnectionState>>(emptyConnections);
  const [works, setWorks] = useState<LibraryWork[]>([]);
  const [selectedLibraryWorkId, setSelectedLibraryWorkId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isCancelingSync, setIsCancelingSync] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgressEvent | null>(null);
  const [ipcError, setIpcError] = useState<string | null>(null);
  const [supportPromptOpen, setSupportPromptOpen] = useState<boolean>(false);
  const [recentActivity, setRecentActivity] = useState<{
    works: Array<{ id: string; title: string; creator?: string; coverImageUrl?: string; ingestedAt: string }>;
    passages: Array<{ id: string; body: string; workTitle: string; ingestedAt: string }>;
  }>({ works: [], passages: [] });
  const [syncRunStartedAtIso, setSyncRunStartedAtIso] = useState<string | null>(null);
  const activeSyncRunIdRef = useRef<string | null>(null);
  const listRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isListRefreshQueuedRef = useRef(false);
  const connectionsRetryCountRef = useRef(0);
  const connectionsRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshConnections = useCallback((): void => {
    void window.archi
      .getConnections()
      .then((next) => {
        connectionsRetryCountRef.current = 0;
        if (connectionsRetryTimerRef.current) {
          clearTimeout(connectionsRetryTimerRef.current);
          connectionsRetryTimerRef.current = null;
        }
        setConnections(next);
      })
      .catch((error) => {
        if (isMissingConnectionsHandlerError(error) && connectionsRetryCountRef.current < 10) {
          connectionsRetryCountRef.current += 1;
          if (connectionsRetryTimerRef.current) {
            clearTimeout(connectionsRetryTimerRef.current);
          }
          connectionsRetryTimerRef.current = setTimeout(() => {
            refreshConnections();
          }, 350);
          return;
        }
        const details = error instanceof Error ? error.message : "Unknown connection status error.";
        setConnections({
          notion: {
            provider: "notion",
            label: "Notion",
            status: "error",
            canConnect: true,
            canReconnect: true,
            canDisconnect: false,
            hints: ["Status loading failed. You can still save a token or run Test."],
            diagnostics: {
              summary: "Could not load Notion status.",
              details
            }
          },
          cloud_notebook: {
            provider: "cloud_notebook",
            label: "Cloud notebook",
            status: "error",
            canConnect: true,
            canReconnect: true,
            canDisconnect: false,
            hints: ["Status loading failed. Click Reconnect or Test to retry."],
            diagnostics: {
              summary: "Could not load cloud status.",
              details
            }
          },
          device_export: {
            provider: "device_export",
            label: "Device export file",
            status: "error",
            canConnect: false,
            canReconnect: false,
            canDisconnect: false,
            hints: ["Status loading failed. You can still choose an export file."],
            diagnostics: {
              summary: "Could not load device export status.",
              details
            }
          }
        });
      });
  }, []);

  const refreshLists = useCallback((): void => {
    void window.archi.listWorks().then(setWorks);
    void window.archi.listLogs().then(setLogs);
    void window.archi.listRecentActivity(8).then(setRecentActivity).catch(() => {});
  }, []);

  const requestListRefresh = useCallback((): void => {
    if (isListRefreshQueuedRef.current) {
      return;
    }
    isListRefreshQueuedRef.current = true;
    listRefreshTimerRef.current = setTimeout(() => {
      isListRefreshQueuedRef.current = false;
      refreshLists();
    }, 800);
  }, [refreshLists]);

  useEffect(() => {
    void window.archi
      .getSyncState()
      .then(setSyncState)
      .catch((error) => {
        setIpcError(
          `Could not read sync state from the main process (${error instanceof Error ? error.message : "unknown error"}). ` +
            "Restart the app or run `pnpm --filter @archi/desktop rebuild:native` if the issue persists."
        );
      });
    void window.archi
      .getSettings()
      .then((settings) => {
        setCloudEnabled(settings.cloudEnabled);
        setOnboardingCompleted(settings.onboardingCompleted);
        if (settings.onboardingCompleted) {
          refreshConnections();
          refreshLists();
        }
      })
      .catch((error) => {
        setIpcError(
          `Could not read settings from the main process (${error instanceof Error ? error.message : "unknown error"}). ` +
            "The desktop main process likely failed to boot — see the terminal for details."
        );
      })
      .finally(() => {
        setSettingsLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (activeScreen !== "Connections") {
      return;
    }
    if (!onboardingCompleted) {
      return;
    }
    refreshConnections();
    const interval = setInterval(() => {
      refreshConnections();
    }, 15_000);
    return () => {
      clearInterval(interval);
    };
  }, [activeScreen, onboardingCompleted, refreshConnections]);

  useEffect(() => {
    const handleSyncProgress = (event: SyncProgressEvent): void => {
      const activeRunId = activeSyncRunIdRef.current;
      if (event.phase === "sync_start" || activeRunId === null || activeRunId === event.runId) {
        activeSyncRunIdRef.current = event.runId;
      }
      if (activeSyncRunIdRef.current !== event.runId) {
        return;
      }
      setSyncProgress(event);

      if (event.phase === "sync_start") {
        setSyncRunStartedAtIso(event.at);
      }
      if (event.status === "running" && event.phase !== "sync_complete") {
        setIsSyncing(true);
      }
      if (event.phase === "sync_cancel_requested") {
        setIsCancelingSync(true);
      }
      if (event.refreshHint === "ingest_update") {
        requestListRefresh();
      }
      if (event.phase === "sync_complete" || event.phase === "sync_error" || event.refreshHint === "completed") {
        setIsSyncing(false);
        setIsCancelingSync(false);
        activeSyncRunIdRef.current = null;
        void window.archi.getSyncState().then(setSyncState);
        refreshLists();
        refreshConnections();
      }
    };

    window.archi.onSyncProgress(handleSyncProgress);
    return () => {
      window.archi.offSyncProgress(handleSyncProgress);
    };
  }, [refreshConnections, refreshLists, requestListRefresh]);

  useEffect(() => {
    let alreadyShown = false;
    let cancelled = false;

    void window.archi.preferences.get<boolean>("support.promptShown", false).then((shown) => {
      if (cancelled) return;
      alreadyShown = shown;
    });

    const listener = (event: Parameters<Parameters<typeof window.archi.onSyncProgress>[0]>[0]): void => {
      if (alreadyShown || cancelled) return;
      if (!shouldShowSupportPrompt(event, false)) return;
      alreadyShown = true;
      void window.archi.preferences.set("support.promptShown", true);
      setSupportPromptOpen(true);
    };

    window.archi.onSyncProgress(listener);

    return () => {
      cancelled = true;
      window.archi.offSyncProgress(listener);
    };
  }, []);

  const runSyncNow = (): void => {
    if (isSyncing) {
      return;
    }
    setIsSyncing(true);
    setIsCancelingSync(false);

    void window.archi
      .runSyncNow()
      .then((next) => {
        setSyncState(next);
        refreshLists();
        refreshConnections();
      })
      .catch((error) => {
        setIsSyncing(false);
        setIsCancelingSync(false);
        setIpcError(
          `Sync failed to start (${error instanceof Error ? error.message : "unknown error"}). ` +
            "If the main process is unhealthy, restart the dev server."
        );
      })
      .finally(() => {
        if (listRefreshTimerRef.current) {
          clearTimeout(listRefreshTimerRef.current);
          listRefreshTimerRef.current = null;
          isListRefreshQueuedRef.current = false;
        }
      });
  };

  const refreshNotionMedia = (): void => {
    if (isSyncing) {
      return;
    }
    const confirmed = window.confirm(
      "Re-write the page icon and cover image for every work in Notion. " +
        "This can take several minutes for large libraries and may overwrite any icons/covers you've customized. Continue?"
    );
    if (!confirmed) {
      return;
    }
    setIsSyncing(true);
    setIsCancelingSync(false);

    void window.archi
      .refreshNotionMedia()
      .then((next) => {
        setSyncState(next);
        refreshLists();
        refreshConnections();
      })
      .catch((error) => {
        setIsSyncing(false);
        setIsCancelingSync(false);
        setIpcError(
          `Refresh failed to start (${error instanceof Error ? error.message : "unknown error"}). ` +
            "If the main process is unhealthy, restart the dev server."
        );
      })
      .finally(() => {
        if (listRefreshTimerRef.current) {
          clearTimeout(listRefreshTimerRef.current);
          listRefreshTimerRef.current = null;
          isListRefreshQueuedRef.current = false;
        }
      });
  };

  const cancelSync = (): void => {
    if (!isSyncing || isCancelingSync) {
      return;
    }
    setIsCancelingSync(true);
    void window.archi
      .cancelSync()
      .then((result) => {
        if (!result.requested) {
          setIsCancelingSync(false);
        }
      })
      .catch(() => {
        setIsCancelingSync(false);
      });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setActiveScreen("Settings");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(
    () => () => {
      if (connectionsRetryTimerRef.current) {
        clearTimeout(connectionsRetryTimerRef.current);
        connectionsRetryTimerRef.current = null;
      }
      if (listRefreshTimerRef.current) {
        clearTimeout(listRefreshTimerRef.current);
        listRefreshTimerRef.current = null;
        isListRefreshQueuedRef.current = false;
      }
    },
    []
  );

  useEffect(() => {
    if (!selectedLibraryWorkId) {
      return;
    }
    if (!works.some((work) => work.id === selectedLibraryWorkId)) {
      setSelectedLibraryWorkId(null);
    }
  }, [selectedLibraryWorkId, works]);

  const openPassageFromSearch = useCallback((): void => {
    setSelectedLibraryWorkId(null);
    setActiveScreen("Search");
  }, []);

  const openSearchScreenWithQuery = useCallback((initialQuery: string): void => {
    setSearchInitialQuery(initialQuery);
    setSearchScreenInstance((prev) => prev + 1);
    setSelectedLibraryWorkId(null);
    setActiveScreen("Search");
  }, []);

  const updateConnection = (provider: ConnectionProvider, operation: Promise<ConnectionState>): void => {
    setConnections((current) => ({
      ...current,
      [provider]: {
        ...current[provider],
        status: "configuring",
        diagnostics: {
          summary: `Running ${provider.replace("_", " ")} action...`
        }
      }
    }));

    void operation
      .then((connection) => {
        setConnections((current) => ({
          ...current,
          [connection.provider]: connection
        }));
        void window.archi.getSyncState().then(setSyncState);
      })
      .catch((error) => {
        const details = error instanceof Error ? error.message : "Unknown connection error";
        setConnections((current) => ({
          ...current,
          [provider]: {
            ...current[provider],
            status: "error",
            diagnostics: {
              summary: "Connection action failed.",
              details
            }
          }
        }));
      });
  };

  const ensureCloudEnabled = (callback: () => void): void => {
    if (cloudEnabled) {
      callback();
      return;
    }
    void window.archi.setCloudEnabled(true).then((result) => {
      setCloudEnabled(result.cloudEnabled);
      callback();
    });
  };

  const screenContent = useMemo(() => {
    const formattedLastRunAt = formatLocalDateTime(syncState.lastRunAt);
    switch (activeScreen) {
      case "Home":
        return (
          <HomeScreen
            status={syncState.status}
            lastRunAt={formattedLastRunAt}
            onSyncNow={runSyncNow}
            onCancelSync={cancelSync}
            onNavigateToConnections={() => setActiveScreen("Connections")}
            isSyncing={isSyncing}
            isCancelingSync={isCancelingSync}
            syncProgress={syncProgress}
            recentWorks={recentActivity.works}
            recentPassages={recentActivity.passages}
            syncRunStartedAtIso={syncRunStartedAtIso}
          />
        );
      case "Connections":
        return (
          <ConnectionsScreen
            connections={connections}
            cloudEnabled={cloudEnabled}
            notionTokenDraft={notionTokenDraft}
            onNotionTokenDraftChange={setNotionTokenDraft}
            onSetNotionToken={() => {
              updateConnection("notion", window.archi.setNotionToken(notionTokenDraft));
            }}
            onConnect={(provider) => {
              if (provider === "cloud_notebook") {
                ensureCloudEnabled(() => updateConnection(provider, window.archi.connectConnection(provider)));
                return;
              }
              updateConnection(provider, window.archi.connectConnection(provider));
            }}
            onReconnect={(provider) => {
              if (provider === "cloud_notebook") {
                ensureCloudEnabled(() => updateConnection(provider, window.archi.reconnectConnection(provider)));
                return;
              }
              updateConnection(provider, window.archi.reconnectConnection(provider));
            }}
            onDisconnect={(provider) => updateConnection(provider, window.archi.disconnectConnection(provider))}
            onTest={(provider) => {
              if (provider === "cloud_notebook") {
                ensureCloudEnabled(() => updateConnection(provider, window.archi.testConnection(provider)));
                return;
              }
              updateConnection(provider, window.archi.testConnection(provider));
            }}
            onChooseDeviceExportPath={() => {
              void window.archi.chooseDeviceExportPath().then(() => {
                refreshConnections();
              });
            }}
            onSetCloudEnabled={(enabled) => {
              const previous = cloudEnabled;
              setCloudEnabled(enabled);
              void window.archi
                .setCloudEnabled(enabled)
                .then((result) => {
                  setCloudEnabled(result.cloudEnabled);
                  refreshConnections();
                })
                .catch(() => {
                  setCloudEnabled(previous);
                  refreshConnections();
                });
            }}
            onRefreshNotionMedia={refreshNotionMedia}
            isSyncing={isSyncing}
          />
        );
      case "Library":
        if (selectedLibraryWorkId) {
          const selectedWork = works.find((work) => work.id === selectedLibraryWorkId);
          if (selectedWork) {
            return <LibraryBookDetailScreen work={selectedWork} onOpenSearchScreen={openSearchScreenWithQuery} />;
          }
        }
        return (
          <LibraryScreen
            works={works}
            selectedWorkId={selectedLibraryWorkId ?? undefined}
            onSelectWork={(workId) => setSelectedLibraryWorkId(workId)}
          />
        );
      case "Search":
        return (
          <SearchScreen
            key={`search-${searchScreenInstance}`}
            initialQuery={searchInitialQuery}
            onOpenPassage={openPassageFromSearch}
            onOpenWork={(workId) => {
              setSelectedLibraryWorkId(workId);
              setActiveScreen("Library");
            }}
            onFindSimilar={openSearchScreenWithQuery}
          />
        );
      case "Logs":
        return <LogsScreen entries={logs} />;
      case "Settings":
        return <SettingsScreen />;
      default:
        return <p>Unknown screen.</p>;
    }
  }, [
    activeScreen,
    cancelSync,
    cloudEnabled,
    connections,
    isCancelingSync,
    isSyncing,
    logs,
    openPassageFromSearch,
    openSearchScreenWithQuery,
    recentActivity,
    searchInitialQuery,
    searchScreenInstance,
    syncRunStartedAtIso,
    selectedLibraryWorkId,
    refreshNotionMedia,
    runSyncNow,
    syncProgress,
    syncState.lastRunAt,
    syncState.status,
    works
  ]);
  const selectedWork =
    activeScreen === "Library" && selectedLibraryWorkId
      ? works.find((work) => work.id === selectedLibraryWorkId)
      : undefined;

  if (!settingsLoaded) {
    return (
      <main className="onboarding-layout">
        <WindowTitleBar />
        <section className="screen-card onboarding-card">
          <p className="content-eyebrow">Preparing</p>
          <h1>Loading workspace...</h1>
        </section>
      </main>
    );
  }

  if (!onboardingCompleted) {
    return (
      <main className="onboarding-layout">
        <WindowTitleBar />
        <section className="screen-card onboarding-card">
          {ipcError ? <p className="error banner-error">{ipcError}</p> : null}
          <OnboardingScreen
            isCompleting={isCompletingOnboarding}
            onContinue={() => {
              if (isCompletingOnboarding) {
                return;
              }
              setIpcError(null);
              setIsCompletingOnboarding(true);
              void window.archi
                .completeOnboarding()
                .then((result) => {
                  setOnboardingCompleted(result.onboardingCompleted);
                  setActiveScreen("Connections");
                  refreshConnections();
                  refreshLists();
                  void window.archi.getSyncState().then(setSyncState);
                })
                .catch((error) => {
                  setIpcError(
                    `Could not complete onboarding (${error instanceof Error ? error.message : "unknown error"}). ` +
                      "The main process may not be running correctly — check the terminal output."
                  );
                })
                .finally(() => {
                  setIsCompletingOnboarding(false);
                });
            }}
          />
        </section>
      </main>
    );
  }

  return (
    <IndexerStatusProvider>
      <SearchPreferencesProvider>
      <UpdateBanner />
      <main className={`layout${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <WindowTitleBar />
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={appLogo} alt="" aria-hidden="true" className="sidebar-logo" />
          <h1>Archi</h1>
        </div>
        <nav className="sidebar-nav" aria-label="Primary">
          {screens.map((screen) => (
            <button
              key={screen}
              className={activeScreen === screen ? "active" : ""}
              title={sidebarCollapsed ? screen : undefined}
              onClick={() => {
                setActiveScreen(screen);
                if (screen !== "Library") {
                  setSelectedLibraryWorkId(null);
                }
              }}
            >
              <span className="sidebar-nav-icon">{screenIcons[screen]}</span>
              <span className="sidebar-nav-label">{screen}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" aria-hidden="true" />
        <IndexerStatusPill collapsed={sidebarCollapsed} />
        <SupportButton collapsed={sidebarCollapsed} />
        <button
          type="button"
          className="sidebar-collapse-toggle"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={sidebarCollapsed}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={sidebarCollapsed ? "M6 4l4 4-4 4" : "M10 4l-4 4 4 4"} />
          </svg>
        </button>
      </aside>
      <section className="content" data-screen={activeScreen}>
        <header className="content-header">
          <div>
            {selectedWork ? (
              <button
                type="button"
                className="content-eyebrow content-eyebrow-link"
                onClick={() => setSelectedLibraryWorkId(null)}
              >
                <span aria-hidden="true">‹</span> Library
              </button>
            ) : (
              <p className="content-eyebrow">Workspace</p>
            )}
            <h1>{selectedWork ? selectedWork.title : activeScreen}</h1>
            {selectedWork ? <p className="content-subtitle">{selectedWork.creator || "Unknown author"}</p> : null}
          </div>
          <GlobalSearchBar
            onEscalate={(query, passageId) => {
              openSearchScreenWithQuery(query);
              // passageId wiring lands in Task 14
            }}
          />
        </header>
        {ipcError ? <p className="error banner-error">{ipcError}</p> : null}
        {syncState.lastError ? <p className="error banner-error">Last error: {syncState.lastError}</p> : null}
        <div className="screen-card">{screenContent}</div>
      </section>
    </main>
    <SupportPromptModal open={supportPromptOpen} onClose={() => setSupportPromptOpen(false)} />
      </SearchPreferencesProvider>
    </IndexerStatusProvider>
  );
}
