# Local Semantic Search for Quotes — Design

**Status:** approved design, ready for implementation planning
**Date:** 2026-06-02
**Author:** ben@benjaminloschen.com (with Claude)
**Scope:** Phase 1 of a "RAG for quotes" feature. Adds local semantic + keyword search over the existing `passages` table. No chat / LLM / synthesis in v1.

## 1. Goal

Let users find their Kindle highlights (`passages`) by **meaning**, **keyword**, and **metadata** — all on-device, no network, no API keys, no per-token cost. Turn the existing chronological-scroll experience into one where the user can ask "anger in Marcus Aurelius" or "what to do when someone insults you" and get a ranked list of their own actual passages back.

## 2. Out of scope (v1)

Recording these explicitly to prevent scope creep:

- No chat / LLM / generative synthesis. No summarization, no "explain this quote", no multi-doc reasoning.
- No external runtimes (Ollama, llama.cpp, MLX) — not bundled, not required to install.
- No cloud APIs (OpenAI, Anthropic, OpenRouter, BYOK paste-key).
- No cross-encoder re-ranking.
- No query expansion via LLM.
- No natural-language filter extraction ("show me aurelius" → auto-apply creator filter).
- No saved searches, search history, smart folders.
- No book-label filtering (only quote-label filtering in v1).
- No "similar to this" surfaced unprompted in existing screens (the explicit "Find similar" button on a passage IS in scope).
- No GPU / Metal acceleration for the embedder (CPU is fast enough).
- No multi-vector embeddings (ColBERT-style).
- No internationalization (English corpus assumed; bge-small is English-optimized).

These are all reasonable Phase 2+ candidates. They are not v1.

## 3. Architecture overview

One new package (`packages/search`), three new SQLite objects in the existing `archi.db`, two new IPC endpoints, one new renderer screen, one global search bar.

