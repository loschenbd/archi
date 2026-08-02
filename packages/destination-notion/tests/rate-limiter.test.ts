import { describe, expect, it } from "vitest";
import { TokenBucketRateLimiter, readHeader, retryAfterMs } from "../src/rateLimiter.js";

/** Deterministic clock: sleeping advances virtual time, nothing waits for real. */
function fakeClock(startMs = 0) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    sleep: async (milliseconds: number) => {
      nowMs += milliseconds;
    },
    advance: (milliseconds: number) => {
      nowMs += milliseconds;
    },
    elapsed: () => nowMs - startMs
  };
}

describe("TokenBucketRateLimiter", () => {
  it("lets the burst through without delay", async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 3, burst: 3, now: clock.now, sleep: clock.sleep });

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(clock.elapsed()).toBe(0);
  });

  it("paces sustained traffic to the configured rate", async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 3, burst: 3, now: clock.now, sleep: clock.sleep });

    // 3 burst + 9 paced = 12 requests. The 9 beyond burst cost ~1s per 3.
    for (let index = 0; index < 12; index += 1) {
      await limiter.acquire();
    }

    // 9 requests at 3/s === ~3000ms. Allow a rounding cushion.
    expect(clock.elapsed()).toBeGreaterThanOrEqual(2900);
    expect(clock.elapsed()).toBeLessThanOrEqual(3200);
  });

  it("refills over time so a later caller does not wait", async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 3, burst: 3, now: clock.now, sleep: clock.sleep });

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    clock.advance(1000);

    const before = clock.elapsed();
    await limiter.acquire();
    expect(clock.elapsed()).toBe(before);
  });

  it("never exceeds burst capacity no matter how long it idles", async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 3, burst: 3, now: clock.now, sleep: clock.sleep });

    clock.advance(60_000);

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    const before = clock.elapsed();
    await limiter.acquire();

    // The 4th must still wait — idle time cannot bank unlimited tokens.
    expect(clock.elapsed()).toBeGreaterThan(before);
  });

  it("serializes concurrent callers rather than letting them stampede", async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 3, burst: 1, now: clock.now, sleep: clock.sleep });

    await Promise.all(Array.from({ length: 4 }, () => limiter.acquire()));

    // 1 free + 3 paced at 3/s === ~1000ms.
    expect(clock.elapsed()).toBeGreaterThanOrEqual(900);
  });

  it("defaults to Notion's documented 3 requests per second", async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({ now: clock.now, sleep: clock.sleep });

    for (let index = 0; index < 6; index += 1) {
      await limiter.acquire();
    }

    // Default burst is ceil(3) === 3, so 3 requests are paced: ~1s.
    expect(clock.elapsed()).toBeGreaterThanOrEqual(900);
    expect(clock.elapsed()).toBeLessThanOrEqual(1100);
  });
});

describe("Retry-After handling", () => {
  it("reads a header from a Headers-like object", () => {
    const headers = new Map([["retry-after", "7"]]);
    expect(readHeader({ get: (key: string) => headers.get(key) ?? null }, "retry-after")).toBe("7");
  });

  it("reads a header case-insensitively from a plain object", () => {
    expect(readHeader({ "Retry-After": "12" }, "retry-after")).toBe("12");
  });

  it("converts integer seconds to milliseconds", () => {
    expect(retryAfterMs({ headers: { "retry-after": "3" } })).toBe(3000);
  });

  it("caps absurd values so a bad header cannot stall a sync", () => {
    expect(retryAfterMs({ headers: { "retry-after": "99999" } })).toBe(60_000);
  });

  it("returns undefined when absent or unparseable, so backoff takes over", () => {
    expect(retryAfterMs({ headers: {} })).toBeUndefined();
    expect(retryAfterMs({})).toBeUndefined();
    expect(retryAfterMs({ headers: { "retry-after": "soon" } })).toBeUndefined();
    expect(retryAfterMs({ headers: { "retry-after": "-5" } })).toBeUndefined();
  });
});
