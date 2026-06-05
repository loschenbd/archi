# Homepage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe Home as a reading dashboard, consolidate Connections + Logs into a tabbed Settings screen, and replace the inline sync-live header with a Home-only top banner.

**Architecture:** Decompose the existing 570-line `HomeScreen.tsx` into a thin layout shell + six colocated child components under `screens/home/`. Add a new tabbed `SettingsScreen` that re-hosts existing `ConnectionsScreen` and `LogsScreen` bodies. Sidebar collapses from five top-level items to four (Home / Library / Passages / Settings). No new IPC, no new persisted state.

**Tech Stack:** React 18 + TypeScript, Vite-bundled Electron renderer, `@tanstack/react-virtual` for the existing search-results virtualization. No test framework for the renderer — verification is `pnpm --filter @archi/desktop typecheck` + manual run via `pnpm --filter @archi/desktop dev`.

**Spec:** `docs/superpowers/specs/2026-06-04-homepage-redesign-design.md`

---

## File structure

**Create:**
- `apps/desktop/src/renderer/screens/SettingsScreen.tsx` — tabbed Connections + Logs host
- `apps/desktop/src/renderer/screens/home/utils.ts` — shared text helpers
- `apps/desktop/src/renderer/screens/home/SyncBanner.tsx` — top banner, six states
- `apps/desktop/src/renderer/screens/home/StatsStrip.tsx` — counts + resting sync state
- `apps/desktop/src/renderer/screens/home/BooksRail.tsx` — horizontal recent-books rail
- `apps/desktop/src/renderer/screens/home/RandomHighlight.tsx` — hero random passage card
- `apps/desktop/src/renderer/screens/home/LatestHighlights.tsx` — latest passages list
- `apps/desktop/src/renderer/screens/home/HomeSearchResults.tsx` — extracted search results panel

**Modify:**
- `apps/desktop/src/renderer/App.tsx` — screens tuple, gear icon, route table, sidebar warning dot, `onNavigateToSettings` prop, bump `listRecentActivity(8 → 12)`
- `apps/desktop/src/renderer/screens/HomeScreen.tsx` — rewritten as composition shell
- `apps/desktop/src/renderer/styles.css` — add new module styles, delete obsolete styles
- `apps/desktop/src/renderer/screens/ConnectionsScreen.tsx` — no logic change (consume as-is from a tab panel)
- `apps/desktop/src/renderer/screens/LogsScreen.tsx` — no logic change

---

## Verification gates (used in every task)

- **Typecheck:** `pnpm --filter @archi/desktop typecheck` — must pass cleanly. The repo's typecheck baseline is clean (no pre-existing errors in the renderer).
- **Lint:** `pnpm --filter @archi/desktop lint` — must pass.
- **Manual sanity (after the final task only):** `pnpm --filter @archi/desktop dev`, then walk the golden path: Home loads → sidebar shows 4 items → click Settings → tabs switch → Sync now triggers banner → completes → modules update.

---

### Task 1: Extract shared text helpers into `home/utils.ts`

**Files:**
- Create: `apps/desktop/src/renderer/screens/home/utils.ts`

These helpers exist inside `HomeScreen.tsx` today (`highlightMatch`, `excerptAroundMatch`, `excerptOf`, `formatRelative`, `formatElapsed`). Pull them into a shared module so the new child components can import them without bringing in the whole HomeScreen file. This task does not change behavior — `HomeScreen.tsx` continues to use its local copies for now and gets cleaned up in Task 8.

- [ ] **Step 1.1: Create the utils file**

Write `apps/desktop/src/renderer/screens/home/utils.ts`:

```ts
import { Fragment, type ReactNode } from "react";

export function highlightMatch(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={i}>{part}</mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}

export function excerptAroundMatch(body: string, query: string, max = 180): string {
  const clean = body.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const idx = query ? clean.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (idx < 0) {
    return `${clean.slice(0, max - 1).trimEnd()}…`;
  }
  const half = Math.floor(max / 2);
  const start = Math.max(0, idx - half);
  const end = Math.min(clean.length, start + max);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < clean.length ? "…" : "";
  return `${prefix}${clean.slice(start, end).trim()}${suffix}`;
}

export function excerptOf(body: string, max: number): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function formatRelative(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    return "";
  }
  const diff = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${String(remaining).padStart(2, "0")}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${String(remMinutes).padStart(2, "0")}m`;
}
```

The file needs the `.tsx` extension only if it contains JSX. `highlightMatch` returns JSX, so rename the file from `.ts` to `.tsx` if your linter complains — but the existing repo allows JSX in `.ts` files via `tsconfig.json`'s `jsx: "react-jsx"` setting. If typecheck fails, rename to `utils.tsx` and update Task 3+ imports.

- [ ] **Step 1.2: Typecheck**

Run: `pnpm --filter @archi/desktop typecheck`
Expected: passes.

If it fails on `utils.ts` because of JSX, rename to `utils.tsx`:

```bash
mv apps/desktop/src/renderer/screens/home/utils.ts apps/desktop/src/renderer/screens/home/utils.tsx
```

Then re-run typecheck.

- [ ] **Step 1.3: Lint**

Run: `pnpm --filter @archi/desktop lint`
Expected: passes.

- [ ] **Step 1.4: Commit**

```bash
git add apps/desktop/src/renderer/screens/home/
git commit -m "desktop(home): extract text helpers into screens/home/utils"
```

---

### Task 2: Create `SettingsScreen` and swap sidebar to 4 items

**Files:**
- Create: `apps/desktop/src/renderer/screens/SettingsScreen.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`

After this task: sidebar has Home / Library / Passages / Settings. Settings shows a Connections | Logs tab strip with the existing bodies underneath. The `HomeScreen` continues to render its current sync-live header + activity feed (no change to Home yet).

- [ ] **Step 2.1: Create `SettingsScreen.tsx`**

Write `apps/desktop/src/renderer/screens/SettingsScreen.tsx`:

```tsx
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
```

- [ ] **Step 2.2: Update `App.tsx` `screens` tuple and icons**

In `apps/desktop/src/renderer/App.tsx`, replace the `screens` tuple at the top of the file:

Find:
```ts
const screens = ["Home", "Connections", "Library", "Passages", "Logs"] as const;
type Screen = (typeof screens)[number];
```

Replace with:
```ts
const screens = ["Home", "Library", "Passages", "Settings"] as const;
type Screen = (typeof screens)[number];
```

Then replace the `screenIcons` record. Find the existing block (lines starting `const screenIcons: Record<Screen, JSX.Element>` through its closing brace) and replace it with:

```tsx
const screenIcons: Record<Screen, JSX.Element> = {
  Home: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 7L8 2.5L13.5 7v6a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V7z" />
      <path d="M6 14V9.5h4V14" />
    </svg>
  ),
  Library: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3h4.5a1.5 1.5 0 0 1 1.5 1.5v8.5a1 1 0 0 0-1-1H3z" />
      <path d="M13 3H8.5A1.5 1.5 0 0 0 7 4.5v8.5a1 1 0 0 1 1-1h5z" />
    </svg>
  ),
  Passages: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6c0-1.4 1-2.5 2.5-2.5" />
      <path d="M3 6v2c0 1 .8 2 2 2" />
      <path d="M3 6h2.8v4H3z" />
      <path d="M8.5 6c0-1.4 1-2.5 2.5-2.5" />
      <path d="M8.5 6v2c0 1 .8 2 2 2" />
      <path d="M8.5 6h2.8v4H8.5z" />
    </svg>
  ),
  Settings: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </svg>
  )
};
```

- [ ] **Step 2.3: Add `SettingsScreen` import and route case to `App.tsx`**

At the top of `App.tsx` (with the other screen imports), add:

```tsx
import { SettingsScreen, type SettingsTab } from "./screens/SettingsScreen";
```

Find the `useState` declarations block (right after `const [activeScreen, setActiveScreen] = useState<Screen>("Home");`) and add a new state:

```tsx
const [settingsDefaultTab, setSettingsDefaultTab] = useState<SettingsTab>("connections");
```

In the `screenContent` `useMemo` switch statement, **delete** the `case "Connections":` and `case "Logs":` blocks entirely. Then **add** a `case "Settings":` block before the `default:`:

```tsx
case "Settings":
  return (
    <SettingsScreen
      defaultTab={settingsDefaultTab}
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
      logs={logs}
    />
  );
