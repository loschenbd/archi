export type SearchFilters = {
  work_ids?: string[];
  creator?: string;
  labels?: string[];
  is_starred?: boolean;
  is_archived?: boolean;
  is_hidden?: boolean;
  marker_color?: string;
  work_type?: string;
  marked_after?: string;
  marked_before?: string;
};

export type SearchQuery = {
  text: string;
  filters: SearchFilters;
  limit: number;
};

export type SearchResult = {
  passage_id: string;
  body: string;
  reader_note?: string;
  snippet: string;
  work: {
    id: string;
    display_title: string;
    creator?: string;
    cover_image_url?: string;
  };
  position?: string;
  marked_at?: string;
  labels: string[];
  is_starred: boolean;
  scores: {
    fused: number;
    vector_distance?: number;
    bm25?: number;
  };
  matched_via: "vector" | "fts5" | "both";
};

export type SearchResponse = {
  query: string;
  filters: SearchFilters;
  results: SearchResult[];
  total_candidates: number;
  duration_ms: number;
};

export type IndexerStatus = {
  status: "idle" | "running" | "failed" | "unavailable";
  total: number;
  indexed: number;
  failed: number;
  lastError?: string;
};

export const EMBEDDING_DIM = 384;
export const EMBEDDING_MODEL_ID = "bge-small-en-v1.5@v1";