```
┌──────────────────────────── Electron Renderer (React) ─────────────────────────────────┐
│                                                                                         │
│  ┌────────────────────┐    ┌────────────────────┐    ┌──────────────────────────┐      │
│  │ Search bar (header)│    │ Search screen      │    │ Existing 6 screens       │      │
│  │ ⌘K, dropdown of 5  │───▶│ Ranked passage list│    │ (Library, Passages, ...) │      │
│  └────────────────────┘    │ + filter chips     │    └──────────────────────────┘      │
│                            └────────────────────┘                                       │
│                                     │                                                   │
└─────────────────────────────────────┼───────────────────────────────────────────────────┘
                                      │ IPC: search.query, search.indexerStatus
                                      ▼
┌──────────────────────────── Electron Main (Node) ──────────────────────────────────────┐
│                                                                                         │
│  NEW: packages/search                                                                   │
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────────────┐            │
│  │ EmbeddingService │   │ IndexerService   │   │ SearchService            │            │
│  │ bge-small-en     │   │ Backfill +       │   │ SQL pre-filter +         │            │
│  │ via xenova       │   │ incremental on   │   │ vector cosine +          │            │
│  │ (ONNX, CPU)      │   │ passage upserts  │   │ FTS5 hybrid + RRF        │            │
│  └──────────────────┘   └──────────────────┘   └──────────────────────────┘            │
│                                          │                                              │
│                                          ▼                                              │
│  EXISTING: better-sqlite3 store (single canonical DB)                                   │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────┐                    │
│  │ works      │  │ passages   │  │ sync_jobs  │  │ NEW:           │                    │
│  │ (existing) │  │ (existing) │  │ (existing) │  │ passage_       │                    │
│  └────────────┘  └────────────┘  └────────────┘  │   embeddings   │                    │
│                                                  │ embedding_state│                    │
│                                                  │ passages_fts   │                    │
│                                                  └────────────────┘                    │
│                                                                                         │
│  EXISTING: sync orchestration (device-export, cloud-notebook, notion)                   │
│  → IndexerService hooks here: on passage upsert/delete, enqueue embedding job          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

Key boundary decisions:

- All AI work lives in `packages/search`. Renderer has zero knowledge of embeddings, models, or vector math — it calls `search.query()` over IPC.
- Embedding model loads lazily in main on first search or first indexer run; stays resident for the session.
- Indexing is a background job that doesn't block sync or UI. Un-embedded passages still appear in FTS5 results — semantic results catch up as indexer progresses.

## 4. Tech choices and rationale

| Layer | Choice | Why |
|---|---|---|
| Vector store | `sqlite-vec` loadable extension on existing `better-sqlite3` DB | Single canonical store; SQL JOINs with `works`/`passages` enable pre-filtered retrieval (crucial for "anger + Marcus Aurelius" queries); CASCADE deletes piggyback on existing FK; one backup story. |
| Embedding model | `bge-small-en-v1.5` INT8 quantized (~33 MB, 384-dim) via `@xenova/transformers` (ONNX, CPU) | Top-tier quality for its size; runs in-process, no GPU, no Metal; small enough to bundle in the app DMG. |
| Keyword retrieval | SQLite built-in FTS5 with `porter unicode61` tokenizer, `content='passages'` external-content table | No new dependency; catches proper nouns / structural references that embeddings underrank; complements vector results in hybrid fusion. |
| Score fusion | Reciprocal Rank Fusion (`k=60`) | Industry-standard hybrid retrieval algorithm. Rank-based — no score-normalization headaches between cosine and BM25. |
| Storage scope | Same `archi.db` as `works`/`passages`/`sync_jobs` | Atomic transactions across passages + embeddings + FTS5; one backup; ~150 MB extra at 100 k passages is acceptable. |
| Embedding input | `passages.body` only | Quote text is the semantic target. `reader_note` is personal commentary; mixing it into the vector pollutes "find quotes like X". FTS5 indexes `reader_note` separately so keyword search still finds notes. |

Choices considered and rejected:

- **FAISS / hnswlib-node** — separate index outside SQLite. Can't pre-filter by metadata in one query → loses recall on selective filters. Overkill for 3 k–100 k vectors where brute-force cosine is sub-50 ms.
- **Vectra** — pure-JS, separate JSON store. Same separate-store problem; less SQL-native.
- **Brute-force cosine in JS over a Float32Array** — viable at 3 k, viable at 100 k. We pick sqlite-vec primarily for SQL-JOIN ergonomics, not speed. If sqlite-vec packaging proves intractable, this is the documented fallback (see §11).
- **Larger embedding model (bge-base, nomic-embed)** — ~3× larger for marginal quality on this corpus type. Save the DMG bytes.
- **First-run model download instead of bundling** — saves 33 MB; loses offline-first guarantee. Not worth it.

## 5. Data model

Additions to the existing schema. Goes in a new migration `version: 3` in `packages/core/src/db/migrations.ts`.

### 5.1 `passage_embeddings` — vector store

```sql
CREATE VIRTUAL TABLE passage_embeddings USING vec0(
  passage_id TEXT PRIMARY KEY,
  embedding  FLOAT[384]
);
```

- Provided by `sqlite-vec`'s `vec0` virtual table.
- `passage_id` matches `passages.id` (TEXT) — gives free JOINs.
- Storage: ~1.5 KB per passage. 3 k ≈ 4.5 MB, 100 k ≈ 150 MB.
- Idempotent upserts via `INSERT OR REPLACE`.

### 5.2 `passages_fts` — keyword index

```sql
CREATE VIRTUAL TABLE passages_fts USING fts5(
  body,
  reader_note,
  content='passages',
  content_rowid='rowid',
  tokenize='porter unicode61'
);
```

- Built-in SQLite. No new dependency.
- "Contentless" — references the underlying `passages` row via SQLite's implicit `rowid`. No data duplication.
- **Result-mapping gotcha**: FTS5 returns `rowid`, but the rest of the app keys by `passages.id` (TEXT). Every FTS5 query must `JOIN passages p ON passages_fts.rowid = p.rowid` to map back.

### 5.3 `embedding_state` — indexing bookkeeping

```sql
CREATE TABLE embedding_state (
  passage_id   TEXT PRIMARY KEY REFERENCES passages(id) ON DELETE CASCADE,
  model_id     TEXT NOT NULL,         -- e.g. 'bge-small-en-v1.5@v1'
  embedded_at  TEXT NOT NULL,         -- ISO timestamp
  source_hash  TEXT NOT NULL,         -- hash of passages.body at embed time
  status       TEXT NOT NULL          -- 'ok' | 'failed' | 'pending'
);
CREATE INDEX embedding_state_status_idx ON embedding_state(status);
CREATE INDEX embedding_state_model_idx  ON embedding_state(model_id);
```

Holds the **why** for each embedding: which model, when, hash of source text. Enables:

- Stale detection: `passages.body` edit → `source_hash` mismatch → re-embed.
- Model upgrade: single query (`WHERE model_id != '<current>'`) finds all rows to re-embed.
- Failure isolation: `status='failed'` rows logged once, don't loop forever.
- Progress surfacing: `COUNT(*) WHERE status='ok'` vs total passages = "3 000 of 3 141 indexed".

### 5.4 Triggers

```sql
CREATE TRIGGER passages_ai AFTER INSERT ON passages BEGIN
  INSERT INTO passages_fts(rowid, body, reader_note)
  VALUES (new.rowid, new.body, new.reader_note);
