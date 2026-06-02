export const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS works (
        id TEXT PRIMARY KEY,
        ingest_source TEXT NOT NULL,
        external_id TEXT,
        display_title TEXT NOT NULL,
        raw_title TEXT NOT NULL,
        creator TEXT,
        work_type TEXT NOT NULL,
        store_identifier TEXT,
        cover_image_url TEXT,
        work_note TEXT,
        labels_json TEXT NOT NULL DEFAULT '[]',
        is_archived INTEGER NOT NULL DEFAULT 0,
        first_ingested_at TEXT NOT NULL,
        last_source_changed_at TEXT,
        last_synced_at TEXT,
        raw_payload_json TEXT
      );

      CREATE TABLE IF NOT EXISTS passages (
        id TEXT PRIMARY KEY,
        work_id TEXT NOT NULL,
        external_passage_id TEXT,
        body TEXT NOT NULL,
        reader_note TEXT,
        position_start TEXT,
        position_end TEXT,
        position_kind TEXT,
        marker_color TEXT,
        labels_json TEXT NOT NULL DEFAULT '[]',
        is_starred INTEGER NOT NULL DEFAULT 0,
        is_hidden INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0,
        marked_at TEXT,
        ingested_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        fingerprint_hash TEXT NOT NULL,
        raw_payload_json TEXT,
        FOREIGN KEY(work_id) REFERENCES works(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS passages_external_id_idx
      ON passages(external_passage_id)
      WHERE external_passage_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS passages_fingerprint_idx
      ON passages(fingerprint_hash);

      CREATE TABLE IF NOT EXISTS sync_jobs (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        resume_cursor TEXT,
        changed_after TEXT,
        last_success_at TEXT,
        last_attempt_at TEXT,
        last_error TEXT
      );
    `
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS cloud_book_sync_state (
        external_book_id TEXT PRIMARY KEY,
        fingerprint      TEXT NOT NULL,
        last_fetched_at  TEXT NOT NULL,
        last_seen_at     TEXT NOT NULL
      );
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
