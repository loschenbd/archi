import crypto from "node:crypto";
import type { CoreDatabase } from "../db/client.js";
import type { Passage, SyncJob, SyncJobStatus, Work } from "../types.js";

export type CloudBookSyncState = {
  externalBookId: string;
  fingerprint: string;
  lastFetchedAt: string;   // ISO timestamp; only advanced on successful extraction
  lastSeenAt: string;      // ISO timestamp; advanced whenever the book appears in the sidebar
};

function asJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function parseJsonStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
}

function parseJson(value: string | null): unknown | undefined {
  return value ? JSON.parse(value) : undefined;
}

export class CoreRepository {
  constructor(private readonly db: CoreDatabase) {}

  upsertWork(work: Work): void {
    this.db
      .prepare(
        `INSERT INTO works (
           id, ingest_source, external_id, display_title, raw_title, creator, work_type, store_identifier,
           cover_image_url, work_note, labels_json, is_archived, first_ingested_at, last_source_changed_at, last_synced_at, raw_payload_json
         ) VALUES (
           @id, @ingestSource, @externalId, @displayTitle, @rawTitle, @creator, @workType, @storeIdentifier,
           @coverImageUrl, @workNote, @labelsJson, @isArchived, @firstIngestedAt, @lastSourceChangedAt, @lastSyncedAt, @rawPayloadJson
         )
         ON CONFLICT(id) DO UPDATE SET
           ingest_source=excluded.ingest_source,
           external_id=excluded.external_id,
           display_title=excluded.display_title,
           raw_title=excluded.raw_title,
           creator=excluded.creator,
           work_type=excluded.work_type,
           store_identifier=excluded.store_identifier,
           cover_image_url=excluded.cover_image_url,
           work_note=excluded.work_note,
           labels_json=excluded.labels_json,
           is_archived=excluded.is_archived,
           last_source_changed_at=excluded.last_source_changed_at,
           last_synced_at=excluded.last_synced_at,
           raw_payload_json=excluded.raw_payload_json`
      )
      .run({
        id: work.id,
        ingestSource: work.ingestSource,
        externalId: work.externalId ?? null,
        displayTitle: work.displayTitle,
        rawTitle: work.rawTitle,
        creator: work.creator ?? null,
        workType: work.workType,
        storeIdentifier: work.storeIdentifier ?? null,
        coverImageUrl: work.coverImageUrl ?? null,
        workNote: work.workNote ?? null,
        labelsJson: JSON.stringify(work.labels),
        isArchived: work.isArchived ? 1 : 0,
        firstIngestedAt: work.firstIngestedAt,
        lastSourceChangedAt: work.lastSourceChangedAt ?? null,
        lastSyncedAt: work.lastSyncedAt ?? null,
        rawPayloadJson: asJson(work.rawPayload)
      });
  }

  upsertPassage(passage: Passage): void {
    this.db
      .prepare(
        `INSERT INTO passages (
           id, work_id, external_passage_id, body, reader_note, position_start, position_end, position_kind,
           marker_color, labels_json, is_starred, is_hidden, is_archived, marked_at, ingested_at, updated_at, fingerprint_hash, raw_payload_json
         ) VALUES (
           @id, @workId, @externalPassageId, @body, @readerNote, @positionStart, @positionEnd, @positionKind,
           @markerColor, @labelsJson, @isStarred, @isHidden, @isArchived, @markedAt, @ingestedAt, @updatedAt, @fingerprintHash, @rawPayloadJson
         )
         ON CONFLICT(external_passage_id) WHERE external_passage_id IS NOT NULL DO UPDATE SET
          work_id=excluded.work_id,
           body=excluded.body,
           reader_note=excluded.reader_note,
           position_start=excluded.position_start,
           position_end=excluded.position_end,
           position_kind=excluded.position_kind,
           marker_color=excluded.marker_color,
           labels_json=excluded.labels_json,
           is_starred=excluded.is_starred,
           is_hidden=excluded.is_hidden,
           is_archived=excluded.is_archived,
           marked_at=excluded.marked_at,
           updated_at=excluded.updated_at,
           raw_payload_json=excluded.raw_payload_json
         ON CONFLICT(fingerprint_hash) DO UPDATE SET
         work_id=passages.work_id,
           external_passage_id=COALESCE(excluded.external_passage_id, passages.external_passage_id),
           body=excluded.body,
           reader_note=excluded.reader_note,
           position_start=excluded.position_start,
           position_end=excluded.position_end,
           position_kind=excluded.position_kind,
           marker_color=excluded.marker_color,
           labels_json=excluded.labels_json,
           is_starred=excluded.is_starred,
           is_hidden=excluded.is_hidden,
           is_archived=excluded.is_archived,
           marked_at=excluded.marked_at,
           updated_at=excluded.updated_at,
           raw_payload_json=excluded.raw_payload_json
         WHERE passages.work_id = excluded.work_id`
      )
      .run({
        id: passage.id,
        workId: passage.workId,
        externalPassageId: passage.externalPassageId ?? null,
        body: passage.body,
        readerNote: passage.readerNote ?? null,
        positionStart: passage.positionStart ?? null,
        positionEnd: passage.positionEnd ?? null,
        positionKind: passage.positionKind ?? null,
        markerColor: passage.markerColor ?? null,
        labelsJson: JSON.stringify(passage.labels),
        isStarred: passage.isStarred ? 1 : 0,
        isHidden: passage.isHidden ? 1 : 0,
        isArchived: passage.isArchived ? 1 : 0,
        markedAt: passage.markedAt ?? null,
        ingestedAt: passage.ingestedAt,
        updatedAt: passage.updatedAt,
        fingerprintHash: passage.fingerprintHash,
        rawPayloadJson: asJson(passage.rawPayload)
      });
  }

