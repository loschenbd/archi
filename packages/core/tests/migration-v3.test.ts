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

  it("reader_note update clears embedding_state and passage_embeddings", () => {
    const db = openCoreDatabase(":memory:");
    const ingestedAt = "2026-06-02T00:00:00Z";
    db.prepare(
      `INSERT INTO works (id, ingest_source, display_title, raw_title, work_type, first_ingested_at)
       VALUES ('w1','device-export','Meditations','Meditations','book',?)`
    ).run(ingestedAt);
    db.prepare(
      `INSERT INTO passages (id, work_id, body, reader_note, ingested_at, updated_at, fingerprint_hash)
       VALUES ('p1','w1','body','original note',?,?, 'fp1')`
    ).run(ingestedAt, ingestedAt);
    db.prepare(
      `INSERT INTO embedding_state (passage_id, model_id, embedded_at, source_hash, status)
       VALUES ('p1','bge-small-en-v1.5@v1',?, 'hash1','ok')`
    ).run(ingestedAt);
    const zeroVec = Buffer.alloc(384 * 4);
    db.prepare("INSERT INTO passage_embeddings (passage_id, embedding) VALUES ('p1', ?)").run(zeroVec);

    db.prepare("UPDATE passages SET reader_note = 'new note' WHERE id = 'p1'").run();

    expect(db.prepare("SELECT * FROM embedding_state WHERE passage_id = 'p1'").get()).toBeUndefined();
    expect(db.prepare("SELECT * FROM passage_embeddings WHERE passage_id = 'p1'").get()).toBeUndefined();
    db.close();
  });

  it("updating an unrelated column does NOT invalidate embedding_state or passage_embeddings", () => {
    const db = openCoreDatabase(":memory:");
    const ingestedAt = "2026-06-02T00:00:00Z";
    db.prepare(
      `INSERT INTO works (id, ingest_source, display_title, raw_title, work_type, first_ingested_at)
       VALUES ('w1','device-export','Meditations','Meditations','book',?)`
    ).run(ingestedAt);
    db.prepare(
      `INSERT INTO passages (id, work_id, body, ingested_at, updated_at, fingerprint_hash)
       VALUES ('p1','w1','body',?,?, 'fp1')`
    ).run(ingestedAt, ingestedAt);
    db.prepare(
      `INSERT INTO embedding_state (passage_id, model_id, embedded_at, source_hash, status)
       VALUES ('p1','bge-small-en-v1.5@v1',?, 'hash1','ok')`
    ).run(ingestedAt);
    const zeroVec = Buffer.alloc(384 * 4);
    db.prepare("INSERT INTO passage_embeddings (passage_id, embedding) VALUES ('p1', ?)").run(zeroVec);

    db.prepare("UPDATE passages SET is_starred = 1 WHERE id = 'p1'").run();

    expect(db.prepare("SELECT * FROM embedding_state WHERE passage_id = 'p1'").get()).toBeTruthy();
    expect(db.prepare("SELECT * FROM passage_embeddings WHERE passage_id = 'p1'").get()).toBeTruthy();
    db.close();
  });

  it("deleting a passage CASCADEs embedding_state cleanup", () => {
    const db = openCoreDatabase(":memory:");
    const ingestedAt = "2026-06-02T00:00:00Z";
    db.prepare(
      `INSERT INTO works (id, ingest_source, display_title, raw_title, work_type, first_ingested_at)
       VALUES ('w1','device-export','Meditations','Meditations','book',?)`
    ).run(ingestedAt);
    db.prepare(
      `INSERT INTO passages (id, work_id, body, ingested_at, updated_at, fingerprint_hash)
       VALUES ('p1','w1','body',?,?, 'fp1')`
    ).run(ingestedAt, ingestedAt);
    db.prepare(
      `INSERT INTO embedding_state (passage_id, model_id, embedded_at, source_hash, status)
       VALUES ('p1','bge-small-en-v1.5@v1',?, 'hash1','ok')`
    ).run(ingestedAt);

    db.prepare("DELETE FROM passages WHERE id = 'p1'").run();

    expect(db.prepare("SELECT * FROM embedding_state WHERE passage_id = 'p1'").get()).toBeUndefined();
    db.close();
  });

  it("FTS5 rebuild backfills from passages inserted before migration v3", () => {
    // Simulate the production upgrade path: a DB that already has passages from v1/v2,
    // then migration v3 runs and the rebuild call populates FTS5 from existing rows.
    // We can't easily roll back the migrations, so we delete from passages_fts to
    // simulate "FTS5 is empty," then re-run rebuild and confirm it repopulates.
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

    // Empty the FTS5 index — simulating the state right before rebuild.
    db.exec("INSERT INTO passages_fts(passages_fts) VALUES ('delete-all')");
    expect(
      db.prepare("SELECT body FROM passages_fts WHERE passages_fts MATCH 'anger'").get()
    ).toBeUndefined();

    // Re-run rebuild — this is what the migration's final statement does on upgrade.
    db.exec("INSERT INTO passages_fts(passages_fts) VALUES ('rebuild')");

    const row = db
      .prepare("SELECT body FROM passages_fts WHERE passages_fts MATCH 'anger'")
      .get() as { body: string } | undefined;
    expect(row?.body).toBe("Anger cannot be dishonest.");
    db.close();
  });
});
