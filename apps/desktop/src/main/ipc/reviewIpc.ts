import { ipcMain } from "electron";
import {
  afterReview,
  afterRevisit,
  isCompleteSentence,
  recallProbability,
  selectForSession,
  type ReviewCandidate,
  type ReviewRepository
} from "@archi/core";
import type { SearchModule } from "../searchModule.js";

export type ReviewSessionRequest = {
  /** Highlights to show. Readwise's themed sessions use a 1–15 range, default 5. */
  limit: number;
  /** Free-text theme; when set, the pool is narrowed by semantic search first. */
  theme?: string;
  /** Whether to drop sentence fragments. Default on, matching Readwise. */
  qualityFilter?: boolean;
};

export type ReviewSessionItem = ReviewCandidate & { recallProbability: number };

export type ReviewSessionResponse = {
  items: ReviewSessionItem[];
  /** Passages eligible right now, before the session limit is applied. */
  dueCount: number;
  /** Passages in the pool at all, after theme and quality filtering. */
  poolSize: number;
  themeMatched: number | null;
};

/**
 * How many passages a theme query pulls before scheduling. Generous, because
 * the scheduler then discards everything that has not decayed yet — too small
 * a number and a theme session comes back empty despite plenty being due.
 */
const THEME_POOL_SIZE = 500;

export function registerReviewIpc(reviews: ReviewRepository, search: SearchModule): void {
  ipcMain.handle(
    "archi:review:session",
    async (_event, request: ReviewSessionRequest): Promise<ReviewSessionResponse> => {
      const now = new Date();
      const useQualityFilter = request.qualityFilter !== false;

      let pool = reviews.listCandidates();
      if (useQualityFilter) {
        const filtered = pool.filter((c) => isCompleteSentence(c.body));
        // Never let the filter empty the session — an all-fragment library
        // should still get a review, just a scrappier one.
        if (filtered.length > 0) pool = filtered;
      }

      let themeMatched: number | null = null;
      const theme = request.theme?.trim();
      if (theme) {
        const response = await search.search.query({
          text: theme,
          filters: {},
          limit: THEME_POOL_SIZE
        });
        const matched = new Set(response.results.map((r) => r.passageId));
        themeMatched = matched.size;
        pool = pool.filter((c) => matched.has(c.passageId));
      }

      const due = selectForSession(pool, Number.MAX_SAFE_INTEGER, now);
      const items = selectForSession(pool, request.limit, now).map((state) => {
        const candidate = pool.find((c) => c.passageId === state.passageId) as ReviewCandidate;
        return {
          ...candidate,
          recallProbability: recallProbability(state, now)
        };
      });

      return { items, dueCount: due.length, poolSize: pool.length, themeMatched };
    }
  );

  ipcMain.handle(
    "archi:review:record",
    (_event, request: { passageId: string; action: "reviewed" | "revisit" }) => {
      const now = new Date();
      const existing =
        reviews.get(request.passageId) ??
        reviews.listCandidates().find((c) => c.passageId === request.passageId);
      if (!existing) {
        return { recorded: false };
      }
      const next =
        request.action === "revisit" ? afterRevisit(existing, now) : afterReview(existing, now);
      reviews.save(next);
      return { recorded: true, halfLifeDays: next.halfLifeDays, reviewCount: next.reviewCount };
    }
  );

  ipcMain.handle("archi:review:stats", () => {
    const now = new Date();
    const pool = reviews.listCandidates();
    return {
      total: pool.length,
      due: selectForSession(pool, Number.MAX_SAFE_INTEGER, now).length,
      reviewed: reviews.reviewedCount()
    };
  });
}