  listWorks(): Work[] {
    const rows = this.db.prepare("SELECT * FROM works ORDER BY display_title ASC").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      ingestSource: row.ingest_source as Work["ingestSource"],
      externalId: (row.external_id as string | null) ?? undefined,
      displayTitle: String(row.display_title),
      rawTitle: String(row.raw_title),
      creator: (row.creator as string | null) ?? undefined,
      workType: row.work_type as Work["workType"],
      storeIdentifier: (row.store_identifier as string | null) ?? undefined,
      coverImageUrl: (row.cover_image_url as string | null) ?? undefined,
      workNote: (row.work_note as string | null) ?? undefined,
      labels: parseJsonStringArray(String(row.labels_json)),
      isArchived: Number(row.is_archived) === 1,
      firstIngestedAt: String(row.first_ingested_at),
      lastSourceChangedAt: (row.last_source_changed_at as string | null) ?? undefined,
      lastSyncedAt: (row.last_synced_at as string | null) ?? undefined,
      rawPayload: parseJson((row.raw_payload_json as string | null) ?? null)
    }));
  }

  listPassagesByWorkId(workId: string): Passage[] {
    const rows = this.db
      .prepare("SELECT * FROM passages WHERE work_id = ? ORDER BY COALESCE(marked_at, ingested_at) DESC")
      .all(workId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      workId: String(row.work_id),
      externalPassageId: (row.external_passage_id as string | null) ?? undefined,
      body: String(row.body),
      readerNote: (row.reader_note as string | null) ?? undefined,
      positionStart: (row.position_start as string | null) ?? undefined,
      positionEnd: (row.position_end as string | null) ?? undefined,
      positionKind: (row.position_kind as Passage["positionKind"]) ?? undefined,
      markerColor: (row.marker_color as string | null) ?? undefined,
      labels: parseJsonStringArray(String(row.labels_json)),
      isStarred: Number(row.is_starred) === 1,
      isHidden: Number(row.is_hidden) === 1,
      isArchived: Number(row.is_archived) === 1,
      markedAt: (row.marked_at as string | null) ?? undefined,
      ingestedAt: String(row.ingested_at),
      updatedAt: String(row.updated_at),
      fingerprintHash: String(row.fingerprint_hash),
      rawPayload: parseJson((row.raw_payload_json as string | null) ?? null)
    }));
  }

  listPassages(): Passage[] {
    const rows = this.db.prepare("SELECT * FROM passages ORDER BY COALESCE(marked_at, ingested_at) DESC").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      workId: String(row.work_id),
      externalPassageId: (row.external_passage_id as string | null) ?? undefined,
      body: String(row.body),
      readerNote: (row.reader_note as string | null) ?? undefined,
      positionStart: (row.position_start as string | null) ?? undefined,
      positionEnd: (row.position_end as string | null) ?? undefined,
      positionKind: (row.position_kind as Passage["positionKind"]) ?? undefined,
      markerColor: (row.marker_color as string | null) ?? undefined,
      labels: parseJsonStringArray(String(row.labels_json)),
      isStarred: Number(row.is_starred) === 1,
      isHidden: Number(row.is_hidden) === 1,
      isArchived: Number(row.is_archived) === 1,
      markedAt: (row.marked_at as string | null) ?? undefined,
      ingestedAt: String(row.ingested_at),
      updatedAt: String(row.updated_at),
      fingerprintHash: String(row.fingerprint_hash),
      rawPayload: parseJson((row.raw_payload_json as string | null) ?? null)
    }));
  }

  countCloudPassages(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM passages
         WHERE work_id IN (
           SELECT id FROM works WHERE ingest_source = 'cloud-notebook'
         )`
      )
      .get() as { total: number };
    return Number(row.total ?? 0);
  }

  countCloudWorks(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS total FROM works WHERE ingest_source = 'cloud-notebook'")
      .get() as { total: number };
    return Number(row.total ?? 0);
  }

  deleteCloudPassagesNotInExternalIds(externalPassageIds: string[]): number {
    if (externalPassageIds.length === 0) {
      const result = this.db
        .prepare(
          `DELETE FROM passages
           WHERE work_id IN (
             SELECT id FROM works WHERE ingest_source = 'cloud-notebook'
           )`
        )
        .run();
      return result.changes;
    }

    const placeholders = externalPassageIds.map(() => "?").join(", ");
    const statement = this.db.prepare(
      `DELETE FROM passages
       WHERE work_id IN (
         SELECT id FROM works WHERE ingest_source = 'cloud-notebook'
       )
       AND (
         external_passage_id IS NULL
         OR external_passage_id NOT IN (${placeholders})
       )`
    );
    const result = statement.run(...externalPassageIds);
    return result.changes;
  }

  getCloudBookSyncStates(): Map<string, { fingerprint: string; lastFetchedAt: string; lastSeenAt: string }> {
    const rows = this.db
      .prepare(
        "SELECT external_book_id, fingerprint, last_fetched_at, last_seen_at FROM cloud_book_sync_state"
      )
      .all() as Array<{
      external_book_id: string;
      fingerprint: string;
      last_fetched_at: string;
      last_seen_at: string;
    }>;
    const out = new Map<string, { fingerprint: string; lastFetchedAt: string; lastSeenAt: string }>();
    for (const row of rows) {
      out.set(row.external_book_id, {
        fingerprint: row.fingerprint,
        lastFetchedAt: row.last_fetched_at,
        lastSeenAt: row.last_seen_at
      });
    }
    return out;
  }

  upsertCloudBookSyncState(args: {
    externalBookId: string;
    fingerprint: string;
    fetchedAt: string;
    seenAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO cloud_book_sync_state (external_book_id, fingerprint, last_fetched_at, last_seen_at)
         VALUES (@externalBookId, @fingerprint, @fetchedAt, @seenAt)
         ON CONFLICT(external_book_id) DO UPDATE SET
           fingerprint = excluded.fingerprint,
           last_fetched_at = excluded.last_fetched_at,
           last_seen_at = excluded.last_seen_at`
      )
      .run(args);
  }

  markCloudBookSeen(externalBookId: string, seenAt: string): void {
    // No-op if the row doesn't exist. We do not insert here -- we only track books we've extracted.
    this.db
      .prepare(
        "UPDATE cloud_book_sync_state SET last_seen_at = @seenAt WHERE external_book_id = @externalBookId"
      )
      .run({ externalBookId, seenAt });
  }

  pruneCloudBookSyncStatesNotIn(seenBookIds: string[]): number {
    if (seenBookIds.length === 0) {
      const result = this.db.prepare("DELETE FROM cloud_book_sync_state").run();
      return result.changes;
    }
    const placeholders = seenBookIds.map(() => "?").join(",");
    const result = this.db
      .prepare(`DELETE FROM cloud_book_sync_state WHERE external_book_id NOT IN (${placeholders})`)
      .run(...seenBookIds);
    return result.changes;
  }

  deleteCloudPassagesInBooksNotInExternalIds(
    bookExternalIds: string[],
    retainedPassageExternalIds: string[]
  ): number {
    if (bookExternalIds.length === 0) {
      return 0;
    }
    const bookPlaceholders = bookExternalIds.map(() => "?").join(",");
    const retainedClause =
      retainedPassageExternalIds.length === 0
        ? ""
        : ` AND passages.external_passage_id NOT IN (${retainedPassageExternalIds.map(() => "?").join(",")})`;
    const sql = `
      DELETE FROM passages
      WHERE work_id IN (
        SELECT id FROM works
        WHERE ingest_source = 'cloud-notebook'
          AND external_id IN (${bookPlaceholders})
      )
      ${retainedClause || "AND 1=1"}
    `;
    // When retainedPassageExternalIds is empty, the clause above degenerates to "AND 1=1",
    // which means "delete every passage in the in-scope books." That is intentional and matches
    // the spec: if a book was extracted and produced zero passages, all prior passages for it
    // are stale by definition.
    const params = [...bookExternalIds, ...retainedPassageExternalIds];
    const result = this.db.prepare(sql).run(...params);
    return result.changes;
  }

  deleteCloudWorksByExternalIdsNotIn(sidebarBookExternalIds: string[]): number {
    if (sidebarBookExternalIds.length === 0) {
      const result = this.db
        .prepare("DELETE FROM works WHERE ingest_source = 'cloud-notebook'")
        .run();
      return result.changes;
    }
    const placeholders = sidebarBookExternalIds.map(() => "?").join(",");
    const result = this.db
      .prepare(
        `DELETE FROM works
         WHERE ingest_source = 'cloud-notebook'
           AND (external_id IS NULL OR external_id NOT IN (${placeholders}))`
      )
      .run(...sidebarBookExternalIds);
    return result.changes;
  }

  deleteEmptyCloudWorksByExternalIds(bookExternalIds: string[]): number {
    if (bookExternalIds.length === 0) {
      return 0;
    }
    const placeholders = bookExternalIds.map(() => "?").join(",");
    const result = this.db
      .prepare(
        `DELETE FROM works
         WHERE ingest_source = 'cloud-notebook'
           AND external_id IN (${placeholders})
           AND id NOT IN (SELECT DISTINCT work_id FROM passages)`
      )
      .run(...bookExternalIds);
    return result.changes;
  }

  backfillCloudPassagePositions(
    decode: (externalPassageId: string) => { positionStart: string; positionKind: "location" } | null
  ): number {
    const rows = this.db
      .prepare(
        `SELECT id, external_passage_id
         FROM passages
         WHERE external_passage_id IS NOT NULL
           AND (position_kind IS NULL OR position_kind = 'unknown' OR position_start IS NULL OR position_start = '')`
      )
      .all() as Array<{ id: string; external_passage_id: string }>;
    if (rows.length === 0) {
      return 0;
    }
    const update = this.db.prepare(
      `UPDATE passages SET position_start = @positionStart, position_kind = @positionKind WHERE id = @id`
    );
    const txn = this.db.transaction((items: Array<{ id: string; external_passage_id: string }>) => {
      let updated = 0;
      for (const item of items) {
        const decoded = decode(item.external_passage_id);
        if (!decoded) {
          continue;
        }
        update.run({ id: item.id, positionStart: decoded.positionStart, positionKind: decoded.positionKind });
        updated += 1;
      }
      return updated;
    });
    return txn(rows) as number;
  }

  deleteEmptyCloudWorks(): number {
    const result = this.db
      .prepare(
        `DELETE FROM works
         WHERE ingest_source = 'cloud-notebook'
         AND id NOT IN (
           SELECT DISTINCT work_id FROM passages
         )`
      )
      .run();
    return result.changes;
  }

  getSyncJob(source: SyncJob["source"]): SyncJob | null {
    const row = this.db.prepare("SELECT * FROM sync_jobs WHERE source = ?").get(source) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return {
      id: String(row.id),
      source: row.source as SyncJob["source"],
      status: row.status as SyncJobStatus,
      resumeCursor: (row.resume_cursor as string | null) ?? undefined,
      changedAfter: (row.changed_after as string | null) ?? undefined,
      lastSuccessAt: (row.last_success_at as string | null) ?? undefined,
      lastAttemptAt: (row.last_attempt_at as string | null) ?? undefined,
      lastError: (row.last_error as string | null) ?? undefined
    };
  }

  upsertSyncJob(job: SyncJob): void {
    this.db
      .prepare(
        `INSERT INTO sync_jobs (
           id, source, status, resume_cursor, changed_after, last_success_at, last_attempt_at, last_error
         ) VALUES (
           @id, @source, @status, @resumeCursor, @changedAfter, @lastSuccessAt, @lastAttemptAt, @lastError
         )
         ON CONFLICT(source) DO UPDATE SET
           id=excluded.id,
           status=excluded.status,
           resume_cursor=excluded.resume_cursor,
           changed_after=excluded.changed_after,
           last_success_at=excluded.last_success_at,
           last_attempt_at=excluded.last_attempt_at,
           last_error=excluded.last_error`
      )
      .run({
        id: job.id,
        source: job.source,
        status: job.status,
        resumeCursor: job.resumeCursor ?? null,
        changedAfter: job.changedAfter ?? null,
        lastSuccessAt: job.lastSuccessAt ?? null,
        lastAttemptAt: job.lastAttemptAt ?? null,
        lastError: job.lastError ?? null
      });
  }

  createDeterministicId(seed: string): string {
    return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);
  }
}
