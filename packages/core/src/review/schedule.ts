/**
 * Spaced resurfacing by recall-probability decay.
 *
 * Modelled on the algorithm Readwise documents for its Daily Review, which is
 * decay-based rather than date-based like SM-2/Anki: each highlight carries a
 * half-life, its recall probability decays continuously, and it becomes
 * eligible once that probability reaches 50%. Highlights compete on
 * probability, so the least-recalled surface first instead of whatever a
 * calendar says is due today.
 *
 * The practical difference from a date scheduler: nothing is ever "overdue".
 * A library that goes untouched for a year produces a ranked queue rather
 * than a backlog of a thousand past-due cards.
 *
 * @see https://docs.readwise.io/readwise/docs/faqs/reviewing-highlights
 */

/** Named starting points for a passage's half-life, in days. */
export const REVIEW_TIERS = {
  soon: 7,
  later: 14,
  someday: 28
} as const;

export type ReviewTier = keyof typeof REVIEW_TIERS;

export const DEFAULT_TIER: ReviewTier = "later";

/** A passage becomes a candidate once recall probability decays to this. */
export const ELIGIBLE_AT_PROBABILITY = 0.5;

/**
 * Ceiling on half-life growth. Without it, a passage reviewed often enough
 * effectively leaves the rotation forever; a year keeps the long tail alive.
 */
export const MAX_HALF_LIFE_DAYS = 365;

const MS_PER_DAY = 86_400_000;

export type ReviewState = {
  passageId: string;
  halfLifeDays: number;
  /** ISO timestamp of the last review, or of first scheduling if never reviewed. */
  lastReviewedAt: string;
  reviewCount: number;
};

/**
 * Probability the reader still recalls this passage, in [0, 1].
 *
 * `p = 2^(-elapsed / halfLife)` — 1 at the moment of review, exactly 0.5 after
 * one half-life, 0.25 after two.
 */
export function recallProbability(state: ReviewState, now: Date): number {
  const elapsedMs = now.getTime() - Date.parse(state.lastReviewedAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return 1;
  }
  const halfLife = Math.max(state.halfLifeDays, Number.EPSILON);
  return 2 ** (-(elapsedMs / MS_PER_DAY) / halfLife);
}

export function isEligible(state: ReviewState, now: Date): boolean {
  return recallProbability(state, now) <= ELIGIBLE_AT_PROBABILITY;
}

/**
 * Eligible passages, least-recalled first, capped at `limit`.
 *
 * Ties break on passage id so a session is stable across repeated calls with
 * the same clock — otherwise the list reshuffles under the reader mid-session.
 */
export function selectForSession(
  states: ReviewState[],
  limit: number,
  now: Date
): ReviewState[] {
  if (limit <= 0) {
    return [];
  }
  return states
    .map((state) => ({ state, p: recallProbability(state, now) }))
    .filter((entry) => entry.p <= ELIGIBLE_AT_PROBABILITY)
    .sort((a, b) => a.p - b.p || a.state.passageId.localeCompare(b.state.passageId))
    .slice(0, limit)
    .map((entry) => entry.state);
}

/**
 * State after the reader has seen a passage: the clock resets and the
 * half-life doubles, so each survival pushes it further out.
 */
export function afterReview(state: ReviewState, now: Date): ReviewState {
  return {
    passageId: state.passageId,
    halfLifeDays: Math.min(state.halfLifeDays * 2, MAX_HALF_LIFE_DAYS),
    lastReviewedAt: now.toISOString(),
    reviewCount: state.reviewCount + 1
  };
}

/**
 * State for a passage the reader wants to see again soon — the half-life
 * drops back to the shortest tier rather than to zero, so a single tap
 * doesn't pin it to the top of every future session.
 */
export function afterRevisit(state: ReviewState, now: Date): ReviewState {
  return {
    passageId: state.passageId,
    halfLifeDays: REVIEW_TIERS.soon,
    lastReviewedAt: now.toISOString(),
    reviewCount: state.reviewCount + 1
  };
}

/**
 * Initial state for a passage entering the rotation.
 *
 * `since` is when the passage was highlighted, not now: a highlight made two
 * years ago should be eligible immediately rather than serving a fresh
 * half-life before it can ever appear.
 */
export function initialState(
  passageId: string,
  since: string,
  tier: ReviewTier = DEFAULT_TIER
): ReviewState {
  return {
    passageId,
    halfLifeDays: REVIEW_TIERS[tier],
    lastReviewedAt: since,
    reviewCount: 0
  };
}
