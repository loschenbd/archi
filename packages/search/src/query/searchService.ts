import type { CoreDatabase } from "@archi/core";
import type { EmbeddingService } from "../embedding/embeddingService.js";
import type { SearchRepository } from "../repositories/searchRepository.js";
import { buildCandidateSql } from "./filterSql.js";
import { fuseRrf } from "./rrf.js";
import type {
  Facets,
  SearchFilters,
  SearchQuery,
  SearchResponse,
  SearchResult
} from "../types.js";

export type SearchServiceOptions = {
  db: CoreDatabase;
  repo: SearchRepository;
  embedder: EmbeddingService;
  defaultIncludeArchived?: boolean;
  defaultIncludeHidden?: boolean;
};

const MIN_QUERY_LENGTH = 2;
const RRF_K = 60;
// Guard against the SQLite parameter limit on the candidate-set placeholders
// in knnByPassageIds/ftsSearchInIds. 30k is comfortably below
// SQLITE_MAX_VARIABLE_NUMBER (typically 32766) even on older builds.
const MAX_CANDIDATE_IDS = 30_000;
/**
 * Cosine-distance ceiling for a vector-only hit to count as a match.
 *
 * KNN always returns k neighbours, however far away they are, so without a
 * floor a nonsense query ("xyzzy plugh frobnicate") returned a full page of
 * confident-looking, unrelated passages and the "No matches" state was
 * unreachable.
 *
 * Calibrated against a 3,135-passage library on bge-small-en-v1.5. Real
 * queries land at 0.61–0.90 and keep every result at this ceiling; nonsense
 * queries start at 0.89–0.95 and collapse to 0–1 results. 0.95 lets junk
 * through; 0.90 starts trimming genuine matches.
 *
 * Only vector-only hits are gated — an exact keyword hit is meaningful
 * regardless of how far apart the embeddings are.
 */
const MAX_VECTOR_DISTANCE = 0.92;

export class SearchService {
  constructor(private readonly options: SearchServiceOptions) {}

  getFacets(): Facets {
    return this.options.repo.getFacets();
  }

  async query(q: SearchQuery): Promise<SearchResponse> {
    const start = Date.now();
    const filters = this.resolveDefaults(q.filters);

    // Find-similar mode: skip text/FTS5 entirely; do vector-only KNN against
    // the source passage's already-indexed embedding and exclude the source
    // id from results. `q.text` is ignored. If the source passage has no
    // embedding yet (not indexed, or invalidated by an edit), return empty.
    if (q.findSimilarPassageId) {
      const sourceEmbedding = this.options.repo.getEmbeddingForPassage(q.findSimilarPassageId);
      if (!sourceEmbedding) {
        return {
          query: "",
          filters,
          results: [],
          totalCandidates: 0,
          durationMs: Date.now() - start
        };
      }
      const candidate = buildCandidateSql(filters);
      const candidateIds = this.options.repo
        .fetchCandidatesSql(candidate.sql, candidate.params)
        .slice(0, MAX_CANDIDATE_IDS)
        .filter((id) => id !== q.findSimilarPassageId);

      const results = this.findSimilarMode(sourceEmbedding, candidateIds, q.limit);
      return {
        query: "",
        filters,
        results,
        totalCandidates: candidateIds.length,
        durationMs: Date.now() - start
      };
    }

    const candidate = buildCandidateSql(filters);
    const candidateIds = this.options.repo
      .fetchCandidatesSql(candidate.sql, candidate.params)
      .slice(0, MAX_CANDIDATE_IDS);

    const trimmed = q.text.trim();
    const isBrowse = trimmed.length < MIN_QUERY_LENGTH;

    let results: SearchResult[];
    if (isBrowse) {
      results = this.browseMode(candidateIds, q.limit);
    } else {
      results = await this.rankedMode(trimmed, candidateIds, q.limit);
    }

    return {
      query: q.text,
      filters,
      results,
      totalCandidates: candidateIds.length,
      durationMs: Date.now() - start
    };
  }

