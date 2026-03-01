import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock logger to suppress output
vi.mock("~/_utils", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { checkRateLimit } from "./rateLimit";

const CONFIG = { limit: 5, window: 60 };
const ID = "test-identifier";

// Helper to create a mock KV namespace
function makeMockKv(initial: { count: number; resetAt: number } | null = null) {
  let stored: { count: number; resetAt: number } | null = initial;
  return {
    get: vi.fn().mockImplementation(async (_key: string, _type: string) => stored),
    put: vi.fn().mockImplementation(async (_key: string, value: string) => {
      stored = JSON.parse(value) as { count: number; resetAt: number };
    }),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  };
}

beforeEach(() => {
  // Ensure RATE_LIMITER is not on globalThis
  if ("RATE_LIMITER" in globalThis) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).RATE_LIMITER;
  }
});

afterEach(() => {
  vi.clearAllMocks();
  if ("RATE_LIMITER" in globalThis) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).RATE_LIMITER;
  }
});

describe("checkRateLimit — no KV namespace", () => {
  it("allows all requests when RATE_LIMITER is not in globalThis", async () => {
    const result = await checkRateLimit(ID, CONFIG);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(CONFIG.limit);
    expect(result.retryAfter).toBe(0);
  });
});

describe("checkRateLimit — with KV namespace", () => {
  it("allows first request and sets remaining to limit - 1", async () => {
    const kv = makeMockKv(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).RATE_LIMITER = kv;

    const result = await checkRateLimit(ID, CONFIG);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(CONFIG.limit - 1);
    expect(result.retryAfter).toBe(0);
    expect(kv.put).toHaveBeenCalledOnce();
  });

  it("increments counter on subsequent requests", async () => {
    const now = Date.now();
    const resetAt = now + 60_000;
    const kv = makeMockKv({ count: 2, resetAt });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).RATE_LIMITER = kv;

    const result = await checkRateLimit(ID, CONFIG);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(CONFIG.limit - 3); // was 2, now 3
  });

  it("blocks requests when limit is exceeded", async () => {
    const now = Date.now();
    const resetAt = now + 30_000; // 30s until reset
    const kv = makeMockKv({ count: CONFIG.limit, resetAt });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).RATE_LIMITER = kv;

    const result = await checkRateLimit(ID, CONFIG);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(30);
  });

  it("resets window when resetAt has expired", async () => {
    const expiredResetAt = Date.now() - 1000; // already in the past
    const kv = makeMockKv({ count: CONFIG.limit, resetAt: expiredResetAt });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).RATE_LIMITER = kv;

    const result = await checkRateLimit(ID, CONFIG);

    // Should start fresh — first request is allowed
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(CONFIG.limit - 1);
  });

  it("fails open (allows request) when KV throws", async () => {
    const kv = {
      get: vi.fn().mockRejectedValue(new Error("KV error")),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).RATE_LIMITER = kv;

    const result = await checkRateLimit(ID, CONFIG);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(CONFIG.limit);
  });
});
