import { resolveBundledModelDir } from "./modelPaths.js";

type Pipeline = (
  input: string | string[],
  options?: Record<string, unknown>
) => Promise<{ data: Float32Array; dims: number[] }>;

export type EmbeddingServiceOptions = {
  bundledModelRoot: string;
};

export class EmbeddingService {
  private readonly options: EmbeddingServiceOptions;
  private pipelineInstance: Pipeline | null = null;
  private loadPromise: Promise<Pipeline> | null = null;

  constructor(options: EmbeddingServiceOptions) {
    this.options = options;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) {
      return [];
    }
    const pipe = await this.ensureLoaded();
    // truncation + max_length cap token sequences to the model's 512-position
    // limit. Without them, a long passage produces a tensor shape that
    // exceeds bge-small-en-v1.5's max_position_embeddings, causing ONNX's
    // CPUAllocator to fail mid-Run with SIGTRAP (uncatchable from JS) — see
    // BFCArena trace in Electron crash report 2026-06-04.
    const result = await pipe(texts, {
      pooling: "mean",
      normalize: true,
      truncation: true,
      max_length: 512
    });
    const batch = result.dims[0];
    const dim = result.dims[1];
    if (typeof batch !== "number" || typeof dim !== "number") {
      throw new Error(`Unexpected embedding tensor shape: ${JSON.stringify(result.dims)}`);
    }
    const out: Float32Array[] = [];
    for (let i = 0; i < batch; i++) {
      out.push(result.data.slice(i * dim, (i + 1) * dim));
    }
    return out;
  }

  private async ensureLoaded(): Promise<Pipeline> {
    if (this.pipelineInstance) {
      return this.pipelineInstance;
    }
    if (!this.loadPromise) {
      this.loadPromise = this.load();
    }
    this.pipelineInstance = await this.loadPromise;
    return this.pipelineInstance;
  }

  private async load(): Promise<Pipeline> {
    const transformers = await import("@xenova/transformers");
    const modelDir = resolveBundledModelDir(this.options.bundledModelRoot);
    transformers.env.localModelPath = this.options.bundledModelRoot;
    transformers.env.allowRemoteModels = false;
    transformers.env.allowLocalModels = true;
    const pipe = await transformers.pipeline("feature-extraction", "bge-small-en-v1.5", {
      quantized: true,
      local_files_only: true,
      cache_dir: modelDir
    });
    return pipe as unknown as Pipeline;
  }
}