  getResultsByIds(passageIds: string[]): SearchResult[] {
    if (passageIds.length === 0) return [];
    const placeholders = passageIds.map(() => "?").join(",");
    const rows = this.options.db
      .prepare(
        `SELECT p.id AS passage_id, p.body, p.reader_note, p.position_start, p.position_end,
                p.marked_at, p.is_starred, p.labels_json,
                w.id AS work_id, w.display_title, w.creator, w.cover_image_url
         FROM passages p
         JOIN works w ON p.work_id = w.id
         WHERE p.id IN (${placeholders})`
      )
      .all(...passageIds) as Array<Record<string, unknown>>;
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      byId.set(String(row.passage_id), row);
    }
    return passageIds
      .map((id) => byId.get(id))
      .filter((r): r is Record<string, unknown> => r !== undefined)
      .map((row) => hydrateResult(row, { fused: 0 }, "fts5"));
  }

  private findSimilarMode(
    sourceEmbedding: Float32Array,
    candidateIds: string[],
    limit: number
  ): SearchResult[] {
    if (candidateIds.length === 0) {
      return [];
    }
    const vecHits = this.options.repo.knnByPassageIds(sourceEmbedding, candidateIds, limit);
    if (vecHits.length === 0) {
      return [];
    }
    const idsInOrder = vecHits.map((h) => h.passage_id);
    const placeholders = idsInOrder.map(() => "?").join(",");
    const rows = this.options.db
      .prepare(
        `SELECT p.id AS passage_id, p.body, p.reader_note, p.position_start, p.position_end,
                p.marked_at, p.is_starred, p.labels_json,
                w.id AS work_id, w.display_title, w.creator, w.cover_image_url
         FROM passages p
         JOIN works w ON p.work_id = w.id
         WHERE p.id IN (${placeholders})`
      )
      .all(...idsInOrder) as Array<Record<string, unknown>>;
    const rowsById = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      rowsById.set(String(row.passage_id), row);
    }
    return vecHits
      .map((hit) => {
        const row = rowsById.get(hit.passage_id);
        if (!row) return null;
        return hydrateResult(
          row,
          { fused: 1 / (1 + hit.distance), vectorDistance: hit.distance },
          "vector"
        );
      })
      .filter((r): r is SearchResult => r !== null);
  }

  private resolveDefaults(filters: SearchFilters): SearchFilters {
    return {
      ...filters,
      isArchived: filters.isArchived ?? this.options.defaultIncludeArchived ?? false,
      isHidden: filters.isHidden ?? this.options.defaultIncludeHidden ?? false
    };
  }

  private browseMode(candidateIds: string[], limit: number): SearchResult[] {
    if (candidateIds.length === 0) {
      return [];
    }
    const placeholders = candidateIds.map(() => "?").join(",");
    const rows = this.options.db
      .prepare(
        `SELECT p.id AS passage_id, p.body, p.reader_note, p.position_start, p.position_end,
                p.marked_at, p.is_starred, p.labels_json,
                w.id AS work_id, w.display_title, w.creator, w.cover_image_url
         FROM passages p
         JOIN works w ON p.work_id = w.id
         WHERE p.id IN (${placeholders})
         ORDER BY COALESCE(p.marked_at, p.ingested_at) DESC
         LIMIT ?`
      )
      .all(...candidateIds, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => hydrateResult(row, { fused: 0 }, "fts5"));
  }

  private async rankedMode(
    text: string,
    candidateIds: string[],
    limit: number
  ): Promise<SearchResult[]> {
    if (candidateIds.length === 0) {
      return [];
    }
    const queryVec = (await this.options.embedder.embedBatch([text]))[0];
    if (!queryVec) {
      return [];
    }

    const vecHits = this.options.repo
      .knnByPassageIds(queryVec, candidateIds, 100)
      .filter((hit) => hit.distance < MAX_VECTOR_DISTANCE);
    const ftsHits = this.safeFts(text, candidateIds);
    const workHits = this.options.repo
      .passageIdsByWorkText(text, candidateIds, 100)
      .map((passage_id) => ({ passage_id }));

    const fused = fuseRrf<{ passage_id: string }>(
      [vecHits, ftsHits, workHits],
      (h) => h.passage_id,
      { k: RRF_K, limit }
    );

    const idsInOrder = fused.map((f) => f.key);
    const vecScoreById = new Map(vecHits.map((h) => [h.passage_id, h.distance]));
    const ftsScoreById = new Map(ftsHits.map((h) => [h.passage_id, h.bm25]));
    const ftsSnippetById = new Map(ftsHits.map((h) => [h.passage_id, h.fts_snippet]));

    const placeholders = idsInOrder.map(() => "?").join(",");
    const rowsById = new Map<string, Record<string, unknown>>();
    if (idsInOrder.length > 0) {
      const rows = this.options.db
        .prepare(
          `SELECT p.id AS passage_id, p.body, p.reader_note, p.position_start, p.position_end,
                  p.marked_at, p.is_starred, p.labels_json,
                  w.id AS work_id, w.display_title, w.creator, w.cover_image_url
           FROM passages p
           JOIN works w ON p.work_id = w.id
           WHERE p.id IN (${placeholders})`
        )
        .all(...idsInOrder) as Array<Record<string, unknown>>;
      for (const row of rows) {
        const pid = String(row.passage_id);
        row.fts_snippet = ftsSnippetById.get(pid) ?? null;
        rowsById.set(pid, row);
      }
    }

    return fused
      .map((fhit) => {
        const row = rowsById.get(fhit.key);
        if (!row) return null;
        // List 0 is the vector search; lists 1 (passage text) and 2 (work
        // title/author) are both literal matches, so they report as "fts5".
        const viaVector = fhit.sourceIndices.includes(0);
        const viaLiteral = fhit.sourceIndices.some((i) => i === 1 || i === 2);
        const matchedVia: SearchResult["matchedVia"] =
          viaVector && viaLiteral ? "both" : viaVector ? "vector" : "fts5";
        return hydrateResult(
          row,
          {
            fused: fhit.score,
            vectorDistance: vecScoreById.get(fhit.key),
            bm25: ftsScoreById.get(fhit.key)
          },
          matchedVia
        );
      })
      .filter((r): r is SearchResult => r !== null);
  }

  private safeFts(text: string, candidateIds: string[]) {
    try {
      const tokens = text.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) {
        return [];
      }
      // Quote each token individually so user input can't break out of the
      // FTS5 query syntax (escape inner `"` as `""`). Joining with spaces
      // gives FTS5 its default implicit-AND behavior across tokens — without
      // forcing the entire input into one phrase, which previously made
      // multi-word natural queries return ~no hits.
      const escaped = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
      return this.options.repo.ftsSearchInIds(escaped, candidateIds);
    } catch {
      return [];
    }
  }
}

