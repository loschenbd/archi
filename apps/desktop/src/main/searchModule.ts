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
  const indexer = new IndexerService({ db, repo, embedder, batchSize: 32 });
  const search = new SearchService({ db, repo, embedder });

  // TEMPORARY for dev-mode testing: auto-startup tick disabled because the
  // ONNX model load currently runs on the Electron main thread and blocks
  // the UI for the duration of the backfill. Trigger indexing manually via
  // post-sync hooks or a future on-demand button. Will be re-enabled once
  // the embedder runs in a Worker thread (Phase 1.5 follow-up).
  // setImmediate(() => indexer.tick());

  return { embedder, indexer, search };
}
