# Local Semantic Search for Quotes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local, on-device semantic + keyword + metadata-filtered search experience over Archi's existing `passages` table. No chat / LLM / synthesis in v1.

**Architecture:** New `packages/search` package wraps the embedding model (bge-small ONNX via `@xenova/transformers`), the vector store (`sqlite-vec` extension on the existing better-sqlite3 DB), and the hybrid retriever (vector + FTS5 fused via Reciprocal Rank Fusion). A new "Search" screen and global `⌘K` bar in `apps/desktop` consume a small IPC surface. Indexing runs as a background batch loop hooked into existing sync completion.

**Tech Stack:** TypeScript ESM (NodeNext), pnpm workspaces, better-sqlite3, sqlite-vec, @xenova/transformers (ONNX Runtime), SQLite FTS5, Electron 31, React 18, Vite, Vitest, electron-builder 24.

**Spec:** `docs/superpowers/specs/2026-06-02-local-rag-semantic-search-design.md`

---

## File Structure

### Created

- `packages/search/package.json`
- `packages/search/tsconfig.json`
- `packages/search/src/index.ts` — package entry, re-exports
- `packages/search/src/types.ts` — public types (`SearchQuery`, `SearchResult`, `IndexerStatus`, etc.)
- `packages/search/src/embedding/embeddingService.ts`
- `packages/search/src/embedding/modelPaths.ts` — resolves bundled vs packaged ONNX path
- `packages/search/src/indexer/indexerService.ts`
- `packages/search/src/query/rrf.ts` — Reciprocal Rank Fusion utility
- `packages/search/src/query/filterSql.ts` — builds the candidate-set SQL from filters
- `packages/search/src/query/snippetBuilder.ts` — assembles result snippets
- `packages/search/src/query/searchService.ts`
- `packages/search/src/repositories/searchRepository.ts`
- `packages/search/tests/fixtures/canonicalCorpus.ts` — ~30 hand-picked passages with known semantic relationships
- `packages/search/tests/embeddingService.test.ts`
- `packages/search/tests/indexerService.test.ts`
- `packages/search/tests/searchService.test.ts`
- `packages/search/tests/rrf.test.ts`
- `apps/desktop/src/main/searchModule.ts` — wires EmbeddingService + IndexerService + SearchService into main
- `apps/desktop/src/main/ipc/searchIpc.ts` — IPC handlers for `search.query` and `search.indexerStatus`
- `apps/desktop/src/renderer/screens/SearchScreen.tsx`
- `apps/desktop/src/renderer/components/GlobalSearchBar.tsx`
- `apps/desktop/src/renderer/components/SearchFilterChips.tsx`
- `apps/desktop/src/renderer/components/SearchResultCard.tsx`
- `apps/desktop/src/renderer/components/IndexingBanner.tsx`
- `apps/desktop/src/renderer/components/FindSimilarButton.tsx`
- `apps/desktop/resources/models/bge-small-en-v1.5/` — ONNX assets (downloaded by script in Task 4)
- `apps/desktop/scripts/fetch-embedding-model.mjs` — one-time download of bge-small ONNX files

### Modified

- `packages/core/src/db/client.ts` — load sqlite-vec extension after pragmas
- `packages/core/src/db/migrations.ts` — add `version: 3` migration
- `packages/core/package.json` — add `sqlite-vec` runtime dependency
- `packages/search/package.json` — set workspace deps on `@archi/core`, `@xenova/transformers`, `sqlite-vec`
- `apps/desktop/package.json` — add `@archi/search` workspace dep
- `apps/desktop/src/preload/index.ts` — expose `window.archi.search.*` methods
- `apps/desktop/src/main/index.ts` — instantiate `searchModule`, hook `indexer.tick()` into sync completion
- `apps/desktop/src/renderer/App.tsx` — add Search screen route + global search bar mount
- `apps/desktop/src/renderer/screens/PassagesScreen.tsx` (or equivalent) — add `<FindSimilarButton>` to each row
- `apps/desktop/electron-builder.yml` — `asarUnpack` for sqlite-vec; `extraResources` for ONNX model
- `pnpm-workspace.yaml` — (no change; already globs `packages/*`)

---

## Task 1: Scaffold `packages/search` workspace package

**Files:**
- Create: `packages/search/package.json`
- Create: `packages/search/tsconfig.json`
- Create: `packages/search/src/index.ts`
- Create: `packages/search/src/types.ts`
- Create: `packages/search/tests/.gitkeep`

- [ ] **Step 1: Create `packages/search/package.json`**

Mirror the shape of `packages/core/package.json`:

```json
{
  "name": "@archi/search",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "eslint src --ext .ts",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@archi/core": "workspace:*",
    "@xenova/transformers": "^2.17.2",
    "better-sqlite3": "^11.10.0",
    "sqlite-vec": "^0.1.6"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12"
  }
}
```

- [ ] **Step 2: Create `packages/search/tsconfig.json`**

Mirror `packages/core/tsconfig.json` (read it first to copy exactly):

```bash
cp packages/core/tsconfig.json packages/search/tsconfig.json
```

- [ ] **Step 3: Create `packages/search/src/types.ts`**

```ts
export type SearchFilters = {
  work_ids?: string[];
  creator?: string;
  labels?: string[];
  is_starred?: boolean;
  is_archived?: boolean;
  is_hidden?: boolean;
  marker_color?: string;
  work_type?: string;
  marked_after?: string;
  marked_before?: string;
};

export type SearchQuery = {
  text: string;
  filters: SearchFilters;
  limit: number;
};

export type SearchResult = {
  passage_id: string;
  body: string;
  reader_note?: string;
  snippet: string;
  work: {
    id: string;
    display_title: string;
    creator?: string;
    cover_image_url?: string;
  };
  position?: string;
  marked_at?: string;
  labels: string[];
  is_starred: boolean;
  scores: {
    fused: number;
    vector_distance?: number;
    bm25?: number;
  };
  matched_via: "vector" | "fts5" | "both";
};

export type SearchResponse = {
  query: string;
  filters: SearchFilters;
  results: SearchResult[];
  total_candidates: number;
  duration_ms: number;
};

export type IndexerStatus = {
  status: "idle" | "running" | "failed" | "unavailable";
  total: number;
  indexed: number;
  failed: number;
  lastError?: string;
};

export const EMBEDDING_DIM = 384;
export const EMBEDDING_MODEL_ID = "bge-small-en-v1.5@v1";
```

- [ ] **Step 4: Create `packages/search/src/index.ts`**

```ts
export * from "./types.js";
```

- [ ] **Step 5: Install deps and verify it builds**

```bash
pnpm install
pnpm --filter @archi/search build
pnpm --filter @archi/search typecheck
```

Expected: both succeed with no output errors.

- [ ] **Step 6: Commit**

```bash
git add packages/search apps/desktop/package.json pnpm-lock.yaml
git commit -m "search: scaffold @archi/search package"
```

---

## Task 2: Load `sqlite-vec` extension in `openCoreDatabase`

**Files:**
- Modify: `packages/core/package.json` — add `sqlite-vec` dep
- Modify: `packages/core/src/db/client.ts`
- Create: `packages/core/tests/client.test.ts`

- [ ] **Step 1: Add sqlite-vec to `@archi/core`**

```bash
pnpm --filter @archi/core add sqlite-vec@^0.1.6
```

- [ ] **Step 2: Write failing test for extension load**

Create `packages/core/tests/client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { openCoreDatabase } from "../src/db/client.js";

describe("openCoreDatabase", () => {
  it("loads the sqlite-vec extension and exposes vec_version()", () => {
    const db = openCoreDatabase(":memory:");
    const row = db.prepare("SELECT vec_version() AS v").get() as { v: string };
    expect(row.v).toMatch(/^v?\d+\.\d+/);
    db.close();
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

```bash
pnpm --filter @archi/core test
```

Expected: FAIL with `no such function: vec_version` or similar.

- [ ] **Step 4: Implement extension loading**

Edit `packages/core/src/db/client.ts`:

```ts
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { MIGRATIONS } from "./migrations.js";

export type CoreDatabase = Database.Database;

export function openCoreDatabase(path: string): CoreDatabase {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  sqliteVec.load(db);
  applyMigrations(db);
  return db;
}

function applyMigrations(db: CoreDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const existingRows = db.prepare("SELECT version FROM migrations").all() as Array<{ version: number }>;
  const existing = new Set(existingRows.map((row) => row.version));

  const transaction = db.transaction(() => {
    for (const migration of MIGRATIONS) {
      if (existing.has(migration.version)) {
        continue;
      }
      db.exec(migration.sql);
      db.prepare("INSERT INTO migrations(version, applied_at) VALUES (?, ?)").run(migration.version, new Date().toISOString());
    }
  });

  transaction();
}
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
pnpm --filter @archi/core test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "core: load sqlite-vec extension in openCoreDatabase"
```

---

## Task 3: Migration v3 — vector + FTS5 + state tables and triggers

**Files:**
- Modify: `packages/core/src/db/migrations.ts`
- Create: `packages/core/tests/migration-v3.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/migration-v3.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { openCoreDatabase } from "../src/db/client.js";