END;

CREATE TRIGGER passages_ad AFTER DELETE ON passages BEGIN
  INSERT INTO passages_fts(passages_fts, rowid, body, reader_note)
  VALUES ('delete', old.rowid, old.body, old.reader_note);
  DELETE FROM passage_embeddings WHERE passage_id = old.id;
END;

CREATE TRIGGER passages_au AFTER UPDATE OF body, reader_note ON passages BEGIN
  INSERT INTO passages_fts(passages_fts, rowid, body, reader_note)
  VALUES ('delete', old.rowid, old.body, old.reader_note);
  INSERT INTO passages_fts(rowid, body, reader_note)
  VALUES (new.rowid, new.body, new.reader_note);
  DELETE FROM embedding_state WHERE passage_id = new.id;
  DELETE FROM passage_embeddings WHERE passage_id = new.id;
END;
```

- FTS5 stays in lockstep with `passages` automatically.
- `passages` updates clear stale embeddings; indexer re-embeds on next tick.
- `passages_ad` explicitly removes the vector row (vec0 doesn't honor FK cascades).

### 5.5 Migration backfill

The migration runs in one transaction:

```sql
-- (after creating the three objects above)
INSERT INTO passages_fts(passages_fts) VALUES ('rebuild');
```

This one-shot backfill is sub-second at 3 k–100 k. Embeddings backfill happens via the indexer at runtime (not in the migration) — non-blocking.

## 6. Indexing pipeline

### 6.1 When indexing runs

| Trigger | What it does |
|---|---|
| App startup | One scan: `SELECT id FROM passages WHERE id NOT IN (SELECT passage_id FROM embedding_state WHERE status='ok' AND model_id='<current>')`. Enqueues unembedded + stale. |
| After each sync job completes | Re-run the same scan. Picks up newly inserted/updated passages. |
| Dev-only "Force reindex" (hidden) | Truncates `embedding_state` + `passage_embeddings`. Full backfill. |

### 6.2 How it runs

A queue-and-batch loop in main, no external workers:

```ts
class IndexerService {
  async tick() {
    const batch = this.fetchPendingPassages(32);
    if (batch.length === 0) {
      this.status = 'idle';
      return;
    }
    this.status = 'running';
    const vectors = await this.embedder.embedBatch(batch.map(p => p.body));
    this.db.transaction(() => {
      for (let i = 0; i < batch.length; i++) {
        this.upsertEmbedding(batch[i].id, vectors[i]);
        this.upsertEmbeddingState(batch[i].id, this.modelId, this.hash(batch[i].body));
      }
    })();
    setImmediate(() => this.tick());
  }
}
```

- Batch size 32: optimal for bge-small INT8 on Apple Silicon CPU (~150 ms per batch).
- Transactional per-batch: crash leaves no half-state.
- Resumable: the "pending" query is reentrant.
- Yields between batches: doesn't starve IPC or UI.

### 6.3 Embedding model lifecycle

```ts
async init() {
  const { pipeline } = await import('@xenova/transformers');
  this.embedder = await pipeline(
    'feature-extraction',
    'Xenova/bge-small-en-v1.5',
    {
      quantized: true,
      local_files_only: true,
      cache_dir: <bundled-model-path>,
    }
  );
}
```

- Lazy: first `embedBatch` call triggers `init`.
- Memory: ~80 MB resident after load.
- First-call latency: ~600 ms (one-time per session).
- Subsequent per-call latency: ~15 ms single-input, ~150 ms batch-of-32.

### 6.4 Perf budget (CPU, Apple Silicon, in-process)

| Corpus | Backfill (one-time) |
|---|---|
| 3 k passages | ~14 seconds |
| 100 k passages | ~7 minutes |

User-visible: "Indexing X of Y highlights…" banner on the Search screen. Non-blocking.

### 6.5 Failure handling

| Failure | Behavior |
|---|---|
| Embedder load failure | Indexer marks itself `unavailable`. Banner shown. FTS5 keeps working. |
| Per-passage embed failure | `embedding_state.status = 'failed'`. Logged. Surfaced in dev Diagnostics. Not retried. |
| DB write failure | Bubbles up, retried on next `tick()`. Idempotent (`INSERT OR REPLACE`). |
| Force-quit mid-backfill | Resumes from where it left off on relaunch. |

## 7. Retrieval / search

### 7.1 Query model

```ts
type SearchQuery = {
  text: string;                  // "" allowed
  filters: {
    work_ids?: string[];
    creator?: string;            // exact match on works.creator
    labels?: string[];           // intersect with passages.labels_json
    is_starred?: boolean;
    is_archived?: boolean;       // optional override; if undefined, server reads from Settings (default false)
    is_hidden?: boolean;         // optional override; if undefined, server reads from Settings (default false)
    marker_color?: string;       // 'yellow' | 'pink' | 'orange' | 'blue'
    work_type?: string;
    marked_after?: string;
    marked_before?: string;
  };
  limit: number;                 // default 50, max 200
};
```

### 7.2 Algorithm

```
1. Build candidate set via SQL pre-filter
   SELECT p.id FROM passages p
   JOIN works w ON p.work_id = w.id
   WHERE <filters>
     AND p.is_archived = 0       -- unless filters.is_archived = true
     AND p.is_hidden   = 0       -- unless filters.is_hidden = true

