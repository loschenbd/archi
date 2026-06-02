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
