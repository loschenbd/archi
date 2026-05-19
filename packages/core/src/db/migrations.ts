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
  }
];