2. If text is non-empty, run in parallel restricted to candidate set:
   2a. Vector KNN via sqlite-vec:
       SELECT passage_id, distance FROM passage_embeddings
       WHERE embedding MATCH ? AND k = 100
         AND passage_id IN (<candidates>)
       ORDER BY distance
   2b. FTS5 BM25:
       SELECT passages_fts.rowid, bm25(passages_fts) AS score
       FROM passages_fts
       WHERE passages_fts MATCH ?
         AND passages_fts.rowid IN (
           SELECT rowid FROM passages WHERE id IN (<candidates>)
         )

3. Fuse via Reciprocal Rank Fusion (k = 60):
   for each passage in R_vec ∪ R_fts:
     fused_score = sum_over_retrievers( 1 / (60 + rank_in_retriever) )

4. Hydrate top N: JOIN to passages + works, generate snippets via FTS5 snippet()
   (vector-only hits get first 200 chars, no <mark> highlighting), tag matched_via.
```

### 7.3 Why filter-then-retrieve (not retrieve-then-filter)

The crucial advantage of sqlite-vec: pre-filter by SQL → run vector KNN on the filtered subspace. Recall is 1.0 within the subspace. Retrieve-then-filter (FAISS-style) loses recall on selective filters ("starred + author=Aurelius + label=anger" might return 0 matches even when 50 exist).

### 7.4 Special-case behaviors

| Input | Behavior |
|---|---|
| `text=""`, filters present | Return filtered passages sorted by `marked_at DESC`. No embedding call. |
| `text=""`, no filters | Recent passages sorted by `marked_at DESC` (default browse mode). |
| `text` < 2 chars | No-op. UI shows "keep typing…". |
| Embedder not yet loaded | FTS5 + filters only. Result list flagged "(keyword only)". |
| Some passages not yet embedded | Vector misses them; FTS5 finds them. Banner explains. |
| FTS5 syntax error in query | Sanitize, fall back to plain vector. No user-facing error. |
| Zero matches | Empty state with "Remove filter" / "Try different words" actions. |

### 7.5 IPC contract

```ts
window.archi.search.query(q: SearchQuery): Promise<SearchResponse>;
window.archi.search.indexerStatus(): Promise<IndexerStatus>;

