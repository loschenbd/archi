import { describe, expect, it, beforeAll } from "vitest";
import { join } from "node:path";
import { openCoreDatabase, type CoreDatabase } from "@archi/core";
import { EmbeddingService } from "../src/embedding/embeddingService.js";
import { IndexerService } from "../src/indexer/indexerService.js";
import { SearchRepository } from "../src/repositories/searchRepository.js";
import { SearchService } from "../src/query/searchService.js";
import { FIXTURE_PASSAGES, FIXTURE_WORKS } from "./fixtures/canonicalCorpus.js";

const TEST_MODEL_ROOT = join(__dirname, "../../../apps/desktop/resources/models");

function seedFixture(db: CoreDatabase): void {
  const ts = "2026-06-02T00:00:00Z";
  for (const w of FIXTURE_WORKS) {
    db.prepare(
      `INSERT INTO works (id, ingest_source, display_title, raw_title, creator, work_type, first_ingested_at)
       VALUES (?, 'device-export', ?, ?, ?, ?, ?)`
    ).run(w.id, w.display_title, w.display_title, w.creator, w.work_type, ts);
  }
  for (const p of FIXTURE_PASSAGES) {
    db.prepare(
      `INSERT INTO passages (id, work_id, body, is_starred, marker_color, marked_at, ingested_at, updated_at, fingerprint_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(p.id, p.work_id, p.body, p.is_starred ? 1 : 0, p.marker_color ?? null, p.marked_at ?? ts, ts, ts, `fp-${p.id}`);
  }
}

describe("SearchService", () => {
  let db: CoreDatabase;
  let service: SearchService;

  beforeAll(async () => {
    db = openCoreDatabase(":memory:");
    seedFixture(db);
    const repo = new SearchRepository(db);
    const embedder = new EmbeddingService({ bundledModelRoot: TEST_MODEL_ROOT });
    const indexer = new IndexerService({ db, repo, embedder, batchSize: 32 });
    await indexer.runUntilIdle();
    service = new SearchService({ db, repo, embedder });
  }, 120_000);

  it("filters by creator and ranks Aurelius-on-anger highest for 'anger'", async () => {
    const res = await service.query({
      text: "anger",
      filters: { creator: "Marcus Aurelius" },
      limit: 5
    });
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0].passageId.startsWith("p-anger")).toBe(true);
    expect(res.results.every((r) => r.work.creator === "Marcus Aurelius")).toBe(true);
  }, 30_000);

  it("returns FTS5 match for proper-noun queries", async () => {
    const res = await service.query({
      text: "Meditations",
      filters: {},
      limit: 10
    });
    expect(res.results.length).toBeGreaterThan(0);
  }, 30_000);

  it("returns recent passages when text is empty", async () => {
    const res = await service.query({ text: "", filters: {}, limit: 50 });
    expect(res.results.length).toBe(FIXTURE_PASSAGES.length);
  });

  it("no-ops on very short text", async () => {
    const res = await service.query({ text: "a", filters: {}, limit: 50 });
    // With <2 chars we fall back to "browse mode" so behavior matches empty-text.
    expect(res.results.length).toBe(FIXTURE_PASSAGES.length);
  });

  it("multi-word query exercises FTS5 across all tokens", async () => {
    // Both "anger" and "fault" co-occur in p-anger-2's body. Previously the
    // whole query was forced into one quoted phrase, which would not match
    // because the tokens aren't adjacent — confirming FTS5 contributes here
    // proves we tokenize per-word and apply implicit-AND.
    const res = await service.query({
      text: "anger fault",
      filters: {},
      limit: 10
    });
    expect(res.results.length).toBeGreaterThan(0);
    const hasFtsContribution = res.results.some(
      (r) => r.matchedVia === "fts5" || r.matchedVia === "both"
    );
    expect(hasFtsContribution).toBe(true);
  }, 30_000);

  describe("snippet output", () => {
    it("wraps matched tokens in <mark> for fts5 matches", async () => {
      const res = await service.query({ text: "anger", filters: {}, limit: 5 });
      const ftsHit = res.results.find((r) => r.matchedVia === "fts5" || r.matchedVia === "both");
      expect(ftsHit).toBeDefined();
      expect(ftsHit!.snippet).toMatch(/<mark>anger<\/mark>/i);
    });

    it("returns first 220 chars + ellipsis for vector-only matches over 220 chars long", async () => {
      // Choose a query whose only matching mechanism is vector (synonym, not literal).
      const res = await service.query({ text: "rage", filters: {}, limit: 5 });
      const vectorOnly = res.results.find((r) => r.matchedVia === "vector");
      expect(vectorOnly).toBeDefined();
      if (vectorOnly!.body.length > 220) {
        expect(vectorOnly!.snippet.length).toBeLessThanOrEqual(221); // 220 + ellipsis
        expect(vectorOnly!.snippet.endsWith("…")).toBe(true);
      } else {
        expect(vectorOnly!.snippet).toBe(vectorOnly!.body);
      }
    });
  });
});