describe("migration v3 (semantic search)", () => {
  it("creates passage_embeddings, passages_fts, and embedding_state", () => {
    const db = openCoreDatabase(":memory:");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','virtual') OR sql LIKE 'CREATE VIRTUAL TABLE%' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = new Set(tables.map((t) => t.name));
    expect(names.has("passage_embeddings")).toBe(true);
    expect(names.has("passages_fts")).toBe(true);
    expect(names.has("embedding_state")).toBe(true);
    db.close();
  });

  it("FTS5 trigger inserts on passage insert", () => {
    const db = openCoreDatabase(":memory:");
    const ingestedAt = "2026-06-02T00:00:00Z";
    db.prepare(
      `INSERT INTO works (id, ingest_source, display_title, raw_title, work_type, first_ingested_at)
       VALUES ('w1','device-export','Meditations','Meditations','book',?)`
    ).run(ingestedAt);
    db.prepare(
      `INSERT INTO passages (id, work_id, body, ingested_at, updated_at, fingerprint_hash)
       VALUES ('p1','w1','Anger cannot be dishonest.',?,?, 'fp1')`
    ).run(ingestedAt, ingestedAt);

    const row = db
      .prepare("SELECT body FROM passages_fts WHERE passages_fts MATCH 'anger'")
      .get() as { body: string } | undefined;
    expect(row?.body).toBe("Anger cannot be dishonest.");
    db.close();
  });

  it("FTS5 trigger removes on passage delete", () => {
    const db = openCoreDatabase(":memory:");
    const ingestedAt = "2026-06-02T00:00:00Z";
    db.prepare(
      `INSERT INTO works (id, ingest_source, display_title, raw_title, work_type, first_ingested_at)
       VALUES ('w1','device-export','Meditations','Meditations','book',?)`
    ).run(ingestedAt);
    db.prepare(
      `INSERT INTO passages (id, work_id, body, ingested_at, updated_at, fingerprint_hash)
       VALUES ('p1','w1','Anger cannot be dishonest.',?,?, 'fp1')`
    ).run(ingestedAt, ingestedAt);

    db.prepare("DELETE FROM passages WHERE id = 'p1'").run();

    const row = db
      .prepare("SELECT body FROM passages_fts WHERE passages_fts MATCH 'anger'")
      .get();
    expect(row).toBeUndefined();
    db.close();
  });

  it("updating passage body clears embedding_state and passage_embeddings rows", () => {
    const db = openCoreDatabase(":memory:");
    const ingestedAt = "2026-06-02T00:00:00Z";
    db.prepare(
      `INSERT INTO works (id, ingest_source, display_title, raw_title, work_type, first_ingested_at)
       VALUES ('w1','device-export','Meditations','Meditations','book',?)`
    ).run(ingestedAt);
    db.prepare(
      `INSERT INTO passages (id, work_id, body, ingested_at, updated_at, fingerprint_hash)
       VALUES ('p1','w1','original body',?,?, 'fp1')`
    ).run(ingestedAt, ingestedAt);
    db.prepare(
      `INSERT INTO embedding_state (passage_id, model_id, embedded_at, source_hash, status)
       VALUES ('p1','bge-small-en-v1.5@v1',?, 'hash1','ok')`
    ).run(ingestedAt);
    const zeroVec = Buffer.alloc(384 * 4);
    db.prepare("INSERT INTO passage_embeddings (passage_id, embedding) VALUES ('p1', ?)").run(zeroVec);

    db.prepare("UPDATE passages SET body = 'edited body' WHERE id = 'p1'").run();

    const stateRow = db.prepare("SELECT * FROM embedding_state WHERE passage_id = 'p1'").get();
    const vecRow = db.prepare("SELECT * FROM passage_embeddings WHERE passage_id = 'p1'").get();
    expect(stateRow).toBeUndefined();
    expect(vecRow).toBeUndefined();
    db.close();
  });
});
```

- [ ] **Step 2: Run the tests — expect failures**

```bash
pnpm --filter @archi/core test
```

Expected: all four new tests FAIL (tables don't exist).

- [ ] **Step 3: Add migration v3**

Edit `packages/core/src/db/migrations.ts` — append a third entry to the array:

```ts
export const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      // ... existing v1 sql unchanged ...
    `
  },
  {
    version: 2,
    sql: `
      // ... existing v2 sql unchanged ...
    `
  },
  {
    version: 3,
    sql: `
      CREATE VIRTUAL TABLE IF NOT EXISTS passage_embeddings USING vec0(
        passage_id TEXT PRIMARY KEY,
        embedding  FLOAT[384]
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts USING fts5(
        body,
        reader_note,
        content='passages',
        content_rowid='rowid',
        tokenize='porter unicode61'
      );

      CREATE TABLE IF NOT EXISTS embedding_state (
        passage_id   TEXT PRIMARY KEY REFERENCES passages(id) ON DELETE CASCADE,
        model_id     TEXT NOT NULL,
        embedded_at  TEXT NOT NULL,
        source_hash  TEXT NOT NULL,
        status       TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS embedding_state_status_idx ON embedding_state(status);
      CREATE INDEX IF NOT EXISTS embedding_state_model_idx  ON embedding_state(model_id);

      CREATE TRIGGER IF NOT EXISTS passages_ai AFTER INSERT ON passages BEGIN
        INSERT INTO passages_fts(rowid, body, reader_note)
        VALUES (new.rowid, new.body, new.reader_note);
      END;

      CREATE TRIGGER IF NOT EXISTS passages_ad AFTER DELETE ON passages BEGIN
        INSERT INTO passages_fts(passages_fts, rowid, body, reader_note)
        VALUES ('delete', old.rowid, old.body, old.reader_note);
        DELETE FROM passage_embeddings WHERE passage_id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS passages_au AFTER UPDATE OF body, reader_note ON passages BEGIN
        INSERT INTO passages_fts(passages_fts, rowid, body, reader_note)
        VALUES ('delete', old.rowid, old.body, old.reader_note);
        INSERT INTO passages_fts(rowid, body, reader_note)
        VALUES (new.rowid, new.body, new.reader_note);
        DELETE FROM embedding_state WHERE passage_id = new.id;
        DELETE FROM passage_embeddings WHERE passage_id = new.id;
      END;

      INSERT INTO passages_fts(passages_fts) VALUES ('rebuild');
    `
  }
];
```

(Keep the existing v1 and v2 entries verbatim — don't remove them.)

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
pnpm --filter @archi/core test
```

Expected: all four new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "core: add migration v3 — vector, FTS5, embedding_state tables and triggers"
```

---

## Task 4: Bundle bge-small-en-v1.5 ONNX assets

**Files:**
- Create: `apps/desktop/scripts/fetch-embedding-model.mjs`
- Modify: `apps/desktop/package.json` — add `fetch:model` script and call it from `build:deps` or similar
- Create: `apps/desktop/resources/models/.gitkeep`
- Modify: `.gitignore` — ignore `apps/desktop/resources/models/*` (we don't commit ONNX blobs)

- [ ] **Step 1: Add the model directory placeholder**

```bash
mkdir -p apps/desktop/resources/models
touch apps/desktop/resources/models/.gitkeep
```

- [ ] **Step 2: Ignore ONNX blobs in git**

Append to `.gitignore`:

```
# Bundled embedding model assets (fetched at build time)
apps/desktop/resources/models/bge-small-en-v1.5/
!apps/desktop/resources/models/.gitkeep
```

- [ ] **Step 3: Write the fetch script**

Create `apps/desktop/scripts/fetch-embedding-model.mjs`:

```js
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TARGET_DIR = join(ROOT, "resources/models/bge-small-en-v1.5");

// Files matched by @xenova/transformers' default Xenova/bge-small-en-v1.5 layout.
const BASE = "https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/main";
const FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx"
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchFile(relPath) {
  const dest = join(TARGET_DIR, relPath);
  await mkdir(dirname(dest), { recursive: true });
  if (await exists(dest)) {
    console.log(`[fetch-model] cached ${relPath}`);
    return;
  }
  const url = `${BASE}/${relPath}`;
  console.log(`[fetch-model] downloading ${relPath}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed ${url}: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

async function main() {
  await mkdir(TARGET_DIR, { recursive: true });
  for (const f of FILES) await fetchFile(f);
  console.log("[fetch-model] complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Add a `fetch:model` script and run it once**

Edit `apps/desktop/package.json`'s `scripts` section to add:

```json
"fetch:model": "node ./scripts/fetch-embedding-model.mjs",
"prebuild": "pnpm run fetch:model",
"predev": "pnpm run fetch:model"
```

(Place these alongside the other scripts; preserve existing entries.)

Then run:

```bash
pnpm --filter @archi/desktop fetch:model
ls apps/desktop/resources/models/bge-small-en-v1.5
```

Expected: the listed files exist, including `onnx/model_quantized.onnx` (~33 MB).

- [ ] **Step 5: Update `electron-builder.yml` to bundle the model directory**

Add an `extraResources` block:

```yaml
appId: com.archi.desktop
productName: Archi
directories:
  output: release
  buildResources: assets
files:
  - dist/**/*
  - package.json
  - "!node_modules/@archi/*/src{,/**/*}"
  - "!node_modules/@archi/*/{test,tests,__tests__}{,/**/*}"
  - "!node_modules/@archi/*/tsconfig*.json"
asarUnpack:
  - "**/*.node"
  - "node_modules/sqlite-vec/**"
  - "node_modules/sqlite-vec-darwin-arm64/**"
  - "node_modules/sqlite-vec-darwin-x64/**"
extraResources:
  - from: resources/models
    to: models
mac:
  # ... unchanged ...
```

(Preserve everything else verbatim — only add the `asarUnpack` extra entries and the `extraResources` block.)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/scripts apps/desktop/package.json apps/desktop/resources/models/.gitkeep apps/desktop/electron-builder.yml .gitignore
git commit -m "desktop: bundle bge-small-en-v1.5 ONNX assets via prebuild fetch script"
```

---

## Task 5: `EmbeddingService` — wraps @xenova/transformers, dev + packaged path resolution

**Files:**
- Create: `packages/search/src/embedding/modelPaths.ts`
- Create: `packages/search/src/embedding/embeddingService.ts`
- Create: `packages/search/tests/embeddingService.test.ts`
- Modify: `packages/search/src/index.ts` — re-export

- [ ] **Step 1: Write the model-path resolver**

Create `packages/search/src/embedding/modelPaths.ts`:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolve where the bundled bge-small-en-v1.5 model lives.
 * Callers (Electron main) pass `bundledRoot` so this package stays Electron-agnostic.
 *
 * - In dev: `apps/desktop/resources/models`
 * - In packaged build: `process.resourcesPath/models` (from electron-builder extraResources)
 */
export function resolveBundledModelDir(bundledRoot: string): string {
  const candidate = join(bundledRoot, "bge-small-en-v1.5");
  if (!existsSync(candidate)) {
    throw new Error(`bge-small-en-v1.5 model not found at ${candidate}`);
  }
  return candidate;
}
```

- [ ] **Step 2: Write a failing test for embedding dimensionality and determinism**

Create `packages/search/tests/embeddingService.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EmbeddingService } from "../src/embedding/embeddingService.js";
import { EMBEDDING_DIM } from "../src/types.js";

// In tests we point at the desktop app's bundled model dir.
const TEST_MODEL_ROOT = join(__dirname, "../../../apps/desktop/resources/models");

describe("EmbeddingService", () => {
  it("produces a 384-dim vector", async () => {
    const svc = new EmbeddingService({ bundledModelRoot: TEST_MODEL_ROOT });
    const [vec] = await svc.embedBatch(["the quick brown fox"]);
    expect(vec).toHaveLength(EMBEDDING_DIM);
  }, 30_000);

  it("is deterministic across calls", async () => {
    const svc = new EmbeddingService({ bundledModelRoot: TEST_MODEL_ROOT });
    const [a] = await svc.embedBatch(["anger"]);
    const [b] = await svc.embedBatch(["anger"]);
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const cosine = dot / (Math.sqrt(na) * Math.sqrt(nb));
    expect(cosine).toBeGreaterThan(0.999);
  }, 30_000);

  it("batch and sequential results match within float epsilon", async () => {
    const svc = new EmbeddingService({ bundledModelRoot: TEST_MODEL_ROOT });
    const inputs = ["anger", "joy", "courage"];
    const batched = await svc.embedBatch(inputs);
    const sequential = await Promise.all(inputs.map((t) => svc.embedBatch([t]).then((v) => v[0])));
    for (let i = 0; i < batched.length; i++) {
      for (let j = 0; j < EMBEDDING_DIM; j++) {
        expect(Math.abs(batched[i][j] - sequential[i][j])).toBeLessThan(1e-3);
      }
    }
  }, 60_000);
});
```

- [ ] **Step 3: Run the test to confirm it fails**

```bash
pnpm --filter @archi/search test
```

Expected: FAIL — `EmbeddingService` class doesn't exist yet.

- [ ] **Step 4: Implement `EmbeddingService`**

Create `packages/search/src/embedding/embeddingService.ts`:

```ts
import { resolveBundledModelDir } from "./modelPaths.js";

type Pipeline = (input: string | string[], options?: Record<string, unknown>) => Promise<{ data: Float32Array; dims: number[] }>;

export type EmbeddingServiceOptions = {
  bundledModelRoot: string;
};

export class EmbeddingService {
  private readonly options: EmbeddingServiceOptions;
  private pipelineInstance: Pipeline | null = null;
  private loadPromise: Promise<Pipeline> | null = null;

  constructor(options: EmbeddingServiceOptions) {
    this.options = options;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) {
      return [];
    }
    const pipe = await this.ensureLoaded();
    const result = await pipe(texts, { pooling: "mean", normalize: true });
    const [batch, dim] = result.dims;
    const out: Float32Array[] = [];
    for (let i = 0; i < batch; i++) {
      out.push(result.data.slice(i * dim, (i + 1) * dim));
    }
    return out;
  }

  private async ensureLoaded(): Promise<Pipeline> {
    if (this.pipelineInstance) {
      return this.pipelineInstance;
    }
    if (!this.loadPromise) {
      this.loadPromise = this.load();
    }
    this.pipelineInstance = await this.loadPromise;
    return this.pipelineInstance;
  }

  private async load(): Promise<Pipeline> {
    const transformers = await import("@xenova/transformers");
    const modelDir = resolveBundledModelDir(this.options.bundledModelRoot);
    // Point transformers at our bundled model dir and disable any network fallback.
    transformers.env.localModelPath = this.options.bundledModelRoot;
    transformers.env.allowRemoteModels = false;
    transformers.env.allowLocalModels = true;
    const pipe = await transformers.pipeline("feature-extraction", "bge-small-en-v1.5", {
      quantized: true,
      local_files_only: true,
      cache_dir: modelDir
    });
    return pipe as unknown as Pipeline;
  }
}
```

- [ ] **Step 5: Re-export from package entry**

Edit `packages/search/src/index.ts`:

```ts
export * from "./types.js";
export { EmbeddingService } from "./embedding/embeddingService.js";
export { resolveBundledModelDir } from "./embedding/modelPaths.js";
```

- [ ] **Step 6: Run the tests to confirm they pass**

```bash
pnpm --filter @archi/search test
```

Expected: 3 tests PASS. First test takes ~5–10 s as the model loads.

- [ ] **Step 7: Commit**

```bash
git add packages/search
git commit -m "search: add EmbeddingService wrapping @xenova/transformers"
```

---

## Task 6: `SearchRepository` — prepared statements for vector + FTS5 + state

**Files:**
- Create: `packages/search/src/repositories/searchRepository.ts`
- Create: `packages/search/tests/searchRepository.test.ts`
- Modify: `packages/search/src/index.ts` — re-export

- [ ] **Step 1: Write the failing test**

Create `packages/search/tests/searchRepository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { openCoreDatabase } from "@archi/core";
import { SearchRepository } from "../src/repositories/searchRepository.js";
import { EMBEDDING_DIM, EMBEDDING_MODEL_ID } from "../src/types.js";

function makeVec(seed: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    v[i] = Math.sin(seed + i * 0.01);
  }
  return v;
}

function seedPassage(db: ReturnType<typeof openCoreDatabase>, id: string, body: string): void {
  const ts = "2026-06-02T00:00:00Z";
  db.prepare(
    `INSERT INTO works (id, ingest_source, display_title, raw_title, work_type, first_ingested_at)
     VALUES ('w1','device-export','Meditations','Meditations','book',?)
     ON CONFLICT(id) DO NOTHING`
  ).run(ts);
  db.prepare(
    `INSERT INTO passages (id, work_id, body, ingested_at, updated_at, fingerprint_hash)
     VALUES (?, 'w1', ?, ?, ?, ?)`
  ).run(id, body, ts, ts, `fp-${id}`);
}

describe("SearchRepository", () => {
  it("inserts and queries an embedding by passage_id", () => {
    const db = openCoreDatabase(":memory:");
    seedPassage(db, "p1", "anger cannot be dishonest");
    const repo = new SearchRepository(db);
    const vec = makeVec(1);

    repo.upsertEmbedding("p1", vec, "hash1");
    const rows = repo.knnByPassageIds(vec, ["p1"], 5);
    expect(rows.length).toBe(1);
    expect(rows[0].passage_id).toBe("p1");
    db.close();
  });

  it("returns FTS5 matches in candidate set", () => {
    const db = openCoreDatabase(":memory:");
    seedPassage(db, "p1", "anger cannot be dishonest");
    seedPassage(db, "p2", "joy is contagious");
    const repo = new SearchRepository(db);

    const rows = repo.ftsSearchInIds("anger", ["p1", "p2"]);
    expect(rows.length).toBe(1);
    expect(rows[0].passage_id).toBe("p1");
    db.close();
  });

  it("counts indexed and total passages", () => {
    const db = openCoreDatabase(":memory:");
    seedPassage(db, "p1", "anger cannot be dishonest");
    seedPassage(db, "p2", "joy is contagious");
    const repo = new SearchRepository(db);

    repo.upsertEmbedding("p1", makeVec(1), "hash1");

    expect(repo.countPassages()).toBe(2);
    expect(repo.countIndexed(EMBEDDING_MODEL_ID)).toBe(1);
    db.close();
  });

  it("returns unembedded passages for the given model", () => {
    const db = openCoreDatabase(":memory:");
    seedPassage(db, "p1", "alpha");
    seedPassage(db, "p2", "beta");
    const repo = new SearchRepository(db);

    repo.upsertEmbedding("p1", makeVec(1), "hash1");

    const pending = repo.fetchPendingForModel(EMBEDDING_MODEL_ID, 10);
    expect(pending.map((p) => p.id)).toEqual(["p2"]);
    db.close();
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
pnpm --filter @archi/search test searchRepository
```

Expected: FAIL — class doesn't exist.

- [ ] **Step 3: Implement `SearchRepository`**

Create `packages/search/src/repositories/searchRepository.ts`:

```ts
import type { CoreDatabase } from "@archi/core";
import { EMBEDDING_MODEL_ID } from "../types.js";

export type PendingPassage = {
  id: string;
  body: string;
};

export type KnnHit = {
  passage_id: string;
  distance: number;
};

export type FtsHit = {
  passage_id: string;
  bm25: number;
};

function vectorToBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export class SearchRepository {
  constructor(private readonly db: CoreDatabase) {}

  upsertEmbedding(passageId: string, vector: Float32Array, sourceHash: string): void {
    const ts = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db
        .prepare("INSERT OR REPLACE INTO passage_embeddings (passage_id, embedding) VALUES (?, ?)")
        .run(passageId, vectorToBuffer(vector));
      this.db
        .prepare(
          `INSERT OR REPLACE INTO embedding_state (passage_id, model_id, embedded_at, source_hash, status)
           VALUES (?, ?, ?, ?, 'ok')`
        )
        .run(passageId, EMBEDDING_MODEL_ID, ts, sourceHash);
    });
    tx();
  }

  recordEmbeddingFailure(passageId: string, sourceHash: string, errorMessage: string): void {
    const ts = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO embedding_state (passage_id, model_id, embedded_at, source_hash, status)
         VALUES (?, ?, ?, ?, 'failed')`
      )
      .run(passageId, EMBEDDING_MODEL_ID, ts, sourceHash);
    // We intentionally don't persist the error string per row to keep the table small;
    // a single rolling lastError is held in-memory by IndexerService.
    void errorMessage;
  }

  fetchPendingForModel(modelId: string, limit: number): PendingPassage[] {
    return this.db
      .prepare(
        `SELECT p.id AS id, p.body AS body
         FROM passages p
         LEFT JOIN embedding_state s
           ON s.passage_id = p.id AND s.model_id = ?
         WHERE s.passage_id IS NULL
            OR s.status != 'ok'
         LIMIT ?`
      )
      .all(modelId, limit) as PendingPassage[];
  }

  countPassages(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM passages").get() as { c: number };
    return Number(row.c);
  }

  countIndexed(modelId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM embedding_state WHERE model_id = ? AND status = 'ok'")
      .get(modelId) as { c: number };
    return Number(row.c);
  }

  countFailed(modelId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM embedding_state WHERE model_id = ? AND status = 'failed'")
      .get(modelId) as { c: number };
    return Number(row.c);
  }

  knnByPassageIds(query: Float32Array, candidateIds: string[], k: number): KnnHit[] {
    if (candidateIds.length === 0) {
      return [];
    }
    const placeholders = candidateIds.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT passage_id, distance
         FROM passage_embeddings
         WHERE embedding MATCH ?
           AND k = ?
           AND passage_id IN (${placeholders})
         ORDER BY distance`
      )
      .all(vectorToBuffer(query), k, ...candidateIds) as KnnHit[];
  }

  ftsSearchInIds(query: string, candidateIds: string[]): FtsHit[] {
    if (candidateIds.length === 0 || query.trim().length === 0) {
      return [];
    }
    const placeholders = candidateIds.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT p.id AS passage_id, bm25(passages_fts) AS bm25
         FROM passages_fts
         JOIN passages p ON p.rowid = passages_fts.rowid
         WHERE passages_fts MATCH ?
           AND p.id IN (${placeholders})
         ORDER BY bm25`
      )
      .all(query, ...candidateIds) as FtsHit[];
  }

  // Used to build the candidate set when the user has filters but no free-text query.
  fetchCandidatesSql(sql: string, params: unknown[]): string[] {
    return (this.db.prepare(sql).all(...params) as Array<{ id: string }>).map((r) => r.id);
  }
}
```

- [ ] **Step 4: Re-export from package entry**

Edit `packages/search/src/index.ts`:

```ts
export * from "./types.js";
export { EmbeddingService } from "./embedding/embeddingService.js";
export { resolveBundledModelDir } from "./embedding/modelPaths.js";
export { SearchRepository } from "./repositories/searchRepository.js";
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
pnpm --filter @archi/search test searchRepository
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/search
git commit -m "search: add SearchRepository with KNN, FTS5, and indexing-state queries"
```

---

## Task 7: `IndexerService` — backfill loop with batching, status reporting

**Files:**
- Create: `packages/search/src/indexer/indexerService.ts`
- Create: `packages/search/tests/indexerService.test.ts`
- Modify: `packages/search/src/index.ts` — re-export

- [ ] **Step 1: Write the failing test**

Create `packages/search/tests/indexerService.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { openCoreDatabase } from "@archi/core";
import { EmbeddingService } from "../src/embedding/embeddingService.js";
import { IndexerService } from "../src/indexer/indexerService.js";
import { SearchRepository } from "../src/repositories/searchRepository.js";

const TEST_MODEL_ROOT = join(__dirname, "../../../apps/desktop/resources/models");

function seedPassages(db: ReturnType<typeof openCoreDatabase>, n: number): void {
  const ts = "2026-06-02T00:00:00Z";
  db.prepare(
    `INSERT INTO works (id, ingest_source, display_title, raw_title, work_type, first_ingested_at)
     VALUES ('w1','device-export','Meditations','Meditations','book',?)
     ON CONFLICT(id) DO NOTHING`
  ).run(ts);
  for (let i = 0; i < n; i++) {
    db.prepare(
      `INSERT INTO passages (id, work_id, body, ingested_at, updated_at, fingerprint_hash)
       VALUES (?, 'w1', ?, ?, ?, ?)`
    ).run(`p${i}`, `body number ${i}`, ts, ts, `fp${i}`);
  }
}

describe("IndexerService", () => {
  it("backfills all unembedded passages and reports idle when done", async () => {
    const db = openCoreDatabase(":memory:");
    seedPassages(db, 5);
    const embedder = new EmbeddingService({ bundledModelRoot: TEST_MODEL_ROOT });
    const repo = new SearchRepository(db);
    const indexer = new IndexerService({ db, repo, embedder, batchSize: 2 });

    await indexer.runUntilIdle();

    expect(repo.countIndexed("bge-small-en-v1.5@v1")).toBe(5);
    expect(indexer.getStatus().status).toBe("idle");
    db.close();
  }, 60_000);

  it("is idempotent — re-running indexes nothing new", async () => {
    const db = openCoreDatabase(":memory:");
    seedPassages(db, 3);
    const embedder = new EmbeddingService({ bundledModelRoot: TEST_MODEL_ROOT });
    const repo = new SearchRepository(db);
    const indexer = new IndexerService({ db, repo, embedder, batchSize: 10 });

    await indexer.runUntilIdle();
    const firstCount = repo.countIndexed("bge-small-en-v1.5@v1");
    await indexer.runUntilIdle();
    expect(repo.countIndexed("bge-small-en-v1.5@v1")).toBe(firstCount);
    db.close();
  }, 60_000);
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
pnpm --filter @archi/search test indexerService
```

Expected: FAIL — `IndexerService` doesn't exist.

- [ ] **Step 3: Implement `IndexerService`**

Create `packages/search/src/indexer/indexerService.ts`:

```ts
import crypto from "node:crypto";
import type { CoreDatabase } from "@archi/core";
import type { EmbeddingService } from "../embedding/embeddingService.js";
import type { SearchRepository } from "../repositories/searchRepository.js";
import { EMBEDDING_MODEL_ID, type IndexerStatus } from "../types.js";

export type IndexerServiceOptions = {
  db: CoreDatabase;
  repo: SearchRepository;
  embedder: EmbeddingService;
  batchSize?: number;
};

function hashBody(body: string): string {
  const normalized = body.trim().replace(/\s+/g, " ").toLowerCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export class IndexerService {
  private readonly db: CoreDatabase;
  private readonly repo: SearchRepository;
  private readonly embedder: EmbeddingService;
  private readonly batchSize: number;
  private status: IndexerStatus["status"] = "idle";
  private lastError: string | undefined;
  private running = false;

  constructor(options: IndexerServiceOptions) {
    this.db = options.db;
    this.repo = options.repo;
    this.embedder = options.embedder;
    this.batchSize = options.batchSize ?? 32;
  }

  getStatus(): IndexerStatus {
    return {
      status: this.status,
      total: this.repo.countPassages(),
      indexed: this.repo.countIndexed(EMBEDDING_MODEL_ID),
      failed: this.repo.countFailed(EMBEDDING_MODEL_ID),
      lastError: this.lastError
    };
  }

  /** Process pending work until idle. Safe to call again concurrently — second caller no-ops. */
  async runUntilIdle(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      while (true) {
        const batch = this.repo.fetchPendingForModel(EMBEDDING_MODEL_ID, this.batchSize);
        if (batch.length === 0) {
          this.status = "idle";
          return;
        }
        this.status = "running";
        try {
          const vectors = await this.embedder.embedBatch(batch.map((p) => p.body));
          for (let i = 0; i < batch.length; i++) {
            this.repo.upsertEmbedding(batch[i].id, vectors[i], hashBody(batch[i].body));
          }
        } catch (err) {
          this.lastError = err instanceof Error ? err.message : String(err);
          for (const p of batch) {
            this.repo.recordEmbeddingFailure(p.id, hashBody(p.body), this.lastError);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Fire-and-forget kick. Used from sync completion handlers. */
  tick(): void {
    void this.runUntilIdle();
  }

  markUnavailable(reason: string): void {
    this.status = "unavailable";
    this.lastError = reason;
  }
}
```

- [ ] **Step 4: Re-export from package entry**

Edit `packages/search/src/index.ts`:

```ts
export * from "./types.js";
export { EmbeddingService } from "./embedding/embeddingService.js";
export { resolveBundledModelDir } from "./embedding/modelPaths.js";
export { SearchRepository } from "./repositories/searchRepository.js";
export { IndexerService } from "./indexer/indexerService.js";
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
pnpm --filter @archi/search test indexerService
```

Expected: 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/search
git commit -m "search: add IndexerService — batched backfill with idempotency"
```

---

## Task 8: RRF utility (pure function)

**Files:**
- Create: `packages/search/src/query/rrf.ts`
- Create: `packages/search/tests/rrf.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/search/tests/rrf.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fuseRrf } from "../src/query/rrf.js";

describe("fuseRrf", () => {
  it("returns top items by combined rank", () => {
    const vec = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const fts = [{ id: "b" }, { id: "a" }, { id: "d" }];
    const fused = fuseRrf([vec, fts], (item) => item.id, { k: 60, limit: 10 });
    expect(fused.map((f) => f.key)).toEqual(["a", "b", "c", "d"]);
  });

  it("preserves source tags", () => {
    const vec = [{ id: "a" }, { id: "b" }];
    const fts = [{ id: "b" }, { id: "c" }];
    const fused = fuseRrf([vec, fts], (item) => item.id, { k: 60, limit: 10 });
    const byKey = new Map(fused.map((f) => [f.key, f.sourceIndices.sort()]));
    expect(byKey.get("a")).toEqual([0]);
    expect(byKey.get("b")).toEqual([0, 1]);
    expect(byKey.get("c")).toEqual([1]);
  });

  it("respects the limit", () => {
    const lists = [[{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]];
    const fused = fuseRrf(lists, (item) => item.id, { k: 60, limit: 2 });
    expect(fused.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
pnpm --filter @archi/search test rrf
```

Expected: FAIL.

- [ ] **Step 3: Implement `fuseRrf`**

Create `packages/search/src/query/rrf.ts`:

```ts
export type FusedHit = {
  key: string;
  score: number;
  sourceIndices: number[];
};

export function fuseRrf<T>(
  rankedLists: T[][],
  keyOf: (item: T) => string,
  options: { k: number; limit: number }
): FusedHit[] {
  const acc = new Map<string, FusedHit>();
  rankedLists.forEach((list, listIdx) => {
    list.forEach((item, rank) => {
      const key = keyOf(item);
      const contribution = 1 / (options.k + rank);
      const existing = acc.get(key);
      if (existing) {
        existing.score += contribution;
        if (!existing.sourceIndices.includes(listIdx)) {
          existing.sourceIndices.push(listIdx);
        }
      } else {
        acc.set(key, { key, score: contribution, sourceIndices: [listIdx] });
      }
    });
  });
  return Array.from(acc.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit);
}
```

- [ ] **Step 4: Run the test — confirm it passes**

```bash
pnpm --filter @archi/search test rrf
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/search
git commit -m "search: add Reciprocal Rank Fusion utility"
```

---

## Task 9: Filter SQL builder + `SearchService`

**Files:**
- Create: `packages/search/src/query/filterSql.ts`
- Create: `packages/search/src/query/searchService.ts`
- Create: `packages/search/tests/fixtures/canonicalCorpus.ts`
- Create: `packages/search/tests/searchService.test.ts`
- Modify: `packages/search/src/index.ts` — re-export

- [ ] **Step 1: Write the filter SQL builder**

Create `packages/search/src/query/filterSql.ts`:

```ts
import type { SearchFilters } from "../types.js";

export type CandidateSql = {
  sql: string;
  params: unknown[];
};

/**
 * Build a SELECT that returns the candidate set of passage ids matching the
 * structured filters. Caller is expected to merge in archive/hidden defaults
 * from Settings before calling.
 */
export function buildCandidateSql(filters: SearchFilters): CandidateSql {
  const where: string[] = [];
  const params: unknown[] = [];

  const includeArchived = filters.is_archived === true;
  const includeHidden = filters.is_hidden === true;
  if (!includeArchived) {
    where.push("p.is_archived = 0");
  }
  if (!includeHidden) {
    where.push("p.is_hidden = 0");
  }

  if (filters.creator !== undefined) {
    where.push("w.creator = ?");
    params.push(filters.creator);
  }
  if (filters.work_type !== undefined) {
    where.push("w.work_type = ?");
    params.push(filters.work_type);
  }
  if (filters.work_ids !== undefined && filters.work_ids.length > 0) {
    where.push(`p.work_id IN (${filters.work_ids.map(() => "?").join(",")})`);
    params.push(...filters.work_ids);
  }
  if (filters.is_starred === true) {
    where.push("p.is_starred = 1");
  }
  if (filters.marker_color !== undefined) {
    where.push("p.marker_color = ?");
    params.push(filters.marker_color);
  }
  if (filters.marked_after !== undefined) {
    where.push("p.marked_at >= ?");
    params.push(filters.marked_after);
  }
  if (filters.marked_before !== undefined) {
    where.push("p.marked_at <= ?");
    params.push(filters.marked_before);
  }
  if (filters.labels !== undefined && filters.labels.length > 0) {
    // passages.labels_json is a TEXT JSON array. Intersect via json_each.
    where.push(`EXISTS (
      SELECT 1 FROM json_each(p.labels_json)
      WHERE json_each.value IN (${filters.labels.map(() => "?").join(",")})
    )`);
    params.push(...filters.labels);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `
    SELECT p.id AS id
    FROM passages p
    JOIN works w ON p.work_id = w.id
    ${whereClause}
  `;
  return { sql, params };
}
```

- [ ] **Step 2: Write the canonical-corpus fixture**

Create `packages/search/tests/fixtures/canonicalCorpus.ts`:

```ts
export type FixturePassage = {
  id: string;
  work_id: string;
  body: string;
  creator: string;
  display_title: string;
  is_starred?: boolean;
  marker_color?: string;
  marked_at?: string;
};

export type FixtureWork = {
  id: string;
  display_title: string;
  creator: string;
  work_type: string;
};

export const FIXTURE_WORKS: FixtureWork[] = [
  { id: "w-aurelius", display_title: "Meditations", creator: "Marcus Aurelius", work_type: "book" },
  { id: "w-seneca", display_title: "Letters from a Stoic", creator: "Seneca", work_type: "book" },
  { id: "w-aristotle", display_title: "Nicomachean Ethics", creator: "Aristotle", work_type: "book" }
];

export const FIXTURE_PASSAGES: FixturePassage[] = [
  { id: "p-anger-1", work_id: "w-aurelius", body: "Anger cannot be dishonest.", creator: "Marcus Aurelius", display_title: "Meditations", is_starred: true },
  { id: "p-anger-2", work_id: "w-aurelius", body: "Whenever you are about to find fault with someone, remember that anger is short madness.", creator: "Marcus Aurelius", display_title: "Meditations" },
  { id: "p-anger-3", work_id: "w-seneca", body: "The greatest remedy for anger is delay.", creator: "Seneca", display_title: "Letters from a Stoic" },
  { id: "p-death", work_id: "w-aurelius", body: "Do not despise death, but be well content with it.", creator: "Marcus Aurelius", display_title: "Meditations" },
  { id: "p-time", work_id: "w-seneca", body: "It is not that we have a short time to live, but that we waste a lot of it.", creator: "Seneca", display_title: "Letters from a Stoic" },
  { id: "p-friend", work_id: "w-aristotle", body: "A friend to all is a friend to none.", creator: "Aristotle", display_title: "Nicomachean Ethics" },
  { id: "p-virtue", work_id: "w-aristotle", body: "We are what we repeatedly do. Excellence is a habit.", creator: "Aristotle", display_title: "Nicomachean Ethics" }
];
```

- [ ] **Step 3: Write the failing test for `SearchService`**

Create `packages/search/tests/searchService.test.ts`:

```ts
import { describe, expect, it, beforeAll } from "vitest";
import { join } from "node:path";
import { openCoreDatabase, type CoreDatabase } from "@archi/core";
import { EmbeddingService } from "../src/embedding/embeddingService.js";
import { IndexerService } from "../src/indexer/indexerService.js";
import { SearchRepository } from "../src/repositories/searchRepository.js";
import { SearchService } from "../src/query/searchService.js";
import { FIXTURE_PASSAGES, FIXTURE_WORKS } from "./fixtures/canonicalCorpus.js";

const TEST_MODEL_ROOT = join(__dirname, "../../../apps/desktop/resources/models");

function seedFixture(db: CoreDatabase): void {
  const ts = "2026-06-02T00:00:00Z";
  for (const w of FIXTURE_WORKS) {
    db.prepare(
      `INSERT INTO works (id, ingest_source, display_title, raw_title, creator, work_type, first_ingested_at)
       VALUES (?, 'device-export', ?, ?, ?, ?, ?)`
    ).run(w.id, w.display_title, w.display_title, w.creator, w.work_type, ts);
  }
  for (const p of FIXTURE_PASSAGES) {
    db.prepare(
      `INSERT INTO passages (id, work_id, body, is_starred, marker_color, marked_at, ingested_at, updated_at, fingerprint_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(p.id, p.work_id, p.body, p.is_starred ? 1 : 0, p.marker_color ?? null, p.marked_at ?? ts, ts, ts, `fp-${p.id}`);
  }
}

describe("SearchService", () => {
  let db: CoreDatabase;
  let service: SearchService;

  beforeAll(async () => {
    db = openCoreDatabase(":memory:");
    seedFixture(db);
    const repo = new SearchRepository(db);
    const embedder = new EmbeddingService({ bundledModelRoot: TEST_MODEL_ROOT });
    const indexer = new IndexerService({ db, repo, embedder, batchSize: 32 });
    await indexer.runUntilIdle();
    service = new SearchService({ db, repo, embedder });
  }, 120_000);

  it("filters by creator and ranks Aurelius-on-anger highest for 'anger'", async () => {
    const res = await service.query({
      text: "anger",
      filters: { creator: "Marcus Aurelius" },
      limit: 5
    });
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0].passage_id.startsWith("p-anger")).toBe(true);
    expect(res.results.every((r) => r.work.creator === "Marcus Aurelius")).toBe(true);
  }, 30_000);

  it("returns FTS5 match for proper-noun queries", async () => {
    const res = await service.query({
      text: "Meditations",
      filters: {},
      limit: 10
    });
    expect(res.results.length).toBeGreaterThan(0);
  }, 30_000);

  it("returns recent passages when text is empty", async () => {
    const res = await service.query({ text: "", filters: {}, limit: 50 });
    expect(res.results.length).toBe(FIXTURE_PASSAGES.length);
  });

  it("no-ops on very short text", async () => {
    const res = await service.query({ text: "a", filters: {}, limit: 50 });
    // With <2 chars we fall back to "browse mode" so behavior matches empty-text.
    expect(res.results.length).toBe(FIXTURE_PASSAGES.length);
  });
});
```

- [ ] **Step 4: Run the test — confirm it fails**

```bash
pnpm --filter @archi/search test searchService
```

Expected: FAIL — `SearchService` doesn't exist.

- [ ] **Step 5: Implement `SearchService`**

Create `packages/search/src/query/searchService.ts`:

```ts
import type { CoreDatabase } from "@archi/core";
import type { EmbeddingService } from "../embedding/embeddingService.js";
import type { SearchRepository } from "../repositories/searchRepository.js";
import { buildCandidateSql } from "./filterSql.js";
import { fuseRrf } from "./rrf.js";
import type {
  SearchFilters,
  SearchQuery,
  SearchResponse,
  SearchResult
} from "../types.js";

export type SearchServiceOptions = {
  db: CoreDatabase;
  repo: SearchRepository;
  embedder: EmbeddingService;
  defaultIncludeArchived?: boolean;
  defaultIncludeHidden?: boolean;
};

const MIN_QUERY_LENGTH = 2;
const RRF_K = 60;

export class SearchService {
  constructor(private readonly options: SearchServiceOptions) {}

  async query(q: SearchQuery): Promise<SearchResponse> {
    const start = Date.now();
    const filters = this.resolveDefaults(q.filters);
    const candidate = buildCandidateSql(filters);
    const candidateIds = this.options.repo.fetchCandidatesSql(candidate.sql, candidate.params);

    const trimmed = q.text.trim();
    const isBrowse = trimmed.length < MIN_QUERY_LENGTH;

    let results: SearchResult[];
    if (isBrowse) {
      results = this.browseMode(candidateIds, q.limit);
    } else {
      results = await this.rankedMode(trimmed, candidateIds, q.limit);
    }

    return {
      query: q.text,
      filters,
      results,
      total_candidates: candidateIds.length,
      duration_ms: Date.now() - start
    };
  }

  private resolveDefaults(filters: SearchFilters): SearchFilters {
    return {
      ...filters,
      is_archived: filters.is_archived ?? this.options.defaultIncludeArchived ?? false,
      is_hidden: filters.is_hidden ?? this.options.defaultIncludeHidden ?? false
    };
  }

  private browseMode(candidateIds: string[], limit: number): SearchResult[] {
    if (candidateIds.length === 0) {
      return [];
    }
    const placeholders = candidateIds.map(() => "?").join(",");
    const rows = this.options.db
      .prepare(
        `SELECT p.id AS passage_id, p.body, p.reader_note, p.position_start, p.position_end,
                p.marked_at, p.is_starred, p.labels_json,
                w.id AS work_id, w.display_title, w.creator, w.cover_image_url
         FROM passages p
         JOIN works w ON p.work_id = w.id
         WHERE p.id IN (${placeholders})
         ORDER BY COALESCE(p.marked_at, p.ingested_at) DESC
         LIMIT ?`
      )
      .all(...candidateIds, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => hydrateResult(row, { fused: 0 }, "fts5"));
  }

  private async rankedMode(
    text: string,
    candidateIds: string[],
    limit: number
  ): Promise<SearchResult[]> {
    if (candidateIds.length === 0) {
      return [];
    }
    const queryVec = (await this.options.embedder.embedBatch([text]))[0];

    const vecHits = this.options.repo.knnByPassageIds(queryVec, candidateIds, 100);
    const ftsHits = this.safeFts(text, candidateIds);

    const fused = fuseRrf(
      [vecHits, ftsHits],
      (h) => h.passage_id,
      { k: RRF_K, limit }
    );

    const idsInOrder = fused.map((f) => f.key);
    const vecScoreById = new Map(vecHits.map((h) => [h.passage_id, h.distance]));
    const ftsScoreById = new Map(ftsHits.map((h) => [h.passage_id, h.bm25]));

    const placeholders = idsInOrder.map(() => "?").join(",");
    const rowsById = new Map<string, Record<string, unknown>>();
    if (idsInOrder.length > 0) {
      const rows = this.options.db
        .prepare(
          `SELECT p.id AS passage_id, p.body, p.reader_note, p.position_start, p.position_end,
                  p.marked_at, p.is_starred, p.labels_json,
                  w.id AS work_id, w.display_title, w.creator, w.cover_image_url
           FROM passages p
           JOIN works w ON p.work_id = w.id
           WHERE p.id IN (${placeholders})`
        )
        .all(...idsInOrder) as Array<Record<string, unknown>>;
      for (const row of rows) {
        rowsById.set(String(row.passage_id), row);
      }
    }

    return fused
      .map((fhit) => {
        const row = rowsById.get(fhit.key);
        if (!row) return null;
        const matchedVia: SearchResult["matched_via"] =
          fhit.sourceIndices.length === 2 ? "both" : fhit.sourceIndices[0] === 0 ? "vector" : "fts5";
        return hydrateResult(
          row,
          {
            fused: fhit.score,
            vector_distance: vecScoreById.get(fhit.key),
            bm25: ftsScoreById.get(fhit.key)
          },
          matchedVia
        );
      })
      .filter((r): r is SearchResult => r !== null);
  }

  private safeFts(text: string, candidateIds: string[]) {
    try {
      // Escape FTS5 special chars by quoting unsafe tokens.
      const safe = text.replace(/"/g, '""');
      return this.options.repo.ftsSearchInIds(`"${safe}"`, candidateIds);
    } catch {
      return [];
    }
  }
}

function hydrateResult(
  row: Record<string, unknown>,
  scores: SearchResult["scores"],
  matchedVia: SearchResult["matched_via"]
): SearchResult {
  const body = String(row.body);
  return {
    passage_id: String(row.passage_id),
    body,
    reader_note: (row.reader_note as string | null) ?? undefined,
    snippet: body.length > 240 ? `${body.slice(0, 240)}…` : body,
    work: {
      id: String(row.work_id),
      display_title: String(row.display_title),
      creator: (row.creator as string | null) ?? undefined,
      cover_image_url: (row.cover_image_url as string | null) ?? undefined
    },
    position: formatPosition(row.position_start, row.position_end),
    marked_at: (row.marked_at as string | null) ?? undefined,
    labels: parseLabels(row.labels_json),
    is_starred: Number(row.is_starred) === 1,
    scores,
    matched_via: matchedVia
  };
}

function formatPosition(start: unknown, end: unknown): string | undefined {
  if (!start) return undefined;
  if (end && end !== start) return `${start}–${end}`;
  return String(start);
}

function parseLabels(json: unknown): string[] {
  if (typeof json !== "string") return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 6: Re-export from package entry**

Edit `packages/search/src/index.ts`:

```ts
export * from "./types.js";
export { EmbeddingService } from "./embedding/embeddingService.js";
export { resolveBundledModelDir } from "./embedding/modelPaths.js";
export { SearchRepository } from "./repositories/searchRepository.js";
export { IndexerService } from "./indexer/indexerService.js";
export { SearchService } from "./query/searchService.js";
export { buildCandidateSql } from "./query/filterSql.js";
export { fuseRrf } from "./query/rrf.js";
```

- [ ] **Step 7: Run tests — confirm they pass**

```bash
pnpm --filter @archi/search test
```

Expected: all `searchService` tests PASS (plus the others from earlier tasks).

- [ ] **Step 8: Commit**

```bash
git add packages/search
git commit -m "search: add SearchService with hybrid retrieval and RRF fusion"
```

---

## Task 10: `searchModule` — Electron main wiring

**Files:**
- Create: `apps/desktop/src/main/searchModule.ts`
- Modify: `apps/desktop/package.json` — add `@archi/search` workspace dep

- [ ] **Step 1: Add `@archi/search` to desktop dependencies**

Edit `apps/desktop/package.json` — add to `dependencies`:

```json
"@archi/search": "workspace:*",
```

And to `dependenciesMeta`:

```json
"@archi/search": {
  "injected": true
},
```

Then:

```bash
pnpm install
```

- [ ] **Step 2: Create the search module**

Create `apps/desktop/src/main/searchModule.ts`:

```ts
import path from "node:path";
import { app } from "electron";
import {
  EmbeddingService,
  IndexerService,
  SearchRepository,
  SearchService
} from "@archi/search";
import type { CoreDatabase } from "@archi/core";

export type SearchModule = {
  embedder: EmbeddingService;
  indexer: IndexerService;
  search: SearchService;
};

export function createSearchModule(db: CoreDatabase): SearchModule {
  const bundledModelRoot = app.isPackaged
    ? path.join(process.resourcesPath, "models")
    : path.resolve(app.getAppPath(), "resources/models");

  const embedder = new EmbeddingService({ bundledModelRoot });
  const repo = new SearchRepository(db);
  const indexer = new IndexerService({ db, repo, embedder, batchSize: 32 });
  const search = new SearchService({ db, repo, embedder });

  // Kick a backfill on startup. Non-blocking.
  setImmediate(() => indexer.tick());

  return { embedder, indexer, search };
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @archi/desktop typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop pnpm-lock.yaml
git commit -m "desktop: add searchModule wiring EmbeddingService + IndexerService + SearchService"
```

---

## Task 11: IPC handlers + preload exposure

**Files:**
- Create: `apps/desktop/src/main/ipc/searchIpc.ts`
- Modify: `apps/desktop/src/main/index.ts` — call `createSearchModule`, register IPC handlers, hook into sync completion
- Modify: `apps/desktop/src/preload/index.ts` — expose `window.archi.search.*`

- [ ] **Step 1: Write IPC handler registration**

Create `apps/desktop/src/main/ipc/searchIpc.ts`:

```ts
import { ipcMain } from "electron";
import type { SearchModule } from "../searchModule.js";
import type { SearchQuery } from "@archi/search";

export function registerSearchIpc(module: SearchModule): void {
  ipcMain.handle("archi:search:query", async (_event, q: SearchQuery) => {
    return module.search.query(q);
  });

  ipcMain.handle("archi:search:indexerStatus", async () => {
    return module.indexer.getStatus();
  });
}
```

- [ ] **Step 2: Wire `createSearchModule` and IPC in main**

Edit `apps/desktop/src/main/index.ts` — at the top, alongside other imports:

```ts
import { createSearchModule, type SearchModule } from "./searchModule.js";
import { registerSearchIpc } from "./ipc/searchIpc.js";
```

After the `CoreRepository` / `openCoreDatabase` call in the startup sequence, add:

```ts
const searchModule: SearchModule = createSearchModule(db);
registerSearchIpc(searchModule);
```

(Where `db` is the `CoreDatabase` instance already created. Read main/index.ts around the existing `openCoreDatabase` call to place this in the right spot.)

After every sync job completes — find the existing handler (search for `"sync_complete"` or the function that runs after Notion writes finish) and add:

```ts
searchModule.indexer.tick();
```

If the sync orchestration has multiple completion points, add the call to each — `tick()` is idempotent and cheap.

- [ ] **Step 3: Expose IPC in preload**

Edit `apps/desktop/src/preload/index.ts` — extend the existing `window.archi` exposure with a `search` namespace:

```ts
import type { SearchQuery, SearchResponse, IndexerStatus } from "@archi/search";

// ... existing types ...

contextBridge.exposeInMainWorld("archi", {
  // ... existing fields preserved verbatim ...
  search: {
    query: (q: SearchQuery): Promise<SearchResponse> =>
      ipcRenderer.invoke("archi:search:query", q),
    indexerStatus: (): Promise<IndexerStatus> =>
      ipcRenderer.invoke("archi:search:indexerStatus")
  }
});
```

- [ ] **Step 4: Add typings for the renderer**

If the renderer has a `window.archi` declaration (likely in `apps/desktop/src/renderer/env.d.ts`), extend it with the same `search` shape.

Add to `apps/desktop/src/renderer/env.d.ts`:

```ts
import type { SearchQuery, SearchResponse, IndexerStatus } from "@archi/search";

declare global {
  interface Window {
    archi: {
      // ... existing fields ...
      search: {
        query: (q: SearchQuery) => Promise<SearchResponse>;
        indexerStatus: () => Promise<IndexerStatus>;
      };
    };
  }
}
```

(Preserve the existing declarations; only add the `search` field.)

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @archi/desktop typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop
git commit -m "desktop: register search IPC and expose window.archi.search.*"
```

---

## Task 12: `SearchScreen` + `SearchResultCard` + `SearchFilterChips`

**Files:**
- Create: `apps/desktop/src/renderer/screens/SearchScreen.tsx`
- Create: `apps/desktop/src/renderer/components/SearchResultCard.tsx`
- Create: `apps/desktop/src/renderer/components/SearchFilterChips.tsx`
- Create: `apps/desktop/src/renderer/components/IndexingBanner.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` — add route

- [ ] **Step 1: Read existing screens for styling conventions**

Before writing the new screen, open one existing screen file to copy its layout/styling conventions:

```bash
ls apps/desktop/src/renderer/screens
```

Pick one (e.g., `PassagesScreen.tsx` if it exists) and read it. Match its CSS-class / styled patterns.

- [ ] **Step 2: Implement `SearchResultCard`**

Create `apps/desktop/src/renderer/components/SearchResultCard.tsx`:

```tsx
import type { SearchResult } from "@archi/search";

type Props = {
  result: SearchResult;
  showMatchSource: boolean;
  onOpen: (passageId: string) => void;
};

export function SearchResultCard({ result, showMatchSource, onOpen }: Props) {
  return (
    <article className="search-result-card" onClick={() => onOpen(result.passage_id)}>
      <header className="search-result-card__header">
        {result.is_starred && <span aria-label="starred" title="Starred">★</span>}
        <span className="search-result-card__source">
          {result.work.creator ? `${result.work.creator} · ` : ""}
          {result.work.display_title}
          {result.position ? ` · ${result.position}` : ""}
        </span>
        {showMatchSource && (
          <span className="search-result-card__match-source" title="How this result was found">
            {result.matched_via === "vector" ? "⚡ meaning" : result.matched_via === "fts5" ? "🔤 keyword" : "⚡+🔤 both"}
          </span>
        )}
      </header>
      <p className="search-result-card__body">{result.snippet}</p>
      {result.reader_note && (
        <p className="search-result-card__note">
          <strong>Note:</strong> {result.reader_note}
        </p>
      )}
      {result.marked_at && (
        <footer className="search-result-card__footer">
          Marked {new Date(result.marked_at).toLocaleDateString()}
        </footer>
      )}
    </article>
  );
}
```

- [ ] **Step 3: Implement `SearchFilterChips`**

Create `apps/desktop/src/renderer/components/SearchFilterChips.tsx`:

```tsx
import { useState } from "react";
import type { SearchFilters } from "@archi/search";

type Props = {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
  availableCreators: string[];
};

export function SearchFilterChips({ filters, onChange, availableCreators }: Props) {
  const [addingDim, setAddingDim] = useState<string | null>(null);

  const removeFilter = (key: keyof SearchFilters) => {
    const next = { ...filters };
    delete next[key];
    onChange(next);
  };

  return (
    <div className="search-filter-chips">
      {filters.creator && (
        <span className="search-filter-chip">
          Author: {filters.creator}
          <button type="button" onClick={() => removeFilter("creator")} aria-label="Remove author filter">✕</button>
        </span>
      )}
      {filters.is_starred && (
        <span className="search-filter-chip">
          ★ Starred only
          <button type="button" onClick={() => removeFilter("is_starred")} aria-label="Remove starred filter">✕</button>
        </span>
      )}
      {filters.marker_color && (
        <span className="search-filter-chip">
          Color: {filters.marker_color}
          <button type="button" onClick={() => removeFilter("marker_color")} aria-label="Remove color filter">✕</button>
        </span>
      )}

      {addingDim === null ? (
        <button type="button" className="search-filter-chip search-filter-chip--add" onClick={() => setAddingDim("menu")}>
          + Add filter
        </button>
      ) : (
        <div className="search-filter-chip-menu">
          <button type="button" onClick={() => { setAddingDim("creator"); }}>Author</button>
          <button type="button" onClick={() => { onChange({ ...filters, is_starred: true }); setAddingDim(null); }}>Starred</button>
          <button type="button" onClick={() => setAddingDim("color")}>Color</button>
          <button type="button" onClick={() => setAddingDim(null)}>Cancel</button>
        </div>
      )}

      {addingDim === "creator" && (
        <select
          autoFocus
          onChange={(e) => { onChange({ ...filters, creator: e.target.value }); setAddingDim(null); }}
          onBlur={() => setAddingDim(null)}
          defaultValue=""
        >
          <option value="" disabled>Choose author…</option>
          {availableCreators.map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
      )}

      {addingDim === "color" && (
        <select
          autoFocus
          onChange={(e) => { onChange({ ...filters, marker_color: e.target.value }); setAddingDim(null); }}
          onBlur={() => setAddingDim(null)}
          defaultValue=""
        >
          <option value="" disabled>Choose color…</option>
          <option value="yellow">Yellow</option>
          <option value="pink">Pink</option>
          <option value="orange">Orange</option>
          <option value="blue">Blue</option>
        </select>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement `IndexingBanner`**

Create `apps/desktop/src/renderer/components/IndexingBanner.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { IndexerStatus } from "@archi/search";

type Props = {
  pollMs?: number;
};

export function IndexingBanner({ pollMs = 2000 }: Props) {
  const [status, setStatus] = useState<IndexerStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const next = await window.archi.search.indexerStatus();
        if (!alive) return;
        setStatus(next);
      } catch {
        /* ignore */
      } finally {
        if (alive) timer = setTimeout(poll, pollMs);
      }
    };
    poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [pollMs]);

  if (!status || dismissed) return null;
  if (status.status === "idle" && status.indexed >= status.total) return null;
  if (status.status === "unavailable") {
    return (
      <div className="indexing-banner indexing-banner--error" role="status">
        Semantic search is unavailable. Keyword search still works.
      </div>
    );
  }

  return (
    <div className="indexing-banner" role="status">
      <span>Indexing {status.indexed} of {status.total} highlights…</span>
      <button type="button" aria-label="Dismiss" onClick={() => setDismissed(true)}>✕</button>
    </div>
  );
}
```

- [ ] **Step 5: Implement `SearchScreen`**

Create `apps/desktop/src/renderer/screens/SearchScreen.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchFilters, SearchResponse } from "@archi/search";
import { SearchResultCard } from "../components/SearchResultCard.js";
import { SearchFilterChips } from "../components/SearchFilterChips.js";
import { IndexingBanner } from "../components/IndexingBanner.js";

type Props = {
  initialQuery?: string;
  onOpenPassage: (passageId: string) => void;
  showMatchSource?: boolean;
};

export function SearchScreen({ initialQuery = "", onOpenPassage, showMatchSource = true }: Props) {
  const [text, setText] = useState(initialQuery);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [availableCreators, setAvailableCreators] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount.
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Load available creators once for the filter dropdown.
  useEffect(() => {
    void (async () => {
      const browseRes = await window.archi.search.query({ text: "", filters: {}, limit: 200 });
      const unique = Array.from(new Set(
        browseRes.results.map((r) => r.work.creator).filter((c): c is string => Boolean(c))
      )).sort();
      setAvailableCreators(unique);
    })();
  }, []);

  const runQuery = useCallback(async (q: string, f: SearchFilters) => {
    setLoading(true);
    try {
      const res = await window.archi.search.query({ text: q, filters: f, limit: 50 });
      setResponse(res);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced live query.
  useEffect(() => {
    const handle = setTimeout(() => { void runQuery(text, filters); }, 150);
    return () => clearTimeout(handle);
  }, [text, filters, runQuery]);

  const summary = useMemo(() => {
    if (!response) return "";
    return `Showing ${response.results.length} of ${response.total_candidates} candidates (${response.duration_ms} ms)`;
  }, [response]);

  return (
    <section className="search-screen">
      <input
        ref={inputRef}
        className="search-screen__input"
        type="search"
        placeholder="Search highlights…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Search highlights"
      />
      <SearchFilterChips filters={filters} onChange={setFilters} availableCreators={availableCreators} />
      <div className="search-screen__summary">{loading ? "Searching…" : summary}</div>
      <div className="search-screen__results">
        {response?.results.map((r) => (
          <SearchResultCard
            key={r.passage_id}
            result={r}
            showMatchSource={showMatchSource}
            onOpen={onOpenPassage}
          />
        ))}
        {response && response.results.length === 0 && !loading && (
          <div className="search-screen__empty">
            No matches. Try fewer filters or different words.
          </div>
        )}
      </div>
      <IndexingBanner />
    </section>
  );
}
```

- [ ] **Step 6: Wire the route in `App.tsx`**

Open `apps/desktop/src/renderer/App.tsx`. Find the existing screen-switching logic (e.g., a `view` state or a route mechanism). Add a new view value `"search"` and render `<SearchScreen onOpenPassage={...} />` when active. Add a sidebar/nav entry titled "Search" that sets the view to `"search"`.

The exact integration depends on the existing nav structure. Read App.tsx and follow the same pattern used by the other six screens.

- [ ] **Step 7: Run dev and smoke-test the screen**

```bash
pnpm dev
```

In a synced Archi window: click the new "Search" nav entry. Verify:
- Search input renders, autofocuses
- Typing "anger" returns results (after indexer backfill completes — watch the banner)
- Filter chip "+ Add filter" → "Author" works
- Result card click triggers `onOpenPassage` (wired to existing Passages screen)

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer
git commit -m "desktop: add Search screen with filter chips and indexing banner"
```

---

## Task 13: `GlobalSearchBar` with `⌘K` and dropdown

**Files:**
- Create: `apps/desktop/src/renderer/components/GlobalSearchBar.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` — mount the bar in the header

- [ ] **Step 1: Implement `GlobalSearchBar`**

Create `apps/desktop/src/renderer/components/GlobalSearchBar.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult } from "@archi/search";

type Props = {
  onOpenPassage: (passageId: string) => void;
  onOpenSearchScreen: (initialQuery: string) => void;
};

export function GlobalSearchBar({ onOpenPassage, onOpenSearchScreen }: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K focuses input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced query
  useEffect(() => {
    if (!open || text.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const res = await window.archi.search.query({ text, filters: {}, limit: 5 });
      setResults(res.results);
      setHighlighted(0);
    }, 150);
    return () => clearTimeout(handle);
  }, [text, open]);

  const submit = useCallback(() => {
    if (results.length > 0) {
      onOpenPassage(results[highlighted].passage_id);
      setOpen(false);
    }
  }, [results, highlighted, onOpenPassage]);

  const escalate = useCallback(() => {
    onOpenSearchScreen(text);
    setOpen(false);
  }, [text, onOpenSearchScreen]);

  return (
    <div className="global-search-bar">
      <input
        ref={inputRef}
        type="search"
        value={text}
        placeholder="Search highlights… (⌘K)"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, results.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((h) => Math.max(0, h - 1)); }
          if (e.key === "Enter") {
            if (e.metaKey || e.ctrlKey) { escalate(); } else { submit(); }
          }
        }}
        aria-label="Global search"
      />
      {open && results.length > 0 && (
        <div className="global-search-bar__dropdown" role="listbox">
          {results.map((r, i) => (
            <div
              key={r.passage_id}
              role="option"
              aria-selected={i === highlighted}
              className={`global-search-bar__row ${i === highlighted ? "is-highlighted" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); onOpenPassage(r.passage_id); setOpen(false); }}
              onMouseEnter={() => setHighlighted(i)}
            >
              <div className="global-search-bar__row-body">{r.snippet}</div>
              <div className="global-search-bar__row-meta">
                {r.work.creator ? `${r.work.creator} · ` : ""}{r.work.display_title}
              </div>
            </div>
          ))}
          <button type="button" className="global-search-bar__see-all" onMouseDown={(e) => { e.preventDefault(); escalate(); }}>
            ⌘↵ See all results
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount the bar in the header**

In `apps/desktop/src/renderer/App.tsx`, add the bar to the header (or top of the layout) and wire its callbacks to set the active view + selected passage. Pattern depends on existing App.tsx structure — mirror how the other top-bar elements are placed.

- [ ] **Step 3: Smoke test**

```bash
pnpm dev
```

Verify:
- `⌘K` from any screen focuses the bar
- Typing returns up to 5 dropdown rows
- `↵` opens the highlighted result in Passages screen
- `⌘↵` opens the Search screen with the query preserved
- `Esc` closes the dropdown

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer
git commit -m "desktop: add GlobalSearchBar with ⌘K, dropdown, and search-screen escalation"
```

---

## Task 14: `FindSimilarButton` on existing passages

**Files:**
- Create: `apps/desktop/src/renderer/components/FindSimilarButton.tsx`
- Modify: the existing Passages-screen file (likely `apps/desktop/src/renderer/screens/PassagesScreen.tsx`) — add the button to each passage row

- [ ] **Step 1: Locate the passages-row component**

```bash
grep -rln "passages" apps/desktop/src/renderer/screens
```

Open the file that renders an individual passage row.

- [ ] **Step 2: Implement `FindSimilarButton`**

Create `apps/desktop/src/renderer/components/FindSimilarButton.tsx`:

```tsx
type Props = {
  passageBody: string;
  onOpenSearchScreen: (initialQuery: string) => void;
};

export function FindSimilarButton({ passageBody, onOpenSearchScreen }: Props) {
  return (
    <button
      type="button"
      className="find-similar-button"
      onClick={(e) => {
        e.stopPropagation();
        // Cap query length to avoid awkward search-screen UX.
        const snippet = passageBody.slice(0, 240);
        onOpenSearchScreen(snippet);
      }}
      aria-label="Find similar passages"
    >
      ⚡ Find similar
    </button>
  );
}
```

- [ ] **Step 3: Render the button on each passage row**

In the passages-screen file, add `<FindSimilarButton passageBody={row.body} onOpenSearchScreen={...} />` inside each row's action area. Wire `onOpenSearchScreen` to the same handler the global search bar uses.

- [ ] **Step 4: Smoke test**

```bash
pnpm dev
```

Open Passages screen → click "⚡ Find similar" on any row → Search screen opens with that passage's body as the query → ranked similar passages display.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer
git commit -m "desktop: add FindSimilarButton to passage rows"
```

---

## Task 15: Settings — Search section

**Files:**
- Modify: existing Settings/Connections screen — add a "Search" panel showing index status and toggles
- Modify: `apps/desktop/src/main/preferences.ts` (or equivalent) — persist toggle values; pass into `SearchService` defaults

- [ ] **Step 1: Locate the existing Settings screen**

```bash
grep -rln "preferences\|settings" apps/desktop/src/renderer/screens
```

- [ ] **Step 2: Render the Search panel**

Inside the settings screen, render:

```tsx
import { useEffect, useState } from "react";
import type { IndexerStatus } from "@archi/search";

function SearchSettingsPanel() {
  const [status, setStatus] = useState<IndexerStatus | null>(null);

  useEffect(() => {
    void (async () => {
      setStatus(await window.archi.search.indexerStatus());
    })();
  }, []);

  return (
    <section className="settings-section">
      <h3>Search</h3>
      <dl>
        <dt>Index status</dt>
        <dd>{status ? `${status.indexed} of ${status.total} highlights indexed` : "Loading…"}</dd>
        <dt>Embedding model</dt>
        <dd>bge-small-en-v1.5 — managed by Archi</dd>
      </dl>
    </section>
  );
}
```

Add `<SearchSettingsPanel />` to the settings screen's section list.

- [ ] **Step 3 (deferred to a follow-up): persisted toggles**

For v1 we ship index-status visibility only. The "Include archived in search" and "Include hidden in search" toggles will land in a follow-up — they require wiring through preferences and into `SearchService` defaults. Add a TODO comment in the panel:

```tsx
// TODO: add "Include archived" and "Include hidden" toggles; persist via preferences
//       and pass into SearchService options.
```

- [ ] **Step 4: Smoke test**

```bash
pnpm dev
```

Open Settings → see the Search section with "X of Y highlights indexed" updating live (after a refresh).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "desktop: add Search settings panel with index status"
```

---

## Task 16: Hook indexer into post-sync completion

**Files:**
- Modify: `apps/desktop/src/main/index.ts` — ensure `searchModule.indexer.tick()` is called after every sync completion path

- [ ] **Step 1: Find sync-completion paths**

```bash
grep -n "sync_complete\|notion.*upsert\|destination_notion" apps/desktop/src/main/index.ts
```

Identify every place where a sync run finishes (success, partial success, even failure — failures can still produce new passages).

- [ ] **Step 2: Add `searchModule.indexer.tick()` after each completion**

At every identified completion path, add:

```ts
searchModule.indexer.tick();
```

`tick()` is idempotent and non-blocking (returns immediately; runs work in the background).

- [ ] **Step 3: Manual smoke**

```bash
pnpm dev
```

Trigger a sync. Watch the IndexingBanner: it should reflect "Indexing N of M…" briefly after new passages arrive, then return to idle.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "desktop: tick search indexer after every sync completion"
```

---

## Task 17: Packaging smoke test

**Files:**
- Modify (if needed): `apps/desktop/scripts/verify-packaged-runtime.mjs` — extend to verify the search runtime in packaged builds

- [ ] **Step 1: Run a packaged build locally**

```bash
pnpm --filter @archi/desktop package
```

Expected: produces `apps/desktop/release/Archi-arm64.dmg` (or x64) without errors.

- [ ] **Step 2: Verify extension + model are unpacked**

```bash
APP_ROOT=$(ls -d apps/desktop/release/mac-arm64/Archi.app 2>/dev/null || ls -d apps/desktop/release/mac/Archi.app)
ls "$APP_ROOT/Contents/Resources/app.asar.unpacked/node_modules/sqlite-vec"
ls "$APP_ROOT/Contents/Resources/models/bge-small-en-v1.5"
```

Expected: both directories exist; sqlite-vec includes its `.dylib`; the model dir contains `onnx/model_quantized.onnx`.

- [ ] **Step 3: Install and run the DMG manually**

Mount the DMG, drag Archi to a separate test location, launch. Open the Search screen. Confirm:
- Indexing banner appears
- A query returns results

If the extension fails to load (banner says "Semantic search unavailable"), check the packaged Console log for sqlite-vec errors and add the appropriate path to `asarUnpack` in `electron-builder.yml`.

- [ ] **Step 4: Extend `verify-packaged-runtime.mjs` (optional)**

If you want this gated in CI, add a check that the model dir and extension exist post-package. Read the existing script to match its style, then append:

```js
import { existsSync } from "node:fs";
import { join } from "node:path";

// ... existing checks ...

const appRoot = resolveAppRoot(); // however the existing script resolves it
const modelOnnx = join(appRoot, "Contents/Resources/models/bge-small-en-v1.5/onnx/model_quantized.onnx");
if (!existsSync(modelOnnx)) {
  throw new Error(`Missing bundled embedding model: ${modelOnnx}`);
}
const vecPkg = join(appRoot, "Contents/Resources/app.asar.unpacked/node_modules/sqlite-vec");
if (!existsSync(vecPkg)) {
  throw new Error(`sqlite-vec not unpacked from asar: ${vecPkg}`);
}
console.log("[verify] bundled model + sqlite-vec present");
```

- [ ] **Step 5: Commit (only if you modified the script)**

```bash
git add apps/desktop/scripts/verify-packaged-runtime.mjs
git commit -m "desktop: verify bundled embedding model and sqlite-vec in packaged runtime"
```

---

## Task 18: Manual QA checklist + final verification

**Files:**
- Create: `docs/testing/search-v1.md`

- [ ] **Step 1: Add the QA checklist**

Create `docs/testing/search-v1.md`:

```markdown
# Search v1 — Manual QA Checklist

- [ ] First install with no data: Search shows "No matches" / coach text gracefully
- [ ] First install with synced data: indexing banner appears, results populate progressively
- [ ] Type "anger" with no filters: relevant Aurelius/Seneca passages appear
- [ ] Add Author chip "Marcus Aurelius": narrowed to Aurelius only
- [ ] Type "Meditations": FTS5 finds the structural reference
- [ ] Click result: jumps to passage in Passages screen
- [ ] `⌘K` from any screen focuses global search bar
- [ ] Type 2+ chars: dropdown shows up to 5 results
- [ ] `↵` opens first result; `⌘↵` opens Search screen with query
- [ ] `Esc` closes dropdown
- [ ] Edit a passage body in Library/Passages → Search reflects within seconds
- [ ] Archive a passage: no longer appears in search; unarchive: reappears
- [ ] Quit app mid-indexing → relaunch → indexing resumes
- [ ] Force-quit during query → no DB corruption on relaunch
- [ ] Click "⚡ Find similar" on a passage: Search screen opens with that body, ranked similar shown
- [ ] Settings → Search panel shows current index status
- [ ] Resize window small: Search screen still usable
```

- [ ] **Step 2: Run the full local validation**

```bash
pnpm typecheck
pnpm test
pnpm --filter @archi/desktop package
```

All three should succeed.

- [ ] **Step 3: Walk through the checklist on the packaged DMG**

Open the DMG, launch the app, run each checkbox above. Fix any blockers.

- [ ] **Step 4: Commit the checklist**

```bash
git add docs/testing/search-v1.md
git commit -m "docs: add manual QA checklist for search v1"
```

---

## Self-Review Notes

The plan covers every section of the spec:

- §3 architecture overview → Tasks 1, 10, 11, 16
- §4 tech choices → Tasks 1, 2, 4, 5
- §5 data model → Tasks 2, 3
- §6 indexing pipeline → Tasks 5, 7, 10, 16
- §7 retrieval → Tasks 6, 8, 9, 11
- §8 UI → Tasks 12, 13, 14, 15
- §9 code organization → reflected across Tasks 1, 5–11
- §10 packaging → Tasks 4, 17
- §11 risks → addressed at the relevant tasks (Tasks 2, 4, 17 cover the packaging risks; Task 9's `safeFts` covers FTS5 syntax errors; the embedder failure path lives in Task 7's IndexerService)
- §12 testing strategy → Tasks 2, 3, 5, 6, 7, 8, 9, 18
- §13 migration & first-run → Tasks 3, 10, 12

Type/name consistency verified across tasks: `SearchQuery`, `SearchResult`, `SearchResponse`, `IndexerStatus`, `EMBEDDING_MODEL_ID`, `SearchRepository`, `EmbeddingService`, `IndexerService`, `SearchService`, `createSearchModule` all match between definition (Task 1) and usage (later tasks).