type SearchResponse = {
  query: string;
  filters: SearchFilters;
  results: SearchResult[];
  total_candidates: number;
  duration_ms: number;
};

type SearchResult = {
  passage_id: string;
  body: string;
  reader_note?: string;
  snippet: string;                  // may contain <mark>...</mark>
  work: { id: string; display_title: string; creator?: string; cover_image_url?: string };
  position?: string;
  marked_at?: string;
  labels: string[];
  is_starred: boolean;
  scores: {
    fused: number;
    vector_distance?: number;
    bm25?: number;
  };
  matched_via: 'vector' | 'fts5' | 'both';
};

type IndexerStatus = {
  status: 'idle' | 'running' | 'failed' | 'unavailable';
  total: number;
  indexed: number;
  failed: number;
  lastError?: string;
};
```

### 7.6 Perf budget (steady state, after first call)

| Stage | 3 k corpus | 100 k corpus |
|---|---|---|
| Query embedding | ~15 ms | ~15 ms |
| SQL filter to candidate set | <1 ms | <5 ms |
| Vector KNN (in filtered set) | <10 ms | <50 ms |
| FTS5 search (in filtered set) | <5 ms | <20 ms |
| RRF + hydration | <5 ms | <15 ms |
| **Total** | **~35 ms** | **~105 ms** |

## 8. UI

### 8.1 Global search bar

In the app header, present on every screen.

- `⌘K` focuses from anywhere
- ~150 ms debounced live dropdown showing top 5 results
- Each row: snippet + creator + work title + starred icon
- `↵` opens the selected result in the Passages screen
- `⌘↵` or "See all results" opens the full Search screen with query preserved
- `Esc` closes dropdown

### 8.2 Search screen

A new top-level screen alongside the existing 6.

Layout:
- Search input (auto-focused, mirrors global bar)
- Active filter chips row + "+ Add filter" popover
- Result count + timing ("Showing 27 of 412 candidates (38 ms)")
- Ranked result cards (infinite scroll past 50)
- Indexing banner at bottom when `indexed < total` (dismissible per-session; reappears next session if still backfilling)

Available filter dimensions (chips):
- Author (`works.creator`)
- Book (`works.id`)
- Quote label (`passages.labels_json`, via `json_each`)
- Starred only (`passages.is_starred = 1`)
- Marker color (`passages.marker_color`)
- Date range (`passages.marked_at`)
- Work type (`works.work_type`)

Archived/hidden inclusion is **not** a per-query chip — it's a global preference in Settings (§8.5). The query honors those preferences automatically.

Each result card:
- Star indicator (if starred)
- Full passage body (truncated at ~3 lines with "Read more" expansion)
- Source line: `Creator • Work Title • Position`
- Marked date + label chips
- Reader note (collapsed by default if present)
- Match-source pill (`⚡ meaning` / `🔤 keyword` / `⚡+🔤 both`) — small, right-aligned, toggleable in Settings (default ON)
- Click → opens the passage in the existing Passages screen

### 8.3 Empty / loading / error states

| State | UI |
|---|---|
| First visit, no query, no filters | Recent passages sorted by `marked_at DESC` + coach text |
| Embedder warming up | Skeleton + "Loading semantic search…" inline |
| Backfill in progress, query run | Results shown + banner "Indexing X of Y" |
| No results | "No matches. [Remove filter]  [Try without keyword]" |
| Search disabled (embedder load failed) | Banner "Semantic search unavailable. Keyword search still works." + FTS5-only results |

### 8.4 Existing-screen integration

Three small touchpoints:

1. App header: add global search bar component.
2. Sidebar/nav: add "Search" entry.
3. Existing Passages screen: add "Find similar to this" button on each passage → runs `search.query` with that passage's body as the text. Free perk of having embeddings.

Existing screens require no behavioral changes.

### 8.5 Settings additions

A new "Search" section in Settings:

- Index status: `X of Y indexed`, last indexed time, embedding model name (`bge-small-en-v1.5 — managed by Archi`)
- Toggle: Show match-source labels (default ON)
- Toggle: Include archived passages in search (default OFF)
- Toggle: Include hidden passages in search (default OFF)

No user-facing model picker. No "Rebuild index" button visible to users. Dev-mode toggle reveals diagnostics (failed embeddings count, force reindex).

### 8.6 Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘K` | Focus global search bar |
| `↑`/`↓` | Navigate dropdown/result list |
| `↵` | Open selected result |
| `⌘↵` | Open full Search screen with query |
| `Esc` | Close dropdown / clear search |
| `⌘F` (in Search screen) | Re-focus search input |

