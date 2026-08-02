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
        -- Explicit DELETE required: FK CASCADE only fires on DELETE of the parent row,
        -- not on UPDATE. Without these, embeddings go stale after a body/note edit.
        DELETE FROM embedding_state WHERE passage_id = new.id;
        DELETE FROM passage_embeddings WHERE passage_id = new.id;
      END;

      INSERT INTO passages_fts(passages_fts) VALUES ('rebuild');
    `
  },
  {
    version: 4,
    sql: `
      -- Maps a passage fingerprint to the Notion page it was written to, so a
      -- re-sync can skip the two dataSources.query lookups that otherwise
      -- precede every passage write. Notion throttles to ~3 requests/second
      -- per connection, so those lookups dominate backfill wall-clock.
      --
      -- Scoped by data source: repointing Archi at a different workspace or
      -- database must not resurrect page ids belonging to the old one.
      -- Purely a cache — safe to delete; entries that no longer resolve are
      -- detected and evicted during sync.
      CREATE TABLE IF NOT EXISTS notion_passage_pages (
        data_source_id   TEXT NOT NULL,
        fingerprint_hash TEXT NOT NULL,
        notion_page_id   TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        PRIMARY KEY (data_source_id, fingerprint_hash)
      );

      CREATE INDEX IF NOT EXISTS notion_passage_pages_fingerprint_idx
        ON notion_passage_pages(fingerprint_hash);
    `
  },
  {
    version: 5,
    sql: `
      -- Amazon serves "Sorry, we're unable to display this type of content."
      -- in place of the highlight text for books it won't render. Earlier
      -- versions ingested that string as if it were the reader's highlight,
      -- so it shows up in the library and in search results. The scraper now
      -- drops it; this retires the rows already stored.
      --
      -- Hidden rather than deleted: hiding is reversible and already
      -- respected by search (includeHidden defaults to false), and the rows
      -- still carry the position data that a future re-sync can reconcile.
      UPDATE passages
      SET is_hidden = 1
      WHERE is_hidden = 0
        AND body LIKE '%unable to display this type of content%';
    `
  },
  {
    version: 6,
    sql: `
      -- Spaced-resurfacing state. Rows are written lazily: a passage with no
      -- row is treated as never reviewed, with its half-life clock starting
      -- at when it was highlighted. That keeps this table proportional to
      -- what the reader has actually seen rather than to the library.
      CREATE TABLE IF NOT EXISTS passage_reviews (
        passage_id       TEXT PRIMARY KEY REFERENCES passages(id) ON DELETE CASCADE,
        half_life_days   REAL NOT NULL,
        last_reviewed_at TEXT NOT NULL,
        review_count     INTEGER NOT NULL DEFAULT 0,
        updated_at       TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS passage_reviews_last_reviewed_idx
        ON passage_reviews(last_reviewed_at);
    `
  }
];
