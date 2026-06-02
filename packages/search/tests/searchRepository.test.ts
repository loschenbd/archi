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
