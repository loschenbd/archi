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
  // In dev, `app.getAppPath()` returns the directory of the entry JS
  // (apps/desktop/dist/main), not the package root — walk up two levels
  // to reach apps/desktop/, then into resources/models.
  const bundledModelRoot = app.isPackaged
    ? path.join(process.resourcesPath, "models")
    : path.resolve(app.getAppPath(), "../../resources/models");

  const embedder = new EmbeddingService({ bundledModelRoot });
  const repo = new SearchRepository(db);
  // batchSize=1: onnxruntime-node 1.14 (pinned by @xenova/transformers v2)
  // crashes the Electron main process with SIGTRAP inside
  // onnxruntime::BFCArena::Extend when running batches of 32 quantized
  // bge-small inferences on Apple Silicon — the arena exhausts after 3-6
  // batches. Single-call inference avoids the peak allocation and still
  // backfills 3k passages in ~2 minutes. Raise only after migrating to
  // @huggingface/transformers v4 (newer ORT) or moving the embedder to a
  // utility process where a crash can be recovered from.
  const indexer = new IndexerService({ db, repo, embedder, batchSize: 1 });
  const search = new SearchService({ db, repo, embedder });

  // Auto-startup tick disabled: the ONNX model load + backfill runs on the
  // Electron main thread and blocks the UI. Indexing is kicked from the
  // post-sync hook in main/index.ts and from the manual button in the
  // Search settings panel via the archi:search:startIndexing IPC.

  return { embedder, indexer, search };
}
