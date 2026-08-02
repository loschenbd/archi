import type { CoreDatabase } from "../db/client.js";
import { DEFAULT_TIER, REVIEW_TIERS, type ReviewState } from "../review/schedule.js";

export type ReviewCandidate = ReviewState & {
  body: string;
  workId: string;
  workTitle: string;
  creator?: string;
  position?: string;
};

/**
 * Persistence for spaced resurfacing.
 *
 * Review state is stored only for passages the reader has actually seen. A
 * passage with no row is synthesised as never-reviewed, with its clock
 * starting at `marked_at` — so a highlight made two years ago is eligible on
 * the first session instead of waiting out a fresh half-life.
 */
export class ReviewRepository {
  constructor(private readonly db: CoreDatabase) {}

  /**
   * Every passage eligible to be scheduled, with its current review state.
   *
   * Excludes hidden and archived passages, which is where the ingest-quality
   * problems land (Amazon placeholder text, for one). Ordering and eligibility
   * are the scheduler's job, not SQL's.
   */
  listCandidates(options: { limit?: number } = {}): ReviewCandidate[] {
    const rows = this.db
      .prepare(
        `SELECT p.id            AS passage_id,
                p.body          AS body,
                p.work_id       AS work_id,
                p.position_start AS position_start,
                w.display_title AS work_title,
                w.creator       AS creator,
                r.half_life_days   AS half_life_days,
                r.last_reviewed_at AS last_reviewed_at,
                r.review_count     AS review_count,
                COALESCE(p.marked_at, p.ingested_at) AS seeded_at
           FROM passages p
           JOIN works w ON p.work_id = w.id
           LEFT JOIN passage_reviews r ON r.passage_id = p.id
          WHERE p.is_hidden = 0 AND p.is_archived = 0
          ${options.limit !== undefined ? "LIMIT ?" : ""}`
      )
      .all(...(options.limit !== undefined ? [options.limit] : [])) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      passageId: String(row.passage_id),
      halfLifeDays:
        typeof row.half_life_days === "number" ? row.half_life_days : REVIEW_TIERS[DEFAULT_TIER],
      lastReviewedAt:
        typeof row.last_reviewed_at === "string" ? row.last_reviewed_at : String(row.seeded_at),
      reviewCount: typeof row.review_count === "number" ? row.review_count : 0,
      body: String(row.body),
      workId: String(row.work_id),
      workTitle: String(row.work_title),
      ...(row.creator ? { creator: String(row.creator) } : {}),
      ...(row.position_start !== null && row.position_start !== undefined
        ? { position: String(row.position_start) }
        : {})
    }));
  }

  save(state: ReviewState): void {
    this.db
      .prepare(
        `INSERT INTO passage_reviews(passage_id, half_life_days, last_reviewed_at, review_count, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(passage_id) DO UPDATE SET
           half_life_days   = excluded.half_life_days,
           last_reviewed_at = excluded.last_reviewed_at,
           review_count     = excluded.review_count,
           updated_at       = excluded.updated_at`
      )
      .run(
        state.passageId,
        state.halfLifeDays,
        state.lastReviewedAt,
        state.reviewCount,
        new Date().toISOString()
      );
  }

  get(passageId: string): ReviewState | undefined {
    const row = this.db
      .prepare(
        `SELECT passage_id, half_life_days, last_reviewed_at, review_count
           FROM passage_reviews WHERE passage_id = ?`
      )
      .get(passageId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      passageId: String(row.passage_id),
      halfLifeDays: Number(row.half_life_days),
      lastReviewedAt: String(row.last_reviewed_at),
      reviewCount: Number(row.review_count)
    };
  }

  /** Total passages the reader has reviewed at least once. */
  reviewedCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM passage_reviews")
      .get() as { n: number };
    return row.n;
  }

  clear(): void {
    this.db.prepare("DELETE FROM passage_reviews").run();
  }
}