function buildSnippet(
  body: string,
  ftsSnippet: string | null,
  matchedVia: SearchResult["matchedVia"]
): string {
  if ((matchedVia === "fts5" || matchedVia === "both") && ftsSnippet && ftsSnippet.length > 0) {
    return ftsSnippet;
  }
  // Vector-only or no FTS5 snippet available — body-slice fallback.
  if (body.length <= 220) {
    return body;
  }
  return `${body.slice(0, 220)}…`;
}

function hydrateResult(
  row: Record<string, unknown>,
  scores: SearchResult["scores"],
  matchedVia: SearchResult["matchedVia"]
): SearchResult {
  const body = String(row.body);
  const ftsSnippet = (row.fts_snippet as string | null) ?? null;
  return {
    passageId: String(row.passage_id),
    body,
    readerNote: (row.reader_note as string | null) ?? undefined,
    snippet: buildSnippet(body, ftsSnippet, matchedVia),
    work: {
      id: String(row.work_id),
      displayTitle: String(row.display_title),
      creator: (row.creator as string | null) ?? undefined,
      coverImageUrl: (row.cover_image_url as string | null) ?? undefined
    },
    position: formatPosition(row.position_start, row.position_end),
    markedAt: (row.marked_at as string | null) ?? undefined,
    labels: parseLabels(row.labels_json),
    isStarred: Number(row.is_starred) === 1,
    scores,
    matchedVia
  };
}

function formatPosition(start: unknown, end: unknown): string | undefined {
  if (!start) return undefined;
  if (end && end !== start) return `${start}–${end}`;
  return String(start);
}

function parseLabels(json: unknown): string[] {
  if (typeof json !== "string") return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
