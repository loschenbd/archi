import { describe, expect, it } from "vitest";
import {
  afterReview,
  afterRevisit,
  ELIGIBLE_AT_PROBABILITY,
  initialState,
  isEligible,
  MAX_HALF_LIFE_DAYS,
  recallProbability,
  REVIEW_TIERS,
  selectForSession,
  type ReviewState
} from "../src/review/schedule.js";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const daysAfter = (n: number): Date => new Date(T0.getTime() + n * 86_400_000);

function state(passageId: string, halfLifeDays: number, lastReviewedAt = T0.toISOString()): ReviewState {
  return { passageId, halfLifeDays, lastReviewedAt, reviewCount: 0 };
}

describe("recallProbability", () => {
  it("is 1 at the moment of review", () => {
    expect(recallProbability(state("p", 7), T0)).toBe(1);
  });

  it("is exactly 0.5 after one half-life", () => {
    expect(recallProbability(state("p", 7), daysAfter(7))).toBeCloseTo(0.5, 10);
  });

  it("halves again on each further half-life", () => {
    expect(recallProbability(state("p", 7), daysAfter(14))).toBeCloseTo(0.25, 10);
    expect(recallProbability(state("p", 7), daysAfter(28))).toBeCloseTo(0.0625, 10);
  });

  it("clamps to 1 for a future timestamp rather than exceeding it", () => {
    expect(recallProbability(state("p", 7, daysAfter(5).toISOString()), T0)).toBe(1);
  });

  it("returns 1 for an unparseable timestamp instead of NaN", () => {
    expect(recallProbability(state("p", 7, "not-a-date"), daysAfter(30))).toBe(1);
  });
});

describe("isEligible", () => {
  it("is false one day before the half-life elapses", () => {
    expect(isEligible(state("p", 7), daysAfter(6))).toBe(false);
  });

  it("is true exactly at the half-life, where probability equals the threshold", () => {
    expect(recallProbability(state("p", 7), daysAfter(7))).toBeLessThanOrEqual(
      ELIGIBLE_AT_PROBABILITY
    );
    expect(isEligible(state("p", 7), daysAfter(7))).toBe(true);
  });

  it("respects each tier's starting half-life", () => {
    expect(isEligible(state("soon", REVIEW_TIERS.soon), daysAfter(7))).toBe(true);
    expect(isEligible(state("later", REVIEW_TIERS.later), daysAfter(7))).toBe(false);
    expect(isEligible(state("later", REVIEW_TIERS.later), daysAfter(14))).toBe(true);
    expect(isEligible(state("someday", REVIEW_TIERS.someday), daysAfter(14))).toBe(false);
    expect(isEligible(state("someday", REVIEW_TIERS.someday), daysAfter(28))).toBe(true);
  });
});

describe("selectForSession", () => {
  it("returns the least-recalled first", () => {
    const picked = selectForSession(
      [state("fresh", 28), state("stalest", 1), state("middling", 7)],
      3,
      daysAfter(30)
    );
    expect(picked.map((s) => s.passageId)).toEqual(["stalest", "middling", "fresh"]);
  });

  it("excludes passages that have not decayed to the threshold", () => {
    const picked = selectForSession([state("a", 7), state("b", 90)], 10, daysAfter(10));
    expect(picked.map((s) => s.passageId)).toEqual(["a"]);
  });

  it("caps the session at the requested size", () => {
    const many = Array.from({ length: 40 }, (_, i) => state(`p${i}`, 7));
    expect(selectForSession(many, 5, daysAfter(30))).toHaveLength(5);
  });

  it("returns nothing for a non-positive limit", () => {
    expect(selectForSession([state("a", 7)], 0, daysAfter(30))).toEqual([]);
  });

  it("is stable across calls so a session does not reshuffle mid-read", () => {
    const tied = [state("c", 7), state("a", 7), state("b", 7)];
    const first = selectForSession(tied, 3, daysAfter(30)).map((s) => s.passageId);
    const second = selectForSession([...tied].reverse(), 3, daysAfter(30)).map((s) => s.passageId);
    expect(first).toEqual(["a", "b", "c"]);
    expect(second).toEqual(first);
  });

  it("returns an empty session rather than padding with ineligible passages", () => {
    expect(selectForSession([state("a", 90), state("b", 90)], 5, daysAfter(1))).toEqual([]);
  });
});

describe("afterReview", () => {
  it("doubles the half-life and resets the clock", () => {
    const next = afterReview(state("p", 7), daysAfter(10));
    expect(next.halfLifeDays).toBe(14);
    expect(next.lastReviewedAt).toBe(daysAfter(10).toISOString());
    expect(next.reviewCount).toBe(1);
    expect(isEligible(next, daysAfter(10))).toBe(false);
  });

  it("caps the half-life so nothing leaves the rotation permanently", () => {
    let s = state("p", MAX_HALF_LIFE_DAYS);
    s = afterReview(s, daysAfter(1));
    expect(s.halfLifeDays).toBe(MAX_HALF_LIFE_DAYS);
  });

  it("walks the documented 7 → 14 → 28 progression", () => {
    let s = initialState("p", T0.toISOString(), "soon");
    expect(s.halfLifeDays).toBe(7);
    s = afterReview(s, daysAfter(7));
    expect(s.halfLifeDays).toBe(14);
    s = afterReview(s, daysAfter(21));
    expect(s.halfLifeDays).toBe(28);
  });
});

describe("afterRevisit", () => {
  it("drops back to the shortest tier without pinning the passage to the top", () => {
    const next = afterRevisit(state("p", 90), daysAfter(100));
    expect(next.halfLifeDays).toBe(REVIEW_TIERS.soon);
    expect(isEligible(next, daysAfter(100))).toBe(false);
    expect(isEligible(next, daysAfter(107))).toBe(true);
  });
});

describe("initialState", () => {
  it("dates from when the passage was highlighted, so an old highlight is eligible at once", () => {
    const twoYearsAgo = new Date(T0.getTime() - 730 * 86_400_000).toISOString();
    expect(isEligible(initialState("p", twoYearsAgo), T0)).toBe(true);
  });

  it("does not make a highlight made moments ago eligible", () => {
    expect(isEligible(initialState("p", T0.toISOString()), T0)).toBe(false);
  });

  it("defaults to the 'later' tier", () => {
    expect(initialState("p", T0.toISOString()).halfLifeDays).toBe(REVIEW_TIERS.later);
  });
});