## 9. Code organization

Following the existing monorepo pattern.

```
packages/
  core/                  (existing — only db/client.ts and db/migrations.ts touched)
    src/
      db/
        client.ts        +load sqlite-vec extension after pragmas
        migrations.ts    +version: 3 entry
  search/                (NEW)
    src/
      index.ts
      embedding/
        embeddingService.ts
        modelPaths.ts    (resolve bundled vs packaged paths)
      indexer/
        indexerService.ts
      query/
        searchService.ts
        rrf.ts
        snippetBuilder.ts
      repositories/
        searchRepository.ts   (mirrors CoreRepository style)
    tests/
      fixtures/
        canonical-corpus.ts   (~30 hand-picked passages)
      embeddingService.test.ts
      indexerService.test.ts
      searchService.test.ts

apps/desktop/
  src/
    main/
      ipc/
        searchIpc.ts     (NEW — wires search.* IPC handlers)
      services/
        searchModule.ts  (NEW — instantiates EmbeddingService/IndexerService/SearchService,
                          hooks IndexerService.tick() into sync-job completion handlers)
    renderer/
      components/
        GlobalSearchBar.tsx
        SearchScreen.tsx
        FilterChips.tsx
        SearchResultCard.tsx
        IndexingBanner.tsx
        FindSimilarButton.tsx
      pages/
        SearchPage.tsx
  electron-builder.yml   +asarUnpack for sqlite-vec + extraResources for ONNX model
  scripts/
    rebuild-native.js    +sqlite-vec to the per-arch rebuild list
```

## 10. Packaging

### 10.1 sqlite-vec extension

