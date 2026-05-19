# Architecture

Archi is a local-first sync pipeline with a desktop shell.

## Data flow

1. Source workers ingest passages (`device-export`, optional `cloud-notebook`).
2. Parsed records are normalized and deduplicated (`fingerprintHash`).
3. Canonical entities are upserted into local SQLite.
4. Destination worker upserts to Notion `Library` and `Passages`.
5. Sync job state is persisted for resumable retries.
6. Connection state is managed by a provider-agnostic connection manager (`notion`, `cloud_notebook`, `device_export`).

## Runtime boundaries

- Electron main: scheduling, file system, sync orchestration.
- Preload: safe IPC API for renderer.
- Renderer: connection cards, status UI, logs, and local data browsing.
- Packages: reusable domain logic and connectors.

## Connection model

- Providers: `notion`, `cloud_notebook`, `device_export`.
- Provider status: `connected`, `needs_action`, `error`, `disconnected`, `configuring`.
- Connection lifecycle APIs are exposed through IPC (`connect`, `reconnect`, `disconnect`, `test`, `list`).
- Notion authentication is OAuth-based when `NOTION_OAUTH_*` env variables are present; migrated legacy integration tokens are stored in encrypted local credential storage.
- Cloud notebook authentication is Playwright-based and persisted via profile directory + storage-state snapshot, then revalidated on startup.
- Cloud notebook validation emits a structured `CloudValidationReport` on every check (startup, reconnect, fetch, status refresh). Reports are appended to `userData/cloud-validation.log` (JSONL, 1 MB rotation, one generation) and held in a 20-deep ring buffer in the main process. The latest report is surfaced on `ConnectionState.metadata` and exposed to the renderer via `window.archi.getRecentValidations()`. Hard `decisionReasonCode`s (`signin_url_redirect`, `login_form_visible`, `cookies_empty_on_load`, `goto_failed`) cause `connected → needs_auth`; transient classifications (unrecognized interstitials, missing notebook DOM on a notebook URL) keep the cached status until a hard signal or user action.
