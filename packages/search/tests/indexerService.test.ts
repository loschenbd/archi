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