- Add `sqlite-vec` (root package) + `sqlite-vec-darwin-arm64` + `sqlite-vec-darwin-x64` to dependencies.
- `electron-builder.yml` `asarUnpack` adds: `node_modules/sqlite-vec/**`, `node_modules/sqlite-vec-darwin-*/**`, `**/*.dylib`.
- Each per-arch `.dylib` must be signed individually by the existing macOS signing pass.
- Resolve extension path at runtime via the `sqlite-vec` package's exported helper — works in both dev (`node_modules/...`) and packaged (`Resources/app.asar.unpacked/node_modules/...`). No hardcoded paths.
- Loaded in `openCoreDatabase()` immediately after pragmas, before `applyMigrations()`.

### 10.2 Embedding model assets

- Bundle `bge-small-en-v1.5` ONNX files at `apps/desktop/resources/models/bge-small-en-v1.5/`.
- Add to `electron-builder.yml` `extraResources`.
- `@xenova/transformers` `pipeline(..., { local_files_only: true, cache_dir: <bundled-path> })`.
- ~33 MB added to every DMG.

### 10.3 Cross-arch

Existing `scripts/rebuild-native.js` (from commit `64099dc` using `@electron/rebuild`) handles `better-sqlite3` per-arch. Extend same mechanism for sqlite-vec.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| sqlite-vec extension fails to load in packaged build | Detect early via `try { db.loadExtension(...) }`; fall back to FTS5-only mode with banner. Document the failure for the user but don't crash the app. |
| Signing/notarization rejects sqlite-vec dylib | Add to existing signing pass; verify per-release via packaging smoke test (§12.3). |
| Indexer slows down sync | Indexer yields between batches via `setImmediate`; non-blocking. Sync IPC stays responsive. Monitor in dev. |
| `@xenova/transformers` ONNX bug / corruption | EmbeddingService init wrapped in try/catch; disables semantic search gracefully on failure. |
| User corpus grows to 500 k+ and brute-force vector search exceeds 200 ms | Out of scope for v1. Phase 1.5 work: enable vec0 ANN with quantization (already supported by sqlite-vec). |
| Sync writes a malformed passage (empty body, NULLs) | Indexer trims/validates input; passages with empty body after trim get `status='failed'` and are skipped. Logged. |
| User edits passage body via Notion sync → roundtrip changes hash needlessly | Hash is computed from `passages.body` content only; if Notion-edit modifies wording, re-embed is correct. If it modifies only whitespace, the hash needs a normalization step (lowercase + collapse whitespace) before hashing. Adopt that normalization in `source_hash` computation. |
| Bundled embedding model becomes outdated | Model upgrade is a code-and-version-bump: change `model_id` constant, ship new ONNX in extraResources. `embedding_state.model_id` mismatch triggers auto-reindex. User sees banner; no manual action. |

## 12. Testing strategy

### 12.1 Unit tests (`packages/search/tests/`)

- `EmbeddingService`: vector dimensionality, determinism (cosine sim of same input ≥ 0.999), batch correctness (batch == sequential within float epsilon).
- `IndexerService`: backfill picks up unembedded; stale detection via `source_hash`; failed status not retried; model-id mismatch triggers full re-embed.
- `SearchService`: filter parsing (empty query, very short, archived/hidden defaults); retrieval (filter narrows correctly; RRF fusion gives expected order on fixture corpus; `matched_via` tagged correctly).
- Repository layer: insert/upsert/delete/cascade behaviors.
- Trigger behavior: passage body update clears state + vector and fires FTS5 update.

Test corpus: ~30 hand-picked passages in `packages/search/tests/fixtures/canonical-corpus.ts` with known semantic relationships (Aurelius on anger, Seneca on time, Aristotle on friendship, etc.). Hidden assertions like "query 'rage' returns Aurelius-on-anger above Aurelius-on-justice".

### 12.2 Integration tests (`apps/desktop/tests/`)

Reuse existing Playwright harness:

