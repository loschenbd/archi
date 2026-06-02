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
    const result = await pipe(texts, { pooling: "mean", normalize: true });
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
