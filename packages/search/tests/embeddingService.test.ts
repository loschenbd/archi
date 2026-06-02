import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EmbeddingService } from "../src/embedding/embeddingService.js";
import { EMBEDDING_DIM } from "../src/types.js";

// In tests we point at the desktop app's bundled model dir.
const TEST_MODEL_ROOT = join(__dirname, "../../../apps/desktop/resources/models");

describe("EmbeddingService", () => {
  it("produces a 384-dim vector", async () => {
    const svc = new EmbeddingService({ bundledModelRoot: TEST_MODEL_ROOT });
    const [vec] = await svc.embedBatch(["the quick brown fox"]);
    expect(vec).toHaveLength(EMBEDDING_DIM);
  }, 30_000);

  it("is deterministic across calls", async () => {
    const svc = new EmbeddingService({ bundledModelRoot: TEST_MODEL_ROOT });
    const [a] = await svc.embedBatch(["anger"]);
    const [b] = await svc.embedBatch(["anger"]);
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const cosine = dot / (Math.sqrt(na) * Math.sqrt(nb));
    expect(cosine).toBeGreaterThan(0.999);
  }, 30_000);

  it("batch and sequential results are functionally equivalent (cosine ≥ 0.99)", async () => {
    const svc = new EmbeddingService({ bundledModelRoot: TEST_MODEL_ROOT });
    const inputs = ["anger", "joy", "courage"];
    const batched = await svc.embedBatch(inputs);
    const sequential = await Promise.all(inputs.map((t) => svc.embedBatch([t]).then((v) => v[0])));
    for (let i = 0; i < batched.length; i++) {
      let dot = 0;
      let nb = 0;
      let ns = 0;
      for (let j = 0; j < batched[i].length; j++) {
        dot += batched[i][j] * sequential[i][j];
        nb += batched[i][j] * batched[i][j];
        ns += sequential[i][j] * sequential[i][j];
      }
      const cosine = dot / (Math.sqrt(nb) * Math.sqrt(ns));
      // Padding-induced numerical noise in quantized ONNX inference produces small
      // component-wise drift between batched-with-padding and unpadded single calls.
      // Measured cosine sits around 0.9975 — the vectors remain functionally
      // equivalent for retrieval purposes.
      expect(cosine).toBeGreaterThan(0.99);
    }
  }, 60_000);
});
