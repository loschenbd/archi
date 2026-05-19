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
