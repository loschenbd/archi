/**
 * Token-bucket limiter for Notion's documented throughput ceiling.
 *
 * Notion throttles each connection to "an average of three requests per second,
 * with some bursts beyond the average allowed". Reactive retry-on-429 alone
 * means every backfill deliberately walks into the limit and pays a penalty
 * wait; pacing proactively keeps a large sync in the allowed band instead.
 *
 * The per-workspace limit is plan-scaled and shared across connections, so
 * effective throughput can be *below* 3 rps. This limiter is a ceiling, not a
 * guarantee — the 429 retry path stays in place behind it.
 */
export type RateLimiterOptions = {
  /** Sustained rate. Notion documents an average of 3 requests/second. */
  requestsPerSecond?: number;
  /** How many requests may fire back-to-back before pacing kicks in. */
  burst?: number;
  /** Injectable for deterministic tests. */
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

const DEFAULT_REQUESTS_PER_SECOND = 3;

export class TokenBucketRateLimiter {
  private readonly requestsPerSecond: number;
  private readonly burst: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  private tokens: number;
  private lastRefillMs: number;
  /** Serializes waiters so concurrent callers queue instead of stampeding. */
  private tail: Promise<void> = Promise.resolve();

  constructor(options: RateLimiterOptions = {}) {
    this.requestsPerSecond = Math.max(options.requestsPerSecond ?? DEFAULT_REQUESTS_PER_SECOND, 0.001);
    this.burst = Math.max(options.burst ?? Math.ceil(this.requestsPerSecond), 1);
    this.now = options.now ?? (() => Date.now());
    this.sleep =
      options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.tokens = this.burst;
    this.lastRefillMs = this.now();
  }

  /** Resolves once this caller is cleared to issue one request. */
  acquire(): Promise<void> {
    const queued = this.tail.then(() => this.take());
    // Never let one waiter's rejection poison the queue for the next.
    this.tail = queued.then(
      () => undefined,
      () => undefined
    );
    return queued;
  }

  private async take(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const deficit = 1 - this.tokens;
      await this.sleep(Math.max(Math.ceil((deficit / this.requestsPerSecond) * 1000), 1));
    }
  }

  private refill(): void {
    const now = this.now();
    const elapsedMs = now - this.lastRefillMs;
    if (elapsedMs <= 0) {
      return;
    }
    this.lastRefillMs = now;
    this.tokens = Math.min(this.burst, this.tokens + (elapsedMs / 1000) * this.requestsPerSecond);
  }
}

/**
 * Reads a header from either a `Headers` instance or a plain object, which is
 * what the SDK surfaces on `HTTPResponseError.headers` depending on runtime.
 */
export function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }
  const getter = (headers as { get?: (key: string) => string | null }).get;
  if (typeof getter === "function") {
    return getter.call(headers, name) ?? undefined;
  }
  const record = headers as Record<string, unknown>;
  const match = Object.keys(record).find((key) => key.toLowerCase() === name.toLowerCase());
  const value = match ? record[match] : undefined;
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

/**
 * Notion sets `Retry-After` as "an integer number of seconds (in decimal)" on
 * 429 and 529 responses and asks that it be respected. It is not guaranteed
 * present, so callers still need a backoff fallback.
 */
export function retryAfterMs(error: unknown, maxMs = 60_000): number | undefined {
  const raw = readHeader((error as { headers?: unknown }).headers, "retry-after");
  if (!raw) {
    return undefined;
  }
  const seconds = Number.parseFloat(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return Math.min(seconds * 1000, maxMs);
}
