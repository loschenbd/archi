import crypto from "node:crypto";
import type { CoreDatabase } from "@archi/core";
import type { EmbeddingService } from "../embedding/embeddingService.js";
import type { SearchRepository } from "../repositories/searchRepository.js";
import { EMBEDDING_MODEL_ID, type IndexerStatus } from "../types.js";

export type IndexerServiceOptions = {
  db: CoreDatabase;
  repo: SearchRepository;
  embedder: EmbeddingService;
  batchSize?: number;
};

function hashBody(body: string): string {
  const normalized = body.trim().replace(/\s+/g, " ").toLowerCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export class IndexerService {
  private readonly db: CoreDatabase;
  private readonly repo: SearchRepository;
  private readonly embedder: EmbeddingService;
  private readonly batchSize: number;
  private status: IndexerStatus["status"] = "idle";
  private lastError: string | undefined;
  private running = false;

  constructor(options: IndexerServiceOptions) {
    this.db = options.db;
    this.repo = options.repo;
    this.embedder = options.embedder;
    this.batchSize = options.batchSize ?? 32;
  }

  getStatus(): IndexerStatus {
    return {
      status: this.status,
      total: this.repo.countPassages(),
      indexed: this.repo.countIndexed(EMBEDDING_MODEL_ID),
      failed: this.repo.countFailed(EMBEDDING_MODEL_ID),
      lastError: this.lastError
    };
  }

  /** Process pending work until idle. Safe to call again concurrently — second caller no-ops. */
  async runUntilIdle(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      // Probe the embedder before processing any batches. If it can't load
      // (model missing, dylib mismatch, ONNX init failure), mark unavailable
      // and exit — don't spin-loop re-fetching the same rows forever.
      try {
        await this.embedder.embedBatch(["__probe__"]);
      } catch (err) {
        this.markUnavailable(err instanceof Error ? err.message : String(err));
        return;
      }
      while (true) {
        const batch = this.repo.fetchPendingForModel(EMBEDDING_MODEL_ID, this.batchSize);
        if (batch.length === 0) {
          this.status = "idle";
          return;
        }
        this.status = "running";
        try {
          const vectors = await this.embedder.embedBatch(batch.map((p) => p.body));
          for (let i = 0; i < batch.length; i++) {
            const passage = batch[i]!;
            const vector = vectors[i]!;
            this.repo.upsertEmbedding(passage.id, vector, hashBody(passage.body));
          }
        } catch (err) {
          // Per-batch transient or input-specific error: record failures and
          // continue. Combined with fetchPendingForModel excluding 'failed',
          // these rows are skipped on subsequent runs (manual reindex required
          // to retry).
          this.lastError = err instanceof Error ? err.message : String(err);
          for (const p of batch) {
            this.repo.recordEmbeddingFailure(p.id, hashBody(p.body), this.lastError);
          }
        }
        // Yield to the event loop so IPC handlers can interleave during a
        // long backfill.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } finally {
      this.running = false;
    }
  }

  /** Fire-and-forget kick. Used from sync completion handlers. */
  tick(): void {
    void this.runUntilIdle();
  }

  markUnavailable(reason: string): void {
    this.status = "unavailable";
    this.lastError = reason;
  }
}
