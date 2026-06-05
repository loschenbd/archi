import type { CoreDatabase } from "@archi/core";
import { EMBEDDING_MODEL_ID } from "../types.js";
import type { Facets } from "../types.js";

export type PendingPassage = {
  id: string;
  body: string;
};

export type KnnHit = {
  passage_id: string;
  distance: number;
};

export type FtsHit = {
  passage_id: string;
  bm25: number;
  fts_snippet: string | null;
};

function vectorToBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export class SearchRepository {
  constructor(private readonly db: CoreDatabase) {}

  upsertEmbedding(passageId: string, vector: Float32Array, sourceHash: string): void {
    const ts = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db
        .prepare("INSERT OR REPLACE INTO passage_embeddings (passage_id, embedding) VALUES (?, ?)")
        .run(passageId, vectorToBuffer(vector));
      this.db
        .prepare(
          `INSERT OR REPLACE INTO embedding_state (passage_id, model_id, embedded_at, source_hash, status)
           VALUES (?, ?, ?, ?, 'ok')`
        )
        .run(passageId, EMBEDDING_MODEL_ID, ts, sourceHash);
    });
    tx();
  }

  recordEmbeddingFailure(passageId: string, sourceHash: string, errorMessage: string): void {
    const ts = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO embedding_state (passage_id, model_id, embedded_at, source_hash, status)
         VALUES (?, ?, ?, ?, 'failed')`
      )
      .run(passageId, EMBEDDING_MODEL_ID, ts, sourceHash);
    // We intentionally don't persist the error string per row to keep the table small;
    // a single rolling lastError is held in-memory by IndexerService.
    void errorMessage;
  }

  fetchPendingForModel(modelId: string, limit: number): PendingPassage[] {
    return this.db
      .prepare(
        `SELECT p.id AS id, p.body AS body
         FROM passages p
         LEFT JOIN embedding_state s
           ON s.passage_id = p.id AND s.model_id = ?
         WHERE s.passage_id IS NULL
            OR (s.status != 'ok' AND s.status != 'failed')
         LIMIT ?`
      )
      .all(modelId, limit) as PendingPassage[];
  }

  countPassages(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM passages").get() as { c: number };
    return Number(row.c);
  }

  countIndexed(modelId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM embedding_state WHERE model_id = ? AND status = 'ok'")
      .get(modelId) as { c: number };
    return Number(row.c);
  }

  countFailed(modelId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM embedding_state WHERE model_id = ? AND status = 'failed'")
      .get(modelId) as { c: number };
    return Number(row.c);
  }

  /**
   * Read back a previously-indexed embedding for a single passage. Returns
   * null if the passage has no embedding row (not yet indexed, or the vector
   * was invalidated by an edit). Used by the find-similar mode to seed a
   * vector-only KNN without re-embedding the passage body.
   */
  getEmbeddingForPassage(passageId: string): Float32Array | null {
    const row = this.db
      .prepare("SELECT embedding FROM passage_embeddings WHERE passage_id = ?")
      .get(passageId) as { embedding: Buffer | Uint8Array } | undefined;
    if (!row || !row.embedding) {
      return null;
    }
    // vec0 returns the embedding column as a raw byte blob; reconstruct the
    // Float32Array view over the same underlying memory.
    const buf = row.embedding;
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }

  knnByPassageIds(query: Float32Array, candidateIds: string[], k: number): KnnHit[] {
    if (candidateIds.length === 0) {
      return [];
    }
    const placeholders = candidateIds.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT passage_id, distance
         FROM passage_embeddings
         WHERE embedding MATCH ?
           AND k = ?
           AND passage_id IN (${placeholders})
         ORDER BY distance`
      )
      .all(vectorToBuffer(query), k, ...candidateIds) as KnnHit[];
  }

  ftsSearchInIds(query: string, candidateIds: string[]): FtsHit[] {
    if (candidateIds.length === 0 || query.trim().length === 0) {
      return [];
    }
    const placeholders = candidateIds.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT p.id AS passage_id, bm25(passages_fts) AS bm25,
                snippet(passages_fts, 0, '<mark>', '</mark>', '…', 32) AS fts_snippet
         FROM passages_fts
         JOIN passages p ON p.rowid = passages_fts.rowid
         WHERE passages_fts MATCH ?
           AND p.id IN (${placeholders})
         ORDER BY bm25`
      )
      .all(query, ...candidateIds) as FtsHit[];
  }

  // Used to build the candidate set when the user has filters but no free-text query.
  fetchCandidatesSql(sql: string, params: unknown[]): string[] {
    return (this.db.prepare(sql).all(...params) as Array<{ id: string }>).map((r) => r.id);
  }

  getFacets(): Facets {
    const creatorRows = this.db
      .prepare(
        `SELECT DISTINCT creator
           FROM works
          WHERE creator IS NOT NULL AND creator != ''
          ORDER BY creator COLLATE NOCASE`
      )
      .all() as { creator: string }[];

    const labelRows = this.db
      .prepare(
        `SELECT DISTINCT value
           FROM passages, json_each(passages.labels_json)
          WHERE passages.labels_json IS NOT NULL
          ORDER BY value COLLATE NOCASE`
      )
      .all() as { value: string }[];

    return {
      creators: creatorRows.map((r) => r.creator),
      labels: labelRows.map((r) => r.value)
    };
  }
}
