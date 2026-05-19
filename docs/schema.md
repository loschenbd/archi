# Local Schema

## works

- `id` text primary key
- `ingest_source` text
- `external_id` text nullable
- `display_title` text
- `raw_title` text
- `creator` text nullable
- `work_type` text
- `store_identifier` text nullable
- `cover_image_url` text nullable
- `work_note` text nullable
- `labels_json` text
- `is_archived` integer
- `first_ingested_at` text
- `last_source_changed_at` text nullable
- `last_synced_at` text nullable
- `raw_payload_json` text nullable

## passages

- `id` text primary key
- `work_id` text foreign key -> works.id
- `external_passage_id` text nullable
- `body` text
- `reader_note` text nullable
- `position_start` text nullable
- `position_end` text nullable
- `position_kind` text nullable
- `marker_color` text nullable
- `fingerprint_hash` text unique
- `labels_json` text
- `is_starred` integer
- `is_hidden` integer
- `is_archived` integer
- `marked_at` text nullable
- `ingested_at` text
- `updated_at` text
- `raw_payload_json` text nullable

## Cloud notebook deterministic contract

Cloud notebook ingestion follows a strict two-phase model:

1. Extract canonical book metadata from the notebook library list.
2. Extract highlights for each selected book and stamp each row with that selected book identity.

This intentionally avoids probabilistic row-to-book matching.

### Canonical cloud book identity

For cloud notebook rows, `works` identity precedence is:

1. `store_identifier` (ASIN when present)
2. `external_id` (upstream external book id)
3. normalized `display_title + creator` fallback

### Canonical cloud book metadata

Cloud book metadata is treated as canonical from the selected book context:

- `display_title` / `raw_title`: human-readable title from library/book header
- `creator`: author/byline when available
- `cover_image_url`: book cover URL when present

Row-level title fragments are not used to remap highlights across books.

### Canonical cloud passage identity

For cloud rows, `passages.external_passage_id` is namespaced at ingest time:

- `${bookNamespace}::${rawExternalPassageId}`

`bookNamespace` is the best available stable book identifier (ASIN/store/external id/work id fallback).  
This prevents collisions where identical raw highlight IDs appear in different books.

## sync_jobs

- `id` text primary key
- `source` text unique (`cloud-notebook`, `device-export`)
- `status` text (`idle`, `running`, `success`, `needs_auth`, `partial_success`, `failed`)
- `resume_cursor` text nullable
- `changed_after` text nullable
- `last_success_at` text nullable
- `last_attempt_at` text nullable
- `last_error` text nullable

## local settings and credentials

- `settings.json` stores non-sensitive runtime settings:
  - source paths and toggles
  - notion parent/database IDs
- `credentials.json` stores encrypted provider credentials (for example Notion OAuth access token) via Electron `safeStorage` when available.

## Notion destination schema contract

Archi writes to two Notion databases:

- `Library`: one row per work
- `Passages`: one row per normalized passage/highlight

This mirrors local canonical tables and preserves idempotent sync behavior.

### Library properties

Canonical sync-managed properties:

- `Title` (title)
- `Creator` (rich_text)
- `Work Type` (select)
- `Ingest Source` (select)
- `Store ID` (rich_text)
- `Cover` (url)
- `Labels` (multi_select)
- `Work Note` (rich_text)
- `Last Marked At` (date)
- `External ID` (rich_text)
- `First Ingested At` (date)
- `Source Changed At` (date)
- `Last Synced At` (date)
- `Archived` (checkbox)

Derived relation/rollup properties:

- `Passages` (relation <- from `Passages.Work`)
- `Passage Count` (rollup count of related passages)
- `Starred Count` (rollup checked count from related `Starred`)
- `Latest Passage At` (rollup latest date from related `Marked At`)

User-owned properties (created by Archi but never overwritten by sync):

- `Priority` (select)
- `Queue` (select)
- `Next Review` (date)

### Passages properties

Canonical sync-managed properties:

- `Passage` (title)
- `Reader Note` (rich_text)
- `Work` (relation -> `Library`)
- `Position` (rich_text)
- `Position Kind` (select)
- `Marker Color` (select)
- `Marked At` (date)
- `Ingested At` (date)
- `Updated At` (date)
- `Labels` (multi_select)
- `Starred` (checkbox)
- `Hidden` (checkbox)
- `External Passage ID` (rich_text)
- `Fingerprint Hash` (rich_text)
- `Archived` (checkbox)

Implementation note:

- `Passage` stores the full highlight/quote text (trimmed to Notion title limits).
- We intentionally avoid duplicating quote text in a second passage-content property.
- `Position`/`Position Kind` are populated when source metadata includes page/location context (device export is reliable; cloud notebook is best-effort).
- `Cover` mirrors `works.cover_image_url` when upstream source metadata includes a usable image URL.

User-owned properties (created by Archi but never overwritten by sync):

- `Status` (select: `inbox`, `reviewing`, `distilled`, `archived`)
- `Theme` (multi_select)
- `Atomic Note` (rich_text)

## Notion view bundle (recommended defaults)

Notion API does not currently support creating/editing database views programmatically. The following default views are the target view bundle for manual or future automated setup:

- `Library / Recent Activity`: sort `Latest Passage At desc`
- `Library / Needs Review`: filter `Next Review <= now` and/or `Priority`
- `Library / Ops Audit`: include sync metadata + IDs
- `Passages / Inbox`: filter `Status = inbox` and `Archived = false`, sort `Marked At desc`
- `Passages / Starred`: filter `Starred = true` and `Archived = false`
- `Passages / Recent Highlights`: sort `Marked At desc`
- `Passages / Ops Audit`: include ID/hash/timestamp fields

## Live Notion snapshot (current workspace)

This is the current live state as configured in Notion (via MCP updates):

- Page: `Archi`
- Databases:
  - `Library`: `https://www.notion.so/3601a704631581b4a412f046ae6ef91d`
  - `Passages`: `https://www.notion.so/3601a70463158139a8eddaaa11662971`

Current Library views:

- `Default view`
- `Recent Activity`
- `By Type`
- `Needs Review`
- `Ops Audit`

Current Passages views:

- `Default view`
- `Inbox`
- `Starred`
- `Recent Highlights`
- `By Theme`
- `By Label`
- `Ops Audit`

Per-book page linked views currently added:

- `Quotes Feed` linked view blocks are added on several `Library` item pages.
- Due to current Notion MCP view-DSL limitations, relation filter clauses like `Work contains This page` are not reliably persisted by MCP.
- Final per-page scoping should be set in Notion UI on each linked view: `Work -> contains -> This page`.

## Migration and overwrite policy

### Additive migration policy

- When existing Notion DB IDs are configured, Archi performs an additive schema check before sync.
- Missing properties are added.
- Existing properties are not deleted, renamed, or type-mutated.
- User custom properties are preserved untouched.

### Overwrite policy

- Sync writes only to canonical sync-managed properties.
- User-owned review properties (`Priority`, `Queue`, `Next Review`, `Status`, `Theme`, `Atomic Note`) are intentionally left untouched by sync.
- Upserts are keyed by:
  - `Library`: `External ID` (falls back to source work ID when an upstream external ID is unavailable)
  - `Passages`: `External Passage ID` when present, else `Fingerprint Hash`
