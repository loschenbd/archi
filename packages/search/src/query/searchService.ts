import type { CoreDatabase } from "@archi/core";
import type { EmbeddingService } from "../embedding/embeddingService.js";
import type { SearchRepository } from "../repositories/searchRepository.js";
import { buildCandidateSql } from "./filterSql.js";
import { fuseRrf } from "./rrf.js";
import type {
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

export class SearchService {
  constructor(private readonly options: SearchServiceOptions) {}

  async query(q: SearchQuery): Promise<SearchResponse> {
    const start = Date.now();
    const filters = this.resolveDefaults(q.filters);
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

    const vecHits = this.options.repo.knnByPassageIds(queryVec, candidateIds, 100);
    const ftsHits = this.safeFts(text, candidateIds);

    const fused = fuseRrf<{ passage_id: string }>(
      [vecHits, ftsHits],
      (h) => h.passage_id,
      { k: RRF_K, limit }
    );

    const idsInOrder = fused.map((f) => f.key);
    const vecScoreById = new Map(vecHits.map((h) => [h.passage_id, h.distance]));
    const ftsScoreById = new Map(ftsHits.map((h) => [h.passage_id, h.bm25]));

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
        rowsById.set(String(row.passage_id), row);
      }
    }

    return fused
      .map((fhit) => {
        const row = rowsById.get(fhit.key);
        if (!row) return null;
        const matchedVia: SearchResult["matchedVia"] =
          fhit.sourceIndices.length === 2 ? "both" : fhit.sourceIndices[0] === 0 ? "vector" : "fts5";
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

function hydrateResult(
  row: Record<string, unknown>,
  scores: SearchResult["scores"],
  matchedVia: SearchResult["matchedVia"]
): SearchResult {
  const body = String(row.body);
  return {
    passageId: String(row.passage_id),
    body,
    readerNote: (row.reader_note as string | null) ?? undefined,
    snippet: body.length > 240 ? `${body.slice(0, 240)}…` : body,
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
    matchedVia: matchedVia
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