- Fresh install → first launch → migration runs, tables created.
- Sync test passages → wait for indexer → query returns sensible results.
- Edit passage body → re-query → results reflect edit (old vector gone, new one in).
- Delete passage → vector + FTS5 entries gone.
- Apply filter chip → candidate set narrowed.
- Simulated embedder load failure → search degrades to FTS5-only + banner.
- 1 000 fixture passages → indexed in <60 s, UI responsive throughout.

### 12.3 Packaging smoke tests (CI-blocking per release)

- `pnpm dev` works (extension loads from dev path).
- `pnpm --filter @archi/desktop package` produces signed DMG.
- Installed DMG → first launch → Search screen renders → indexer completes.
- Notarization passes with sqlite-vec dylibs.

### 12.4 Manual QA checklist

Living checklist in `docs/testing/search-v1.md`:

- [ ] First install no data: Search shows "Sync your highlights to get started"
- [ ] First install with synced data: indexing banner + progressive results (~15 s)
- [ ] Type "anger" with no filters: relevant results
- [ ] Type "anger" + Author chip "Marcus Aurelius": narrowed to Aurelius only
- [ ] Type "Meditations Book IV": FTS5 finds structural reference
- [ ] Click result: jumps to passage in Library
- [ ] `⌘K` from any screen focuses bar
- [ ] `⌘↵` opens full Search screen
- [ ] Edit passage body in Library → Search reflects within seconds
- [ ] Archive passage → no longer in search; unarchive → reappears
- [ ] Quit mid-indexing → relaunch resumes
- [ ] Force-quit during query → no DB corruption on relaunch
- [ ] Search screen renders at small window sizes

## 13. Migration & first-run experience

After upgrading to this version:

1. App launches normally.
2. Migration `version: 3` runs in-transaction: creates `passage_embeddings`, `passages_fts`, `embedding_state`, triggers, FTS5 rebuild backfill.
3. Embedder loads lazily on first Search screen open or first sync completion.
4. Indexer kicks off backfill (~15 s for 3 k, ~7 min for 100 k).
5. Search screen shows banner: "Indexing 412 of 3 141 highlights…"; results populate progressively.
6. FTS5 works immediately throughout.

## 14. Future considerations (not v1)

For the record, in priority order if the search feature lands well:

1. **"Find similar passages" passive surfacing** in the existing Passages screen sidebar.
2. **Cross-encoder re-ranking** (~50 MB bge-reranker-base on top-20) if users complain about ranking quality.
3. **NL filter extraction** ("show me what aurelius said about anger" → auto-apply creator filter via lightweight pattern matching on known author names).
4. **Saved searches / smart folders**.
5. **Chat synthesis (Phase 2)**: opt-in BYO-Ollama, or — if FoundationModels on macOS 26 reaches enough of the user base — a Swift helper that uses on-device Apple Intelligence with zero download.
6. **Multi-vector embeddings** if recall becomes a problem at very large corpus sizes.

## 15. Open questions to revisit during implementation

These were defaulted during brainstorming. Not blocking but worth surfacing once the code is in:

- **Embedding scope**: defaulted to `body` only. If users report "I can't find quotes by what I wrote in my note about them," we may need to add a second vector for `reader_note` (separate column, separate FTS5 column already exists) or concatenate at embed time.
- **Snippet length / highlight density**: defaulted to FTS5's default snippet config. Tune after seeing real results.
- **Default sort for filter-only / browse mode**: defaulted to `marked_at DESC`. Could be `ingested_at DESC` or starred-first.
- **Banner dismissal persistence**: defaulted to per-session. If users find it annoying, persist dismissal per indexing run.

---

**Approved direction**: Phase 1 ships semantic + keyword + metadata-filtered search over the existing `passages` table. Fully local, fully on-device, ~33 MB extra in the DMG, no external runtimes, no API keys. All chat / synthesis / LLM features explicitly deferred to a future Phase 2 with a separate spec.
