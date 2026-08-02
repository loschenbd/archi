import type { CoreDatabase } from "../db/client.js";

/**
 * Local mapping from a passage fingerprint to the Notion page it was written
 * to, scoped by the Notion data source that owns the page.
 *
 * This is a pure cache. Deleting the table only costs extra API lookups on the
 * next sync, and any entry that no longer resolves in Notion is evicted
 * automatically when the destination fails to update it.
 */
export class NotionPageCacheRepository {
  constructor(private readonly db: CoreDatabase) {}

  get(dataSourceId: string, fingerprintHash: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT notion_page_id FROM notion_passage_pages
          WHERE data_source_id = ? AND fingerprint_hash = ?`
      )
      .get(dataSourceId, fingerprintHash) as { notion_page_id?: string } | undefined;
    return row?.notion_page_id;
  }

  set(dataSourceId: string, fingerprintHash: string, notionPageId: string): void {
    this.db
      .prepare(
        `INSERT INTO notion_passage_pages(data_source_id, fingerprint_hash, notion_page_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(data_source_id, fingerprint_hash) DO UPDATE SET
           notion_page_id = excluded.notion_page_id,
           updated_at     = excluded.updated_at`
      )
      .run(dataSourceId, fingerprintHash, notionPageId, new Date().toISOString());
  }

  delete(dataSourceId: string, fingerprintHash: string): void {
    this.db
      .prepare(`DELETE FROM notion_passage_pages WHERE data_source_id = ? AND fingerprint_hash = ?`)
      .run(dataSourceId, fingerprintHash);
  }

  /** Drops every mapping. Use when the Notion connection is reset. */
  clear(): void {
    this.db.prepare(`DELETE FROM notion_passage_pages`).run();
  }

  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS total FROM notion_passage_pages`).get() as { total: number };
    return row.total;
  }
}