```

Add `settingsDefaultTab` to the `useMemo` dependency array (alongside `connections`, `logs`, etc.). The existing items in that array stay.

- [ ] **Step 2.4: Update the connections-refresh effect to fire on Settings**

Find the `useEffect` near the top of `App` that depends on `activeScreen === "Connections"`. Replace its body's screen check:

Find:
```tsx
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
```

Replace with:
```tsx
useEffect(() => {
  if (activeScreen !== "Settings") {
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
```

- [ ] **Step 2.5: Handle the post-onboarding redirect**

Find the onboarding completion handler in the onboarding render branch (where `setActiveScreen("Connections")` is called after `completeOnboarding()` succeeds):

Find:
```tsx
.then((result) => {
  setOnboardingCompleted(result.onboardingCompleted);
  setActiveScreen("Connections");
  refreshConnections();
  refreshLists();
  void window.archi.getSyncState().then(setSyncState);
})
```

Replace with:
```tsx
.then((result) => {
  setOnboardingCompleted(result.onboardingCompleted);
  setSettingsDefaultTab("connections");
  setActiveScreen("Settings");
  refreshConnections();
  refreshLists();
  void window.archi.getSyncState().then(setSyncState);
})
```

- [ ] **Step 2.6: Update the `HomeScreen`'s `onNavigateToConnections` callback**

In the `screenContent` switch's `case "Home":`, find:
```tsx
onNavigateToConnections={() => setActiveScreen("Connections")}
```

Replace with:
```tsx
onNavigateToConnections={() => {
  setSettingsDefaultTab("connections");
  setActiveScreen("Settings");
}}
```

This keeps the existing `HomeScreen` prop name (`onNavigateToConnections`) untouched for now — the prop rename happens in Task 8 when `HomeScreen` is rewritten.

- [ ] **Step 2.7: Add minimal styles for the settings tab strip**

In `apps/desktop/src/renderer/styles.css`, append at the end of the file:

```css
.settings-screen {
  display: grid;
  gap: 18px;
}

.settings-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  background: color-mix(in srgb, var(--ink-300) 12%, transparent);
  border-radius: 999px;
  width: max-content;
}

.settings-tab-button {
  border: none;
  background: transparent;
  padding: 6px 16px;
  border-radius: 999px;
  font: inherit;
  font-size: 13px;
  color: var(--ink-700);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.settings-tab-button:hover:not(.settings-tab-button-active) {
  color: var(--accent-strong);
}

.settings-tab-button-active {
  background: var(--surface);
  color: var(--accent-strong);
  box-shadow: 0 2px 6px rgba(72, 53, 41, 0.06);
}

.settings-tab-panel {
  display: block;
}
```

- [ ] **Step 2.8: Typecheck**

Run: `pnpm --filter @archi/desktop typecheck`
Expected: passes.

The screens tuple no longer contains `"Connections"` or `"Logs"`, so any remaining references to those as a screen name will fail typecheck. If the typecheck reports unused vars in `screenContent`'s deps array (e.g. items only the old cases used), remove them too.

- [ ] **Step 2.9: Lint**

Run: `pnpm --filter @archi/desktop lint`
Expected: passes.

- [ ] **Step 2.10: Commit**

```bash
git add apps/desktop/src/renderer/screens/SettingsScreen.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css
git commit -m "desktop: consolidate Connections + Logs into a tabbed Settings screen"
```

---

### Task 3: Add `SyncBanner` component with all six states

**Files:**
- Create: `apps/desktop/src/renderer/screens/home/SyncBanner.tsx`
- Modify: `apps/desktop/src/renderer/screens/HomeScreen.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

Replace the existing `sync-live-header` block at the top of `HomeScreen` with the new banner. The banner handles all six states. The activity feed below stays untouched in this task (it's removed when Tasks 5–6 land the books rail + highlights).

- [ ] **Step 3.1: Create `SyncBanner.tsx`**

Write `apps/desktop/src/renderer/screens/home/SyncBanner.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { formatElapsed } from "./utils";

type ConnectionStatus = "connected" | "needs_action" | "error" | "disconnected" | "configuring";
type ConnectionProvider = "notion" | "cloud_notebook" | "device_export";

export type SyncBannerConnection = {
  provider: ConnectionProvider;
  label: string;
  status: ConnectionStatus;
};

export type SyncBannerProgress = {
  message: string;
  phase: string;
  status: "running" | "success" | "failed" | "needs_auth" | "partial_success" | "info";
  source?: "device-export" | "cloud-notebook" | "notion";
  elapsedMs: number;
  counts?: {
    processed?: number;
    total?: number;
    works?: number;
    passages?: number;
  };
} | null;

type Props = {
  isSyncing: boolean;
  isCancelingSync: boolean;
  syncProgress: SyncBannerProgress;
  connections: SyncBannerConnection[];
  lastError: string | null;
  noHealthySources: boolean;
  onCancelSync: () => void;
  onRetrySync: () => void;
  onNavigateToSettings: (tab: "connections" | "logs") => void;
};

const PHASE_LABELS: Record<string, string> = {
  sync_start: "Starting sync",
  sync_cancel_requested: "Cancelling",
  source_device_read: "Reading device export",
  source_device_upsert_works: "Saving works from device export",
  source_device_upsert_passages: "Saving passages from device export",
  source_cloud_fetch: "Fetching cloud highlights",
  source_cloud_upsert: "Saving cloud highlights",
  destination_notion_works: "Syncing works to Notion",
  destination_notion_passages: "Syncing passages to Notion",
  sync_complete: "Sync complete",
  sync_error: "Sync error"
};

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function SyncBanner(props: Props): JSX.Element | null {
  const {
    isSyncing,
    isCancelingSync,
    syncProgress,
    connections,
    lastError,
    noHealthySources,
    onCancelSync,
    onRetrySync,
    onNavigateToSettings
  } = props;

  const [progressBaseAtMs, setProgressBaseAtMs] = useState<number>(Date.now());
  const [tickAtMs, setTickAtMs] = useState<number>(Date.now());

  useEffect(() => {
    if (!syncProgress) return;
    setProgressBaseAtMs(Date.now());
    setTickAtMs(Date.now());
  }, [syncProgress]);

  useEffect(() => {
    const activeIntervalMs = isSyncing && syncProgress?.status === "running" ? 1000 : 15000;
    const interval = setInterval(() => setTickAtMs(Date.now()), activeIntervalMs);
    return () => clearInterval(interval);
  }, [isSyncing, syncProgress]);

  const displayedElapsedMs = useMemo(() => {
    if (!syncProgress) return 0;
    if (isSyncing && syncProgress.status === "running") {
      return syncProgress.elapsedMs + Math.max(0, tickAtMs - progressBaseAtMs);
    }
    return syncProgress.elapsedMs;
  }, [isSyncing, progressBaseAtMs, syncProgress, tickAtMs]);
  const elapsedSeconds = Math.max(0, Math.floor(displayedElapsedMs / 1000));
  const elapsedDisplay = formatElapsed(elapsedSeconds);

  const processed = syncProgress?.counts?.processed;
  const total = syncProgress?.counts?.total;
  const hasDeterminate = typeof processed === "number" && typeof total === "number" && total > 0;
  const pctComplete = hasDeterminate ? Math.min(100, Math.round((processed! / total!) * 100)) : null;

  const phaseLabel = syncProgress ? PHASE_LABELS[syncProgress.phase] ?? syncProgress.phase : null;
  const needsAuthConnection = connections.find((c) => c.status === "needs_action");

  // Priority: Running > Cancelling > NoHealthySources > NeedsAuth > Failed > Hidden
  if (isCancelingSync) {
    return (
      <div className="sync-banner sync-banner-cancelling" role="status" aria-live="polite">
        <div className="sync-banner-row">
          <span className="sync-banner-message">
            <span className="sync-banner-dot" aria-hidden="true" /> Cancelling sync…
          </span>
          <span className="sync-banner-action sync-banner-action-pending" aria-hidden="true">
            <span className="sync-banner-spinner" />
          </span>
        </div>
      </div>
    );
  }

  if (isSyncing) {
    return (
      <div className="sync-banner sync-banner-running" role="status" aria-live="polite">
        <div className="sync-banner-row">
          <span className="sync-banner-message">
            <span className="sync-banner-dot" aria-hidden="true" />
            Syncing your library{phaseLabel ? ` · ${phaseLabel}` : ""} · <span className="tabular">{elapsedDisplay}</span>
          </span>
          <span className="sync-banner-action">
            {hasDeterminate ? (
              <span className="tabular sync-banner-counts">
                {processed}/{total}
              </span>
            ) : null}
            <button
              type="button"
              className="sync-banner-action-button"
              onClick={onCancelSync}
              disabled={isCancelingSync}
            >
              Cancel
            </button>
          </span>
        </div>
        <div
          className={`sync-banner-progress ${hasDeterminate ? "sync-banner-progress-determinate" : "sync-banner-progress-indeterminate"}`}
          role="progressbar"
          aria-valuemin={hasDeterminate ? 0 : undefined}
          aria-valuemax={hasDeterminate ? 100 : undefined}
          aria-valuenow={hasDeterminate ? pctComplete ?? undefined : undefined}
        >
          {hasDeterminate ? (
            <span className="sync-banner-progress-fill" style={{ width: `${pctComplete}%` }} />
          ) : (
            <span className="sync-banner-progress-indeterminate-fill" aria-hidden="true" />
          )}
        </div>
      </div>
    );
  }

  if (noHealthySources) {
    return (
      <div className="sync-banner sync-banner-warning" role="status">
        <div className="sync-banner-row">
          <span className="sync-banner-message">
            No connected sources — set one up to start syncing
          </span>
          <button
            type="button"
            className="sync-banner-action-button"
            onClick={() => onNavigateToSettings("connections")}
          >
            Open Settings → Connections
          </button>
        </div>
      </div>
    );
  }

  if (needsAuthConnection) {
    return (
      <div className="sync-banner sync-banner-warning" role="status">
        <div className="sync-banner-row">
          <span className="sync-banner-message">
            ⚠ {needsAuthConnection.label} needs reconnect
          </span>
          <button
            type="button"
            className="sync-banner-action-button"
            onClick={() => onNavigateToSettings("connections")}
          >
            Fix → Settings · Connections
          </button>
        </div>
      </div>
    );
  }

  if (lastError) {
    return (
      <div className="sync-banner sync-banner-error" role="status">
        <div className="sync-banner-row">
          <span className="sync-banner-message">
            Last sync failed: {truncate(lastError, 80)}
          </span>
          <span className="sync-banner-action">
            <button type="button" className="sync-banner-action-button" onClick={onRetrySync}>
              Try again
            </button>
            <button
              type="button"
              className="sync-banner-action-button"
              onClick={() => onNavigateToSettings("logs")}
            >
              Details → Settings · Logs
            </button>
          </span>
        </div>
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 3.2: Add banner styles to `styles.css`**

Append to `apps/desktop/src/renderer/styles.css`:

```css
.sync-banner {
  border-radius: 10px;
  padding: 8px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  position: relative;
  overflow: hidden;
}

.sync-banner-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.sync-banner-message {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}

.sync-banner-action {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.sync-banner-counts {
  font-size: 12px;
  color: inherit;
  opacity: 0.85;
}

.sync-banner-action-button {
  background: transparent;
  border: 1px solid color-mix(in srgb, currentColor 28%, transparent);
  color: inherit;
  padding: 3px 10px;
  border-radius: 999px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.sync-banner-action-button:hover:not(:disabled) {
  background: color-mix(in srgb, currentColor 12%, transparent);
}

.sync-banner-action-button:disabled {
  opacity: 0.6;
  cursor: default;
}

.sync-banner-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: currentColor;
  animation: sync-banner-pulse 1.4s ease-in-out infinite;
}

@keyframes sync-banner-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.sync-banner-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 1.5px solid color-mix(in srgb, currentColor 30%, transparent);
  border-top-color: currentColor;
  animation: sync-banner-spin 0.7s linear infinite;
}

@keyframes sync-banner-spin {
  to { transform: rotate(360deg); }
}

.sync-banner-running {
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  color: var(--accent-strong);
}

.sync-banner-cancelling {
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  color: color-mix(in srgb, var(--accent-strong) 80%, var(--ink-700));
}

.sync-banner-warning {
  background: color-mix(in srgb, #c98a2a 18%, var(--surface));
  color: #7a5410;
}

.sync-banner-error {
  background: color-mix(in srgb, #b04434 16%, var(--surface));
  color: #872a1c;
}

.sync-banner-progress {
  position: relative;
  height: 3px;
  background: color-mix(in srgb, currentColor 15%, transparent);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 4px;
}

.sync-banner-progress-fill {
  display: block;
  height: 100%;
  background: currentColor;
  transition: width 280ms ease;
}

.sync-banner-progress-indeterminate-fill {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, currentColor, transparent);
  animation: sync-banner-indeterminate 1.4s ease-in-out infinite;
  width: 40%;
}

@keyframes sync-banner-indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}
```

- [ ] **Step 3.3: Wire `SyncBanner` into `HomeScreen.tsx`**

In `apps/desktop/src/renderer/screens/HomeScreen.tsx`:

Add an import near the existing imports:
```tsx
import { SyncBanner, type SyncBannerConnection } from "./home/SyncBanner";
```

Extend the `Props` type to accept the new banner inputs. Find the existing `Props = {` block and add these fields:
```tsx
connections: SyncBannerConnection[];
lastError: string | null;
noHealthySources: boolean;
```

In the destructuring at the top of `HomeScreen`, add `connections`, `lastError`, `noHealthySources` to the destructured props.

Find the `return (` of `HomeScreen` and replace the entire existing top `{isSyncing && syncProgress ? (` block — the whole `<div className="sync-live ...">...</div>` JSX — with:

```tsx
<SyncBanner
  isSyncing={isSyncing}
  isCancelingSync={isCancelingSync}
  syncProgress={syncProgress}
  connections={connections}
  lastError={lastError}
  noHealthySources={noHealthySources}
  onCancelSync={onCancelSync}
  onRetrySync={onSyncNow}
  onNavigateToSettings={onNavigateToSettings}
/>
```

Rename the existing prop in `HomeScreen`'s `Props` from `onNavigateToConnections: () => void` to `onNavigateToSettings: (tab: "connections" | "logs") => void`. Update the destructuring to match. There is one other reference to `onNavigateToConnections` in `HomeScreen.tsx` — the "Needs authentication · Reconnect →" inline button inside the `home-search-inline-action` block. Replace its call site:

Find:
```tsx
onClick={onNavigateToConnections}
```

Replace with:
```tsx
onClick={() => onNavigateToSettings("connections")}
```

Note: the old `sync-live` JSX referenced lots of local variables (`liveModeClass`, `phaseLabel`, `displayedElapsedMs`, etc.) that are now redundant. **Leave them in place for now** — they'll be cleaned up in Task 8 when `HomeScreen` is restructured. Typecheck will warn about unused vars but the existing `// useDeferredValue` block and other vars still flow through. If the lint config errors on unused vars, prefix them with `_` temporarily, OR cleanly delete the redundant `useEffect` + memo blocks now (they're: the two `useEffect`s that maintain `progressBaseAtMs` + `tickAtMs`, the `displayedElapsedMs` memo, `elapsedSeconds`, `elapsedDisplay`, `processed`, `total`, `hasDeterminate`, `pctComplete`, `booksCount`, `quotesCount`, `phaseLabel`, `sourceLabel`, `liveModeClass`). Pick whichever keeps the diff cleanest for this commit.

Recommended: leave the now-unused state/memo blocks for Task 8 to delete. They don't affect runtime correctness.

- [ ] **Step 3.4: Update `App.tsx` to pass the new HomeScreen props and rename the nav callback**

In `App.tsx`'s `case "Home":`, add the three new props inside the `<HomeScreen` element:

```tsx
connections={Object.values(connections).map((c) => ({
  provider: c.provider,
  label: c.label,
  status: c.status
}))}
lastError={syncState.lastError}
noHealthySources={Object.values(connections).every(
  (c) => c.status !== "connected"
)}
```

Replace the existing `onNavigateToConnections={...}` prop with the renamed tab-aware callback:

Find:
```tsx
onNavigateToConnections={() => {
  setSettingsDefaultTab("connections");
  setActiveScreen("Settings");
}}
```

Replace with:
```tsx
onNavigateToSettings={(tab: SettingsTab) => {
  setSettingsDefaultTab(tab);
  setActiveScreen("Settings");
}}
```

Add `syncState.lastError` to the `useMemo` dependency array if it isn't already covered by an existing entry. Add `connections` to the array (it's likely already there).

- [ ] **Step 3.5: Typecheck**

Run: `pnpm --filter @archi/desktop typecheck`
Expected: passes.

- [ ] **Step 3.6: Lint**

Run: `pnpm --filter @archi/desktop lint`
Expected: passes. Unused-var warnings on the leftover sync-live locals (see Step 3.3 note) are acceptable for now; if your `.eslintrc` treats them as errors, prefix names with `_`.

- [ ] **Step 3.7: Commit**

```bash
git add apps/desktop/src/renderer/screens/home/SyncBanner.tsx apps/desktop/src/renderer/screens/HomeScreen.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css
git commit -m "desktop(home): introduce SyncBanner with running/cancelling/warning/error states"
```

---

### Task 4: Add `StatsStrip` component

**Files:**
- Create: `apps/desktop/src/renderer/screens/home/StatsStrip.tsx`
- Modify: `apps/desktop/src/renderer/screens/HomeScreen.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

Insert the stats strip below the banner, above the existing activity feed. Pass it `works.length` + `passages.length` + `lastRunAt` from App.

- [ ] **Step 4.1: Create `StatsStrip.tsx`**

Write `apps/desktop/src/renderer/screens/home/StatsStrip.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { formatRelative } from "./utils";

type Props = {
  bookCount: number;
  highlightCount: number;
  lastRunAtIso: string | null;
  lastRunDeltaWorks: number;
  lastRunDeltaPassages: number;
  isSyncing: boolean;
  hasUnhealthyBanner: boolean;
  onSyncNow: () => void;
};

const NEW_CHIP_DURATION_MS = 10_000;

export function StatsStrip(props: Props): JSX.Element {
  const {
    bookCount,
    highlightCount,
    lastRunAtIso,
    lastRunDeltaWorks,
    lastRunDeltaPassages,
    isSyncing,
    hasUnhealthyBanner,
    onSyncNow
  } = props;

  const [tickAtMs, setTickAtMs] = useState<number>(Date.now());
  const [showNewChip, setShowNewChip] = useState<boolean>(false);
  const lastSeenRunAtRef = useRef<string | null>(lastRunAtIso);

  useEffect(() => {
    const interval = setInterval(() => setTickAtMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (lastRunAtIso && lastRunAtIso !== lastSeenRunAtRef.current) {
      lastSeenRunAtRef.current = lastRunAtIso;
      if (lastRunDeltaWorks > 0 || lastRunDeltaPassages > 0) {
        setShowNewChip(true);
        const timer = setTimeout(() => setShowNewChip(false), NEW_CHIP_DURATION_MS);
        return () => clearTimeout(timer);
      }
    }
    return undefined;
  }, [lastRunAtIso, lastRunDeltaWorks, lastRunDeltaPassages]);

  const relativeLastRun = lastRunAtIso ? formatRelative(lastRunAtIso, tickAtMs) : null;

  return (
    <div className="stats-strip">
      <div className="stats-strip-counts">
        <span className="stats-strip-number tabular">{bookCount.toLocaleString()}</span>
        <span className="stats-strip-label">books</span>
        <span className="stats-strip-dot" aria-hidden="true">·</span>
        <span className="stats-strip-number tabular">{highlightCount.toLocaleString()}</span>
        <span className="stats-strip-label">highlights</span>
      </div>

      <div className="stats-strip-meta">
        {isSyncing ? (
          <span className="stats-strip-meta-text">Syncing now…</span>
        ) : hasUnhealthyBanner ? null : showNewChip ? (
          <span className="stats-strip-new-chip">
            +{lastRunDeltaWorks} new books · +{lastRunDeltaPassages} new highlights
          </span>
        ) : (
          <>
            {relativeLastRun ? (
              <span className="stats-strip-meta-text">synced {relativeLastRun}</span>
            ) : (
              <span className="stats-strip-meta-text">never synced</span>
            )}
            <span aria-hidden="true">·</span>
            <button
              type="button"
              className="stats-strip-sync-button"
              onClick={onSyncNow}
              disabled={isSyncing}
            >
              Sync now
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4.2: Add styles**

Append to `styles.css`:

```css
.stats-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
  background: var(--surface);
  border: 1px solid color-mix(in srgb, var(--ink-300) 18%, transparent);
  border-radius: 12px;
}

.stats-strip-counts {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  color: var(--ink-700);
}

.stats-strip-number {
  font-size: 22px;
  font-weight: 600;
  color: var(--ink-900);
}

.stats-strip-label {
  font-size: 13px;
  color: var(--ink-500);
}

.stats-strip-dot {
  color: var(--ink-300);
  margin-inline: 2px;
}

.stats-strip-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-500);
}

.stats-strip-meta-text {
  color: var(--ink-500);
}

.stats-strip-new-chip {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent-strong);
  border-radius: 999px;
  padding: 3px 10px;
  font-weight: 500;
}

.stats-strip-sync-button {
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  font-size: 13px;
  color: var(--accent-strong);
  cursor: pointer;
  text-decoration: none;
}

.stats-strip-sync-button:hover:not(:disabled) {
  text-decoration: underline;
}

.stats-strip-sync-button:disabled {
  opacity: 0.5;
  cursor: default;
}
```

- [ ] **Step 4.3: Pass `StatsStrip` inputs from `App.tsx` to `HomeScreen`**

In `App.tsx`, add a derived value above the `screenContent` `useMemo`. The "delta" counts are computed from `recentActivity` — for v1 we approximate by counting items whose `ingestedAt` is newer than the prior sync run's start time. Since we don't have prior-run timestamps cached, a simpler heuristic is: count items whose `ingestedAt` is within the last 10 seconds. Implement that:

```tsx
const recentActivityIngestedSinceMs = 10_000;
const nowForDeltaMs = Date.now();
const lastRunDeltaWorks = recentActivity.works.filter((w) => {
  const t = Date.parse(w.ingestedAt);
  return Number.isFinite(t) && nowForDeltaMs - t < recentActivityIngestedSinceMs;
}).length;
const lastRunDeltaPassages = recentActivity.passages.filter((p) => {
  const t = Date.parse(p.ingestedAt);
  return Number.isFinite(t) && nowForDeltaMs - t < recentActivityIngestedSinceMs;
}).length;
```

(Out-of-spec note: this approximation is good enough for v1's session-only chip. A future spec can swap in real per-run deltas.)

Then thread three new props into `<HomeScreen>` in the `case "Home":`:

```tsx
bookCount={works.length}
highlightCount={passages.length}
lastRunDeltaWorks={lastRunDeltaWorks}
lastRunDeltaPassages={lastRunDeltaPassages}
```

Update the `useMemo` dependency array with `recentActivity`, `works`, `passages` (likely already there).

- [ ] **Step 4.4: Render `StatsStrip` inside `HomeScreen`**

In `HomeScreen.tsx`:

Add import:
```tsx
import { StatsStrip } from "./home/StatsStrip";
```

Extend `Props` with:
```tsx
bookCount: number;
highlightCount: number;
lastRunDeltaWorks: number;
lastRunDeltaPassages: number;
```

Destructure those in the component signature.

Render `<StatsStrip>` immediately after the `<SyncBanner>` JSX:

```tsx
<StatsStrip
  bookCount={bookCount}
  highlightCount={highlightCount}
  lastRunAtIso={syncRunStartedAtIso}
  lastRunDeltaWorks={lastRunDeltaWorks}
  lastRunDeltaPassages={lastRunDeltaPassages}
  isSyncing={isSyncing}
  hasUnhealthyBanner={lastError !== null || noHealthySources || connections.some((c) => c.status === "needs_action")}
  onSyncNow={onSyncNow}
/>
```

Note: `lastRunAtIso` uses `syncRunStartedAtIso` (already a prop) — this is the start of the most recent sync run, sufficient for "synced Xm ago" copy.

- [ ] **Step 4.5: Typecheck + Lint**

Run:
```bash
pnpm --filter @archi/desktop typecheck
pnpm --filter @archi/desktop lint
```
Expected: both pass.

- [ ] **Step 4.6: Commit**

```bash
git add apps/desktop/src/renderer/screens/home/StatsStrip.tsx apps/desktop/src/renderer/screens/HomeScreen.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css
git commit -m "desktop(home): add library stats strip with resting + new-content states"
```

---

### Task 5: Add `BooksRail` component

**Files:**
- Create: `apps/desktop/src/renderer/screens/home/BooksRail.tsx`
- Modify: `apps/desktop/src/renderer/screens/HomeScreen.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 5.1: Bump `listRecentActivity` limit from 8 to 12**

In `App.tsx`, find both call sites:
```tsx
void window.archi.listRecentActivity(8).then(setRecentActivity).catch(() => {});
```

Replace `8` with `12`. There may be only one site (`refreshLists`) — search the file and replace all.

- [ ] **Step 5.2: Create `BooksRail.tsx`**

Write `apps/desktop/src/renderer/screens/home/BooksRail.tsx`:

```tsx
type Work = {
  id: string;
  title: string;
  creator?: string;
  coverImageUrl?: string;
  ingestedAt: string;
};

type Props = {
  works: Work[];
  deltaCount: number;
  onOpenWork: (workId: string) => void;
};

export function BooksRail({ works, deltaCount, onOpenWork }: Props): JSX.Element {
  return (
    <section className="books-rail">
      <header className="books-rail-head">
        <p className="content-eyebrow">Recently added</p>
        {deltaCount > 0 ? (
          <span className="books-rail-new-chip">+{deltaCount} new</span>
        ) : null}
      </header>
      {works.length === 0 ? (
        <p className="books-rail-empty">Nothing yet — run a sync to start filling your library.</p>
      ) : (
        <ul className="books-rail-track">
          {works.slice(0, 12).map((work) => (
            <li key={work.id} className="books-rail-tile">
              <button
                type="button"
                className="books-rail-tile-button"
                onClick={() => onOpenWork(work.id)}
              >
                <span className="books-rail-tile-cover" aria-hidden="true">
                  {work.coverImageUrl ? (
                    <img src={work.coverImageUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="books-rail-tile-cover-letter">
                      {(work.title[0] ?? "?").toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="books-rail-tile-title">{work.title}</span>
                {work.creator ? (
                  <span className="books-rail-tile-creator">{work.creator}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 5.3: Add styles**

Append to `styles.css`:

```css
.books-rail {
  display: grid;
  gap: 10px;
}

.books-rail-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.books-rail-new-chip {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent-strong);
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 11px;
  font-weight: 600;
}

.books-rail-empty {
  font-size: 13px;
  color: var(--ink-500);
  padding: 12px;
  border: 1px dashed color-mix(in srgb, var(--ink-300) 38%, transparent);
  border-radius: 10px;
}

.books-rail-track {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  padding-bottom: 8px;
  margin: 0;
  list-style: none;
}

.books-rail-tile {
  width: 124px;
  flex-shrink: 0;
  scroll-snap-align: start;
}

.books-rail-tile-button {
  display: grid;
  gap: 6px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  color: inherit;
}

.books-rail-tile-cover {
  display: block;
  width: 124px;
  height: 168px;
  border-radius: 6px;
  overflow: hidden;
  background: color-mix(in srgb, var(--ink-300) 22%, var(--surface));
  position: relative;
  box-shadow: 0 6px 14px rgba(72, 53, 41, 0.10);
}

.books-rail-tile-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.books-rail-tile-cover-letter {
  position: absolute;
  inset: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  font-weight: 500;
  color: var(--ink-500);
  font-family: var(--serif, Georgia, serif);
}

.books-rail-tile-title {
  font-size: 13px;
  line-height: 1.25;
  color: var(--ink-900);
  font-weight: 500;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.books-rail-tile-creator {
  font-size: 12px;
  color: var(--ink-500);
}
```

- [ ] **Step 5.4: Render `BooksRail` inside `HomeScreen`**

In `HomeScreen.tsx`:

Add import:
```tsx
import { BooksRail } from "./home/BooksRail";
```

Render `<BooksRail>` immediately after `<StatsStrip>`:

```tsx
<BooksRail
  works={recentWorks.slice(0, 12)}
  deltaCount={lastRunDeltaWorks}
  onOpenWork={onOpenWork}
/>
```

The existing activity feed (`{showActivityFeed ? (...) : null}`) is **still rendered** below the rail in this task. It will be deleted in Task 6.

- [ ] **Step 5.5: Typecheck + Lint + Commit**

```bash
pnpm --filter @archi/desktop typecheck
pnpm --filter @archi/desktop lint
git add apps/desktop/src/renderer/screens/home/BooksRail.tsx apps/desktop/src/renderer/screens/HomeScreen.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css
git commit -m "desktop(home): add recently-added books rail above the activity feed"
```

---

### Task 6: Add `RandomHighlight` + `LatestHighlights`; delete the old activity feed

**Files:**
- Create: `apps/desktop/src/renderer/screens/home/RandomHighlight.tsx`
- Create: `apps/desktop/src/renderer/screens/home/LatestHighlights.tsx`
- Modify: `apps/desktop/src/renderer/screens/HomeScreen.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

This task replaces the existing activity feed block in `HomeScreen` with the two new highlight modules, side by side.

- [ ] **Step 6.1: Create `RandomHighlight.tsx`**

Write `apps/desktop/src/renderer/screens/home/RandomHighlight.tsx`:

```tsx
import { useEffect, useState } from "react";
import { excerptOf } from "./utils";

type Passage = {
  id: string;
  body: string;
  workId: string;
  workTitle: string;
};

type Props = {
  passages: Passage[];
  onOpenWork: (workId: string) => void;
};

function pickRandom<T>(items: T[], excludeId?: string): T | null {
  if (items.length === 0) return null;
  if (items.length === 1) return items[0];
  let candidate: T;
  let attempts = 0;
  do {
    candidate = items[Math.floor(Math.random() * items.length)];
    attempts += 1;
  } while (
    excludeId !== undefined &&
    (candidate as unknown as { id: string }).id === excludeId &&
    attempts < 4
  );
  return candidate;
}

export function RandomHighlight({ passages, onOpenWork }: Props): JSX.Element {
  const [selected, setSelected] = useState<Passage | null>(() =>
    pickRandom(passages)
  );

  // If the passages list changes (sync brought new ones) and we don't have a
  // selection yet, pick one. Don't re-roll automatically otherwise.
  useEffect(() => {
    if (!selected && passages.length > 0) {
      setSelected(pickRandom(passages));
    }
  }, [passages, selected]);

  if (passages.length === 0) {
    return (
      <section className="random-highlight-card random-highlight-card-empty">
        <p className="content-eyebrow">A random highlight</p>
        <p className="random-highlight-empty">No highlights yet.</p>
      </section>
    );
  }

  if (!selected) {
    return (
      <section className="random-highlight-card">
        <p className="content-eyebrow">A random highlight</p>
      </section>
    );
  }

  const canShuffle = passages.length > 1;

  return (
    <section className="random-highlight-card">
      <header className="random-highlight-head">
        <p className="content-eyebrow">A random highlight</p>
        {canShuffle ? (
          <button
            type="button"
            className="random-highlight-shuffle"
            onClick={(event) => {
              event.stopPropagation();
              setSelected(pickRandom(passages, selected.id));
            }}
            aria-label="Shuffle to a different highlight"
          >
            Shuffle ↻
          </button>
        ) : null}
      </header>
      <button
        type="button"
        className="random-highlight-body-button"
        onClick={() => onOpenWork(selected.workId)}
      >
        <span className="random-highlight-quote-mark" aria-hidden="true">&ldquo;</span>
        <p className="random-highlight-quote">{excerptOf(selected.body, 360)}</p>
        <p className="random-highlight-attribution">{selected.workTitle}</p>
      </button>
    </section>
  );
}
```

- [ ] **Step 6.2: Create `LatestHighlights.tsx`**

Write `apps/desktop/src/renderer/screens/home/LatestHighlights.tsx`:

```tsx
import { useEffect, useState } from "react";
import { excerptOf, formatRelative } from "./utils";

type Passage = {
  id: string;
  body: string;
  workTitle: string;
  ingestedAt: string;
  workId?: string;
};

type Props = {
  passages: Passage[];
  deltaCount: number;
  onOpenWork: (workId: string) => void;
};

export function LatestHighlights({ passages, deltaCount, onOpenWork }: Props): JSX.Element {
  const [tickAtMs, setTickAtMs] = useState<number>(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setTickAtMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const items = passages.slice(0, 5);

  return (
    <section className="latest-highlights">
      <header className="latest-highlights-head">
        <p className="content-eyebrow">Latest highlights</p>
        {deltaCount > 0 ? (
          <span className="latest-highlights-new-chip">+{deltaCount} new</span>
        ) : null}
      </header>
      {items.length === 0 ? (
        <p className="latest-highlights-empty">Nothing yet — your fresh highlights will land here.</p>
      ) : (
        <ul className="latest-highlights-list">
          {items.map((passage) => (
            <li key={passage.id} className="latest-highlights-item">
              <button
                type="button"
                className="latest-highlights-button"
                onClick={() => passage.workId && onOpenWork(passage.workId)}
                disabled={!passage.workId}
              >
                <span className="latest-highlights-quote">{excerptOf(passage.body, 160)}</span>
                <span className="latest-highlights-meta">
                  <span className="latest-highlights-work">{passage.workTitle}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="latest-highlights-time tabular">
                    {formatRelative(passage.ingestedAt, tickAtMs)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

Note: `RecentPassage` in the existing types doesn't carry `workId`. Surface that in this task:

In `App.tsx`'s `recentActivity` state type, the passages array shape lives in the `useState` initializer:
```tsx
const [recentActivity, setRecentActivity] = useState<{
  works: Array<{ id: string; title: string; creator?: string; coverImageUrl?: string; ingestedAt: string }>;
  passages: Array<{ id: string; body: string; workTitle: string; ingestedAt: string }>;
}>({ works: [], passages: [] });
```

Add `workId?: string` to the passages entry shape:
```tsx
passages: Array<{ id: string; body: string; workTitle: string; ingestedAt: string; workId?: string }>;
```

If `listRecentActivity` in the main process doesn't currently return `workId`, the click-to-open behavior degrades to a disabled button — which `LatestHighlights` already handles. Verify by reading the IPC handler if curious; functionally fine either way.

- [ ] **Step 6.3: Add styles for highlights modules**

Append to `styles.css`:

```css
.highlights-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

@media (max-width: 920px) {
  .highlights-split {
    grid-template-columns: 1fr;
  }
}

.random-highlight-card,
.latest-highlights {
  background: var(--surface);
  border: 1px solid color-mix(in srgb, var(--ink-300) 18%, transparent);
  border-radius: 12px;
  padding: 16px 18px;
  display: grid;
  gap: 10px;
}

.random-highlight-head,
.latest-highlights-head,
.books-rail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.random-highlight-shuffle {
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--ink-300) 38%, transparent);
  color: var(--ink-700);
  padding: 3px 10px;
  border-radius: 999px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.random-highlight-shuffle:hover {
  color: var(--accent-strong);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
}

.random-highlight-body-button {
  display: grid;
  gap: 8px;
  text-align: left;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  color: inherit;
}

.random-highlight-quote-mark {
  font-family: Georgia, serif;
  font-size: 36px;
  line-height: 0.7;
  color: color-mix(in srgb, var(--accent) 50%, transparent);
}

.random-highlight-quote {
  font-family: Georgia, serif;
  font-size: 17px;
  line-height: 1.55;
  font-style: italic;
  color: var(--ink-900);
  margin: 0;
}

.random-highlight-attribution {
  font-size: 12px;
  color: var(--ink-500);
  margin: 0;
}

.random-highlight-card-empty .random-highlight-empty {
  font-size: 13px;
  color: var(--ink-500);
  font-style: italic;
}

.latest-highlights-new-chip {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent-strong);
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 11px;
  font-weight: 600;
}

.latest-highlights-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.latest-highlights-item {
  border-left: 2px solid color-mix(in srgb, var(--accent) 30%, transparent);
  padding-left: 10px;
}

.latest-highlights-button {
  display: grid;
  gap: 4px;
  text-align: left;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  color: inherit;
  width: 100%;
}

.latest-highlights-button:disabled {
  cursor: default;
}

.latest-highlights-quote {
  font-size: 13px;
  color: var(--ink-700);
  line-height: 1.4;
}

.latest-highlights-meta {
  font-size: 11px;
  color: var(--ink-500);
}

.latest-highlights-work {
  color: var(--ink-700);
}

.latest-highlights-empty {
  font-size: 13px;
  color: var(--ink-500);
  font-style: italic;
}
```

- [ ] **Step 6.4: Replace activity feed in `HomeScreen.tsx`**

In `HomeScreen.tsx`:

Add imports:
```tsx
import { RandomHighlight } from "./home/RandomHighlight";
import { LatestHighlights } from "./home/LatestHighlights";
```

Find and **delete** the entire `{showActivityFeed ? (` block (the `<div className="activity-feed...">` with both `<details>` columns inside).

Also delete the `const showActivityFeed = ...` line and `const freshWorks = recentWorks.slice(0, 5);` and `const freshPassages = recentPassages.slice(0, 5);` lines if they're now unused.

Insert in their place (after `<BooksRail>`):

```tsx
<div className="highlights-split">
  <RandomHighlight
    passages={passages}
    onOpenWork={onOpenWork}
  />
  <LatestHighlights
    passages={recentPassages}
    deltaCount={lastRunDeltaPassages}
    onOpenWork={onOpenWork}
  />
</div>
```

- [ ] **Step 6.5: Surface `workId` on `recentPassages`**

In `HomeScreen.tsx`'s `Props`, update the `RecentPassage` type to include the optional workId:
```tsx
type RecentPassage = {
  id: string;
  body: string;
  workTitle: string;
  ingestedAt: string;
  workId?: string;
};
```

This already matches what `LatestHighlights` expects. No App-level changes needed beyond Step 6.2's `recentActivity` state shape adjustment.

- [ ] **Step 6.6: Typecheck + Lint + Commit**

```bash
pnpm --filter @archi/desktop typecheck
pnpm --filter @archi/desktop lint
git add apps/desktop/src/renderer/screens/home/RandomHighlight.tsx apps/desktop/src/renderer/screens/home/LatestHighlights.tsx apps/desktop/src/renderer/screens/HomeScreen.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css
git commit -m "desktop(home): replace activity feed with random + latest highlights modules"
```

---

### Task 7: Move search to the content-header; add `HomeSearchResults`

**Files:**
- Create: `apps/desktop/src/renderer/screens/home/HomeSearchResults.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/screens/HomeScreen.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

The current search input is the hero centerpiece of `HomeScreen`. After this task it lives in the content-header's right side and active queries collapse modules §3–§5 in favor of the search results panel.

- [ ] **Step 7.1: Create `HomeSearchResults.tsx`**

Write `apps/desktop/src/renderer/screens/home/HomeSearchResults.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { highlightMatch, excerptAroundMatch } from "./utils";

type Work = {
  id: string;
  title: string;
  creator?: string;
  coverImageUrl?: string;
};

type Passage = {
  id: string;
  body: string;
  workId: string;
  workTitle: string;
};

type Props = {
  query: string;
  works: Work[];
  passages: Passage[];
  onOpenWork: (workId: string) => void;
};

export function HomeSearchResults({ query, works, passages, onOpenWork }: Props): JSX.Element {
  const passagesScrollRef = useRef<HTMLDivElement>(null);
  const passagesVirtualizer = useVirtualizer({
    count: passages.length,
    getScrollElement: () => passagesScrollRef.current,
    estimateSize: () => 110,
    overscan: 6,
    getItemKey: (index: number) => passages[index]?.id ?? index
  });
  const passagesVirtualItems = passagesVirtualizer.getVirtualItems();

  useEffect(() => {
    passagesScrollRef.current?.scrollTo({ top: 0 });
  }, [query]);

  const hasResults = works.length > 0 || passages.length > 0;

  if (!hasResults) {
    return <p className="home-search-empty">No results found.</p>;
  }

  return (
    <div className="home-search-results">
      <p className="home-search-count">
        {works.length} {works.length === 1 ? "book" : "books"}
        <span aria-hidden="true"> · </span>
        {passages.length} {passages.length === 1 ? "highlight" : "highlights"}
      </p>
      <div className="home-search-scroll">
        {works.length > 0 ? (
          <div className="home-search-group">
            <p className="content-eyebrow">Books</p>
            <ul className="home-search-list">
              {works.map((work) => (
                <li key={work.id}>
                  <button
                    type="button"
                    className="home-search-item home-search-item-work"
                    onClick={() => onOpenWork(work.id)}
                  >
                    <span className="activity-cover" aria-hidden="true">
                      {work.coverImageUrl ? (
                        <img src={work.coverImageUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="activity-cover-letter">
                          {(work.title[0] ?? "?").toUpperCase()}
                        </span>
                      )}
                    </span>
                    <span className="home-search-item-body">
                      <span className="home-search-item-title">
                        {highlightMatch(work.title, query)}
                      </span>
                      {work.creator ? (
                        <span className="home-search-item-meta">
                          {highlightMatch(work.creator, query)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {passages.length > 0 ? (
          <div className="home-search-group">
            <p className="content-eyebrow">Highlights</p>
            <div ref={passagesScrollRef} className="home-search-passages-scroll">
              <div
                className="home-search-passages-inner"
                style={{ height: `${passagesVirtualizer.getTotalSize()}px` }}
              >
                {passagesVirtualItems.map((virtualItem: VirtualItem) => {
                  const passage = passages[virtualItem.index];
                  if (!passage) return null;
                  return (
                    <div
                      key={virtualItem.key}
                      data-index={virtualItem.index}
                      ref={passagesVirtualizer.measureElement}
                      className="home-search-passages-row"
                      style={{ transform: `translateY(${virtualItem.start}px)` }}
                    >
                      <button
                        type="button"
                        className="home-search-item home-search-item-passage"
                        onClick={() => onOpenWork(passage.workId)}
                      >
                        <span className="activity-quote-mark" aria-hidden="true">
                          &ldquo;
                        </span>
                        <span className="home-search-item-body">
                          <span className="home-search-item-quote">
                            {highlightMatch(
                              excerptAroundMatch(passage.body, query),
                              query
                            )}
                          </span>
                          <span className="home-search-item-meta">
                            {highlightMatch(passage.workTitle, query)}
                          </span>
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

Note: this component continues to reference the legacy `.activity-cover` and `.activity-quote-mark` classes for now. Those classes will be moved or kept in the final CSS cleanup (Task 9) — leave the markup as-is here.

- [ ] **Step 7.2: Move the search input into the content-header**

The content-header is owned by `App.tsx`, not `HomeScreen.tsx`. To put a Home-only search there, surface the input via a render-prop or a derived element.

Simplest approach: lift the search query state into a new `useState` in `HomeScreen`'s parent layout but render the input inside the content-header. Since the content-header lives in `App.tsx`, we'll instead add a small `headerAccessory` slot.

In `App.tsx`, replace the `content-header` JSX:

Find:
```tsx
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
</header>
```

Replace with:
```tsx
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
  {activeScreen === "Home" ? (
    <div className="content-header-search">
      <input
        type="search"
        className="content-header-search-input"
        placeholder="Search your library…"
        value={homeSearchQuery}
        onChange={(event) => setHomeSearchQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && homeSearchQuery) {
            event.preventDefault();
            setHomeSearchQuery("");
          }
        }}
        aria-label="Search your library"
        autoFocus
      />
      {homeSearchQuery ? (
        <button
          type="button"
          className="content-header-search-clear"
          onClick={() => setHomeSearchQuery("")}
          aria-label="Clear search"
          tabIndex={-1}
        >
          ×
        </button>
      ) : null}
    </div>
  ) : null}
</header>
```

Lift the search query into `App.tsx`. Add near the other `useState` declarations:
```tsx
const [homeSearchQuery, setHomeSearchQuery] = useState("");
```

Pass it to `HomeScreen` as a prop and let `HomeScreen` consume it. Add to `<HomeScreen>`:
```tsx
homeSearchQuery={homeSearchQuery}
```

- [ ] **Step 7.3: Consume `homeSearchQuery` inside `HomeScreen`**

In `HomeScreen.tsx`:

Extend `Props`:
```tsx
homeSearchQuery: string;
```

Destructure `homeSearchQuery` in the component signature.

Remove the local `searchQuery` state and the `home-search-input` markup inside the body of `HomeScreen` (`<div className="home-search home-search-hero">` and its contents). Replace with the `<HomeSearchResults>` integration described below.

Update the `liveTrimmedQuery` / `trimmedQuery` derivation to use the prop:
```tsx
const liveTrimmedQuery = homeSearchQuery.trim();
const trimmedQuery = useDeferredValue(liveTrimmedQuery);
const isSearchPending = liveTrimmedQuery !== trimmedQuery; // keep if still used; otherwise delete
```

Conditionally render: when `trimmedQuery` is non-empty, render `<HomeSearchResults>` in place of the StatsStrip + BooksRail + highlights-split. Otherwise render the three modules as before:

```tsx
{trimmedQuery ? (
  <HomeSearchResults
    query={trimmedQuery}
    works={searchResults.works}
    passages={searchResults.passages}
    onOpenWork={onOpenWork}
  />
) : (
  <>
    <StatsStrip … />
    <BooksRail … />
    <div className="highlights-split">
      <RandomHighlight … />
      <LatestHighlights … />
    </div>
  </>
)}
```

`<SyncBanner>` stays above this conditional — it shows during sync regardless of whether the user is searching.

Delete the entire `<div className="home-search home-search-hero">…</div>` block — both the input and the inline-action footer (Sync now link) since those moved into Header / StatsStrip respectively.

Add import:
```tsx
import { HomeSearchResults } from "./home/HomeSearchResults";
```

- [ ] **Step 7.4: Add content-header search styles**

Append to `styles.css`:

```css
.content-header-search {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 280px;
  flex-shrink: 0;
}

.content-header-search-input {
  width: 100%;
  font-size: 13px;
  padding: 7px 32px 7px 14px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--ink-300) 36%, transparent);
  background: var(--surface);
  transition: box-shadow 160ms ease, border-color 160ms ease;
}

.content-header-search-input:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--accent) 50%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
}

.content-header-search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  border: none;
  background: color-mix(in srgb, var(--ink-300) 22%, transparent);
  color: var(--ink-700);
  border-radius: 999px;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.content-header-search-clear:hover {
  background: color-mix(in srgb, var(--ink-300) 40%, transparent);
}
```

- [ ] **Step 7.5: Typecheck + Lint + Commit**

```bash
pnpm --filter @archi/desktop typecheck
pnpm --filter @archi/desktop lint
git add apps/desktop/src/renderer/screens/home/HomeSearchResults.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/screens/HomeScreen.tsx apps/desktop/src/renderer/styles.css
git commit -m "desktop(home): move search into content-header + extract HomeSearchResults"
```

---

### Task 8: Add the sidebar warning dot on the Settings gear

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 8.1: Compute the unhealthy bool in `App.tsx`**

Above the `<aside className="sidebar">` JSX, add:
```tsx
const sidebarUnhealthy =
  !isSyncing &&
  (Object.values(connections).some((c) => c.status === "needs_action") ||
    syncState.lastError !== null);
```

- [ ] **Step 8.2: Render the dot on the Settings nav button**

Find the `screens.map((screen) => (` block where each sidebar button is rendered. Replace it with a version that adds the dot when appropriate:

```tsx
{screens.map((screen) => (
  <button
    key={screen}
    className={`${activeScreen === screen ? "active" : ""}${screen === "Settings" && sidebarUnhealthy ? " sidebar-nav-has-warning" : ""}`}
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
    {screen === "Settings" && sidebarUnhealthy ? (
      <span className="sidebar-nav-warning-dot" aria-label="Needs attention" />
    ) : null}
  </button>
))}
```

- [ ] **Step 8.3: Add dot styles**

Append to `styles.css`:

```css
.sidebar button {
  position: relative;
}

.sidebar-nav-warning-dot {
  position: absolute;
  top: 6px;
  right: 8px;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #c98a2a;
  box-shadow: 0 0 0 2px var(--surface);
}

.layout.sidebar-collapsed .sidebar-nav-warning-dot {
  top: 4px;
  right: 4px;
}
```

- [ ] **Step 8.4: Typecheck + Lint + Commit**

```bash
pnpm --filter @archi/desktop typecheck
pnpm --filter @archi/desktop lint
git add apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css
git commit -m "desktop: show warning dot on Settings nav button when connections need action"
```

---

### Task 9: CSS cleanup — delete obsolete classes

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: `apps/desktop/src/renderer/screens/HomeScreen.tsx` (delete unused state/memos identified in Task 3)
- Modify: `apps/desktop/src/renderer/screens/home/HomeSearchResults.tsx` (migrate `.activity-cover` and `.activity-quote-mark` to new search-specific classes)

This task removes dead code. After this task, `HomeScreen.tsx` is a thin composition shell.

- [ ] **Step 9.1: Rename legacy search-result classes**

In `HomeSearchResults.tsx`, the markup currently uses `.activity-cover`, `.activity-cover-letter`, and `.activity-quote-mark`. Those styles will be deleted alongside the rest of the activity feed CSS. Rename the class usages and copy the relevant style rules under new names.

In `HomeSearchResults.tsx`, replace:
- `className="activity-cover"` → `className="home-search-cover"`
- `className="activity-cover-letter"` → `className="home-search-cover-letter"`
- `className="activity-quote-mark"` → `className="home-search-quote-mark"`

In `styles.css`, **before** deleting the activity-* block, copy the four old rules under new names:

```css
.home-search-cover {
  display: block;
  width: 36px;
  height: 48px;
  border-radius: 4px;
  overflow: hidden;
  background: color-mix(in srgb, var(--ink-300) 22%, var(--surface));
  position: relative;
  flex-shrink: 0;
}

.home-search-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.home-search-cover-letter {
  position: absolute;
  inset: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 500;
  color: var(--ink-500);
  font-family: var(--serif, Georgia, serif);
}

.home-search-quote-mark {
  font-family: Georgia, serif;
  font-size: 28px;
  line-height: 0.7;
  color: color-mix(in srgb, var(--accent) 45%, transparent);
  flex-shrink: 0;
}
```

If the existing `.activity-cover` rule had different exact values in your CSS, copy them verbatim before renaming so the look is preserved. Compare with the original styles.css contents before the prior delete.

- [ ] **Step 9.2: Delete obsolete activity / sync-live classes**

In `styles.css`, find and delete each of these rule blocks (every selector starting with one of these prefixes):

- `.sync-live`, `.sync-live-header`, `.sync-live-running`, `.sync-live-cancelling`, `.sync-live-phase`, `.sync-live-elapsed`, `.sync-live-cancel-button`, `.sync-live-head`, `.sync-live-head-actions`, `.live-dot`
- `.activity-feed`, `.activity-feed-live`, `.activity-column`, `.activity-column-head`, `.activity-column-chevron`, `.activity-list`, `.activity-item`, `.activity-item-work`, `.activity-item-passage`, `.activity-cover`, `.activity-cover-letter`, `.activity-body`, `.activity-title`, `.activity-meta`, `.activity-meta-soft`, `.activity-quote-mark`, `.activity-quote`, `.activity-attribution`, `.activity-empty`
- `.home-search-hero`, `.home-search-input-large`, `.home-search-inline-action`, `.home-inline-link`, `.home-inline-link-accent`, `.home-inline-meta`
- `.progress-bar`, `.progress-bar-determinate`, `.progress-bar-indeterminate`, `.progress-bar-fill`, `.progress-bar-shimmer`, `.progress-bar-indeterminate-fill`, `.progress-bar-label`, `.progress-bar-label-pending` (the sync banner has its own progress styles)
- `.sync-stats`, `.sync-stat` (replaced by stats strip)
- `.sync-live-header + .home-search-hero` adjacency selector

Use grep to confirm none are still referenced before deletion:
```bash
grep -RE "sync-live|activity-feed|activity-column|activity-list|activity-item|activity-cover|activity-body|activity-title|activity-meta|activity-quote|activity-attribution|activity-empty|home-search-hero|home-search-input-large|home-search-inline-action|home-inline-link|home-inline-meta|progress-bar|sync-stat" apps/desktop/src/renderer/
```

Each match outside `styles.css` is something that still needs migration. If the only matches are inside `styles.css` itself, deletion is safe.

- [ ] **Step 9.3: Delete unused state / memos in `HomeScreen.tsx`**

The two `useEffect`s that maintained `progressBaseAtMs`/`tickAtMs`, plus the `displayedElapsedMs` memo, plus the local helpers `excerptOf`, `formatRelative`, `formatElapsed`, `highlightMatch`, `excerptAroundMatch`, are now redundant (the components import their own copies from `home/utils`).

Remove from `HomeScreen.tsx`:
- Both `useEffect` blocks that update `progressBaseAtMs` and `tickAtMs`
- `displayedElapsedMs`, `elapsedSeconds`, `elapsedDisplay` derivations
- `processed`, `total`, `hasDeterminate`, `pctComplete` derivations
- `booksCount`, `quotesCount`, `phaseLabel`, `sourceLabel`, `liveModeClass`
- `showActivityFeed`, `freshWorks`, `freshPassages` (already deleted in Task 6)
- The bottom-of-file helper functions: `excerptOf`, `formatRelative`, `formatElapsed`
- The top-of-file helpers `highlightMatch`, `excerptAroundMatch` (if still present)
- The unused imports: `Fragment`, `type ReactNode` from React if no longer used
- The unused state `setProgressBaseAtMs`, `setTickAtMs` if you kept them

The file should shrink from ~570 lines to something close to ~80–120 lines after this cleanup.

- [ ] **Step 9.4: Typecheck + Lint**

```bash
pnpm --filter @archi/desktop typecheck
pnpm --filter @archi/desktop lint
```
Both must pass with zero warnings about unused vars in `HomeScreen.tsx`.

- [ ] **Step 9.5: Commit**

```bash
git add apps/desktop/src/renderer/styles.css apps/desktop/src/renderer/screens/HomeScreen.tsx apps/desktop/src/renderer/screens/home/HomeSearchResults.tsx
git commit -m "desktop(home): drop activity-feed + sync-live CSS and dead local state"
```

---

### Task 10: Manual verification + final polish

**Files:** none (verification only). Any small fixes get their own follow-up commit.

- [ ] **Step 10.1: Start the dev server**

Run: `pnpm --filter @archi/desktop dev`

Wait for the Electron window to open. The renderer + main + preload all watch and rebuild on change.

- [ ] **Step 10.2: Walk the golden path**

Verify each:

1. Sidebar shows exactly **four** items: Home, Library, Passages, Settings. Settings uses the gear icon.
2. Click each sidebar item; each renders correctly. The collapse toggle still works (try both states).
3. On Home, the page header shows `Workspace / Home` on the left and the compact search input on the right.
4. Below the header: stats strip (`N books · M highlights · synced X ago · Sync now`), books rail (covers + titles), and a two-column split for Random highlight + Latest highlights.
5. Click **Sync now**: the top banner appears in the running state with an animated progress bar, phase label, elapsed timer, and a Cancel button. Cancel works.
6. After a sync completes successfully: the stats strip briefly shows `+N new books · +M new highlights` then returns to the resting copy after ~10 seconds.
7. Type a query into the header search input: the three body modules disappear and the search-results panel appears (works group + virtualized highlights). Esc clears the query.
8. In **Settings**: Connections tab shows the full connections UI; Logs tab shows the logs list. Default tab is Connections.
9. Disconnect a connection (or simulate `needs_action` state via the app): a warning banner appears at the top of Home (amber); the Settings gear sidebar button shows a small dot. Click the banner → lands you in Settings → Connections. Reconnect; banner and dot disappear.
10. With `syncState.lastError` set (you can simulate by failing a sync): a red banner appears with `Try again` and `Details → Settings · Logs`. Click `Details` → lands in Settings → Logs.
11. With no healthy sources: amber banner says `No connected sources — set one up to start syncing` with the Open Settings action.
12. Library, Passages, Settings screens do **not** show the banner. The Settings warning dot still shows when off-Home (so users keep awareness).

- [ ] **Step 10.3: Edge cases**

- Resize the window narrow: the highlights-split should collapse to a single column at <920px.
- Empty library (fresh install or zero items): stats strip shows `0 books · 0 highlights`, books rail shows the empty-state copy, Random highlight shows `No highlights yet.`, Latest highlights shows `Nothing yet — your fresh highlights will land here.`
- Active sync + active search at the same time: the banner sits above the search-results panel; both are visible.
- Onboarding flow: complete onboarding → user lands on **Settings** (Connections tab), not the old Connections screen.

- [ ] **Step 10.4: If issues are found**

Fix them in a follow-up commit with a clear message like `desktop(home): tighten <thing>`. Do NOT amend prior commits — each task's commit should stand on its own.

- [ ] **Step 10.5: Final commit (if any verification fixes landed)**

```bash
git add <files>
git commit -m "desktop(home): post-verification polish"
```

If no fixes were needed, skip this step.

---

## Spec coverage check

| Spec section | Tasks |
|---|---|
| Information architecture & navigation (4 sidebar items, gear icon) | Task 2 |
| Sidebar warning dot | Task 8 |
| Settings screen with Connections + Logs tabs | Task 2 |
| Sync banner — running state | Task 3 |
| Sync banner — cancelling state | Task 3 |
| Sync banner — NoHealthySources state | Task 3 |
| Sync banner — NeedsAuth state | Task 3 |
| Sync banner — Failed state | Task 3 |
| Banner priority ordering | Task 3 |
| Banner scope: Home only | Task 3 (component lives in HomeScreen) |
| Library stats strip + resting/active/warning variants | Task 4 |
| `+N new` chip after sync completes | Task 4 |
| Books rail with `+N new` chip | Task 5 |
| Random highlight card with Shuffle | Task 6 |
| Latest highlights list with `+N new` chip | Task 6 |
| Search input moves to content-header | Task 7 |
| Search results panel replaces body modules | Task 7 |
| Activity feed removed (modules carry freshness signal) | Task 6 |
| `listRecentActivity` bumped from 8 → 12 | Task 5 |
| Helpers extracted into `home/utils` | Task 1 |
| CSS cleanup (sync-live, activity-feed, hero search) | Task 9 |
| `onNavigateToConnections` → `onNavigateToSettings(tab)` | Task 3 (prop renamed; banner passes through the tab; legacy inline reconnect button also migrated) |
| Empty-library edge cases | Tasks 4, 5, 6 |
