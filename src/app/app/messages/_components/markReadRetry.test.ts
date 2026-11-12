import { describe, expect, it } from "vitest";

import { MARK_READ_MAX_RETRIES, markReadRetryDelayMs } from "./markReadRetry";

describe("markReadRetryDelayMs", () => {
  it("backs off from five seconds to a minute, then gives up", () => {
    const delays = Array.from({ length: MARK_READ_MAX_RETRIES + 2 }, (_, index) => markReadRetryDelayMs(index + 1));

    expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000, null, null]);
  });

  it("is bounded in total: a thread left open does not retry for ever", () => {
    let total = 0;
    for (let failures = 1; ; failures += 1) {
      const delay = markReadRetryDelayMs(failures);
      if (delay === null) break;
      total += delay;
    }
    expect(total).toBe(195_000);
  });
});
