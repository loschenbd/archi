export type SearchFilters = {
  workIds?: string[];
  creator?: string;
  labels?: string[];
  isStarred?: boolean;
  isArchived?: boolean;
  isHidden?: boolean;
  markerColor?: string;
  workType?: string;
  markedAfter?: string;
  markedBefore?: string;
};

export type SearchQuery = {
  text: string;
  filters: SearchFilters;
  limit: number;
};

export type SearchResult = {
  passageId: string;
  body: string;
  readerNote?: string;
  snippet: string;
  work: {
    id: string;
    displayTitle: string;
    creator?: string;
    coverImageUrl?: string;
  };
  position?: string;
  markedAt?: string;
  labels: string[];
  isStarred: boolean;
  scores: {
    fused: number;
    vectorDistance?: number;
    bm25?: number;
  };
  matchedVia: "vector" | "fts5" | "both";
};

export type SearchResponse = {
  query: string;
  filters: SearchFilters;
  results: SearchResult[];
  totalCandidates: number;
  durationMs: number;
};

export type IndexerStatus = {
  status: "idle" | "running" | "failed" | "unavailable";
  total: number;
  indexed: number;
  failed: number;
  lastError?: string;
};

export const EMBEDDING_DIM = 384;

/**
 * Identifier for the embedding model + schema version currently in use.
 * The `@vN` suffix is the embedding *schema* version — bump it any time
 * the embedding input or normalization changes in a way that should
 * invalidate existing vectors. The IndexerService scans for rows in
 * `embedding_state` whose `model_id` does not match this constant and
 * re-embeds them; if you change models without bumping the suffix,
 * stale vectors will silently coexist with new ones.
 */
export const EMBEDDING_MODEL_ID = "bge-small-en-v1.5@v1";
