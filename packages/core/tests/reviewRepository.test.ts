import { describe, expect, it, beforeEach } from "vitest";
import { openCoreDatabase, type CoreDatabase } from "../src/db/client.js";
import { ReviewRepository } from "../src/repositories/reviewRepository.js";
import { REVIEW_TIERS, selectForSession } from "../src/review/schedule.js";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const LONG_AGO = "2024-01-01T00:00:00.000Z";

function seed(db: CoreDatabase): void {
  db.prepare(
    `INSERT INTO works (id, ingest_source, display_title, raw_title, creator, work_type, first_ingested_at)
     VALUES ('w1', 'device-export', 'Meditations', 'Meditations', 'Marcus Aurelius', 'book', ?)`
  ).run(LONG_AGO);
  const insert = db.prepare(
    `INSERT INTO passages (id, work_id, body, is_starred, is_hidden, is_archived, marked_at, ingested_at, updated_at, fingerprint_hash)
     VALUES (?, 'w1', ?, 0, ?, ?, ?, ?, ?, ?)`
  );
  insert.run("p1", "The first passage.", 0, 0, LONG_AGO, LONG_AGO, LONG_AGO, "fp1");
  insert.run("p2", "The second passage.", 0, 0, LONG_AGO, LONG_AGO, LONG_AGO, "fp2");
  insert.run("p-hidden", "Hidden passage.", 1, 0, LONG_AGO, LONG_AGO, LONG_AGO, "fp3");
  insert.run("p-archived", "Archived passage.", 0, 1, LONG_AGO, LONG_AGO, LONG_AGO, "fp4");
}

describe("ReviewRepository", () => {
  let db: CoreDatabase;
  let repo: ReviewRepository;

  beforeEach(() => {
    db = openCoreDatabase(":memory:");
    seed(db);
    repo = new ReviewRepository(db);
  });

  it("synthesises state for passages that have never been reviewed", () => {
    const candidates = repo.listCandidates();
    const p1 = candidates.find((c) => c.passageId === "p1");
    expect(p1).toBeDefined();
    expect(p1!.reviewCount).toBe(0);
    expect(p1!.halfLifeDays).toBe(REVIEW_TIERS.later);
    // Clock starts at the highlight date, so an old highlight is due now.
    expect(p1!.lastReviewedAt).toBe(LONG_AGO);
  });

  it("carries the work title and author through for display", () => {
    const p1 = repo.listCandidates().find((c) => c.passageId === "p1");
    expect(p1!.workTitle).toBe("Meditations");
    expect(p1!.creator).toBe("Marcus Aurelius");
  });

  it("excludes hidden and archived passages", () => {
    const ids = repo.listCandidates().map((c) => c.passageId);
    expect(ids).toContain("p1");
    expect(ids).not.toContain("p-hidden");
    expect(ids).not.toContain("p-archived");
  });

  it("writes no rows until a passage is actually reviewed", () => {
    expect(repo.reviewedCount()).toBe(0);
    repo.listCandidates();
    expect(repo.reviewedCount()).toBe(0);
  });

  it("round-trips saved state and overrides the synthesised default", () => {
    repo.save({
      passageId: "p1",
      halfLifeDays: 28,
      lastReviewedAt: NOW.toISOString(),
      reviewCount: 3
    });
    expect(repo.get("p1")).toEqual({
      passageId: "p1",
      halfLifeDays: 28,
      lastReviewedAt: NOW.toISOString(),
      reviewCount: 3
    });
    const p1 = repo.listCandidates().find((c) => c.passageId === "p1");
    expect(p1!.halfLifeDays).toBe(28);
    expect(p1!.reviewCount).toBe(3);
  });

  it("upserts rather than failing on a second save for the same passage", () => {
    repo.save({ passageId: "p1", halfLifeDays: 7, lastReviewedAt: LONG_AGO, reviewCount: 1 });
    repo.save({ passageId: "p1", halfLifeDays: 14, lastReviewedAt: LONG_AGO, reviewCount: 2 });
    expect(repo.reviewedCount()).toBe(1);
    expect(repo.get("p1")!.halfLifeDays).toBe(14);
  });

  it("feeds the scheduler: a just-reviewed passage drops out of the session", () => {
    expect(selectForSession(repo.listCandidates(), 10, NOW).map((s) => s.passageId)).toEqual([
      "p1",
      "p2"
    ]);
    repo.save({
      passageId: "p1",
      halfLifeDays: 28,
      lastReviewedAt: NOW.toISOString(),
      reviewCount: 1
    });
    expect(selectForSession(repo.listCandidates(), 10, NOW).map((s) => s.passageId)).toEqual(["p2"]);
  });

  it("clears all state", () => {
    repo.save({ passageId: "p1", halfLifeDays: 7, lastReviewedAt: LONG_AGO, reviewCount: 1 });
    repo.clear();
    expect(repo.reviewedCount()).toBe(0);
  });
});
